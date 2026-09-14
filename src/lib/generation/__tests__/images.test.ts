import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { decodeRGBA, dimensions, downscale, encodePng, letterboxTo, mimeOf, toPng, toRGBAAt } from "../images";

describe("mimeOf", () => {
  it("recognises PNG, JPEG and WebP by magic bytes and rejects the rest", async () => {
    const png = await encodePng(new Uint8Array(4).fill(255), { width: 1, height: 1 });
    expect(mimeOf(png)).toBe("image/png");
    expect(mimeOf(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe("image/jpeg");
    const webp = new Uint8Array(12);
    webp.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
    webp.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
    expect(mimeOf(webp)).toBe("image/webp");
    expect(mimeOf(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20]))).toBeNull(); // RIFF but AVI
    expect(mimeOf(new Uint8Array([0x47, 0x49, 0x46]))).toBeNull(); // GIF
    expect(mimeOf(new Uint8Array())).toBeNull();
  });
});

describe("toPng", () => {
  it("returns PNG bytes untouched and transcodes JPEG/WebP", async () => {
    const png = await encodePng(new Uint8Array(4 * 4 * 4).fill(200), { width: 4, height: 4 });
    expect(await toPng(png)).toBe(png);
    const jpeg = new Uint8Array(await sharp(png).jpeg().toBuffer());
    const webp = new Uint8Array(await sharp(png).webp().toBuffer());
    for (const src of [jpeg, webp]) {
      const out = await toPng(src);
      expect(mimeOf(out)).toBe("image/png");
      expect(await dimensions(out)).toEqual({ width: 4, height: 4 });
    }
  });
});

describe("downscale", () => {
  it("returns the same bytes when the longest side is within the cap", async () => {
    const png = await encodePng(new Uint8Array(8 * 4 * 4).fill(90), { width: 8, height: 4 });
    expect(await downscale(png, 8)).toBe(png);
    expect(await downscale(png, 512)).toBe(png);
  });
  it("shrinks a 2000×1000 PNG to 1536×768, aspect preserved, still PNG", async () => {
    const png = new Uint8Array(await sharp({ create: { width: 2000, height: 1000, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } } }).png().toBuffer());
    const out = await downscale(png, 1536);
    expect(mimeOf(out)).toBe("image/png");
    expect(await dimensions(out)).toEqual({ width: 1536, height: 768 });
  });
});

describe("letterboxTo", () => {
  async function red(width: number, height: number): Promise<Uint8Array> {
    const data = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) data.set([255, 0, 0, 255], i * 4);
    return encodePng(data, { width, height });
  }
  it("fits a portrait image into a landscape grid with neutral side bands and a mask over the real pixels only", async () => {
    const { png, mask } = await letterboxTo(await red(20, 40), { width: 40, height: 30 });
    expect(await dimensions(png)).toEqual({ width: 40, height: 30 });
    const { data } = await decodeRGBA(png);
    // 20×40 scaled by 0.75 → 15×30, centred: columns 12..26 are content.
    expect(Array.from(data.subarray((15 * 40 + 5) * 4, (15 * 40 + 5) * 4 + 3))).toEqual([128, 128, 128]);
    expect(Array.from(data.subarray((15 * 40 + 20) * 4, (15 * 40 + 20) * 4 + 3))).toEqual([255, 0, 0]);
    expect(mask).toHaveLength(40 * 30);
    expect(mask.reduce((a, b) => a + b, 0)).toBe(15 * 30);
    expect(mask[15 * 40 + 11]).toBe(0);
    expect(mask[15 * 40 + 12]).toBe(1);
    expect(mask[15 * 40 + 26]).toBe(1);
    expect(mask[15 * 40 + 27]).toBe(0);
  });
  it("marks the whole grid when the shapes already match, minus an optional inset", async () => {
    const full = await letterboxTo(await red(40, 30), { width: 40, height: 30 });
    expect(full.mask.every((v) => v === 1)).toBe(true);
    const { mask } = await letterboxTo(await red(40, 30), { width: 40, height: 30 }, 2);
    expect(mask.reduce((a, b) => a + b, 0)).toBe((40 - 4) * (30 - 4));
    expect(mask[2 * 40 + 1]).toBe(0);
    expect(mask[2 * 40 + 2]).toBe(1);
  });
});

describe("toRGBAAt", () => {
  it("decodes at the requested grid, and softens a hard edge only when a blur sigma is given", async () => {
    const w = 32;
    const data = new Uint8Array(w * w * 4);
    for (let i = 0; i < w * w; i++) data.set(i % w < 16 ? [0, 0, 0, 255] : [255, 255, 255, 255], i * 4);
    const png = await encodePng(data, { width: w, height: w });
    const sharpEdge = await toRGBAAt(png, { width: w, height: w });
    expect(sharpEdge).toHaveLength(w * w * 4);
    expect(sharpEdge[(8 * w + 15) * 4]).toBe(0);
    expect(sharpEdge[(8 * w + 16) * 4]).toBe(255);
    const soft = await toRGBAAt(png, { width: w, height: w }, 1.5);
    expect(soft[(8 * w + 15) * 4]).toBeGreaterThan(0);
    expect(soft[(8 * w + 16) * 4]).toBeLessThan(255);
    // Far from the edge the blur changes nothing.
    expect(soft[(8 * w + 2) * 4]).toBe(0);
    expect(soft[(8 * w + 29) * 4]).toBe(255);
  });
});
