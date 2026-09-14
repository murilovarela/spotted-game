/** The only module that touches sharp. Bytes in, bytes/RGBA out. */
import sharp from "sharp";
import type { ImageSize } from "@/lib/types";
import type { Box } from "./types";

export const DIFF_MAX_SIDE = 512;

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
