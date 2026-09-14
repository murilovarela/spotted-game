/** The only module that touches sharp. Bytes in, bytes/RGBA out. */
import sharp from "sharp";
import type { ImageSize } from "@/lib/types";
import type { Box } from "./types";

const DIFF_MAX_SIDE = 512;

export type ImageMime = "image/png" | "image/jpeg" | "image/webp";

/** Sniff the container from magic bytes; null for anything that is not PNG/JPEG/WebP. */
export function mimeOf(bytes: Uint8Array): ImageMime | null {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const ascii = (at: number, s: string) => bytes.length >= at + s.length && s.split("").every((ch, i) => bytes[at + i] === ch.charCodeAt(0));
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  return null;
}

/** PNG in → same bytes out; anything else is transcoded so downstream never guesses the container. */
export async function toPng(bytes: Uint8Array): Promise<Uint8Array> {
  if (mimeOf(bytes) === "image/png") return bytes;
  return new Uint8Array(await sharp(bytes).png().toBuffer());
}

export async function dimensions(png: Uint8Array): Promise<ImageSize> {
  const m = await sharp(png).metadata();
  if (!m.width || !m.height) throw new Error("images: cannot read dimensions");
  return { width: m.width, height: m.height };
}

export async function decodeRGBA(png: Uint8Array): Promise<{ data: Uint8Array; width: number; height: number }> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
}

export function encodePng(rgba: Uint8Array, size: ImageSize): Promise<Uint8Array> {
  return sharp(Buffer.from(rgba), { raw: { width: size.width, height: size.height, channels: 4 } })
    .png()
    .toBuffer()
    .then((b) => new Uint8Array(b));
}

/** Longest side ≤ max, aspect preserved, at least 1px. */
export function diffScale(size: ImageSize, max = DIFF_MAX_SIDE): ImageSize {
  const f = Math.min(1, max / Math.max(size.width, size.height));
  return { width: Math.max(1, Math.round(size.width * f)), height: Math.max(1, Math.round(size.height * f)) };
}

/** Longest side ≤ `maxSide`, aspect preserved; the input bytes come back untouched when already within it. */
export async function downscale(png: Uint8Array, maxSide: number): Promise<Uint8Array> {
  const size = await dimensions(png);
  if (Math.max(size.width, size.height) <= maxSide) return png;
  const buf = await sharp(png).resize(maxSide, maxSide, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
  return new Uint8Array(buf);
}

/** Resize (stretch to exactly `size`) and decode. Used to bring background and output onto one grid. */
export async function toRGBAAt(png: Uint8Array, size: ImageSize): Promise<Uint8Array> {
  const buf = await sharp(png).resize(size.width, size.height, { fit: "fill" }).ensureAlpha().raw().toBuffer();
  return new Uint8Array(buf);
}

/** Crop a normalized box out of a PNG (clamped to the frame). */
export async function cropPng(png: Uint8Array, box: Box, size: ImageSize): Promise<Uint8Array> {
  const left = Math.max(0, Math.floor(box.x * size.width));
  const top = Math.max(0, Math.floor(box.y * size.height));
  const width = Math.max(1, Math.min(size.width - left, Math.ceil(box.w * size.width)));
  const height = Math.max(1, Math.min(size.height - top, Math.ceil(box.h * size.height)));
  return new Uint8Array(await sharp(png).extract({ left, top, width, height }).png().toBuffer());
}

/** Paste `layers` onto `background` at their normalized boxes; each layer is resized to its box. */
export async function compositePng(background: Uint8Array, layers: readonly { png: Uint8Array; box: Box }[]): Promise<{ png: Uint8Array } & ImageSize> {
  const size = await dimensions(background);
  const inputs = await Promise.all(
    layers.map(async (l) => ({
      input: await sharp(l.png)
        .resize(Math.max(1, Math.round(l.box.w * size.width)), Math.max(1, Math.round(l.box.h * size.height)), { fit: "fill" })
        .png()
        .toBuffer(),
      left: Math.round(l.box.x * size.width),
      top: Math.round(l.box.y * size.height),
    })),
  );
  const png = new Uint8Array(await sharp(background).composite(inputs).png().toBuffer());
  return { png, ...size };
}
