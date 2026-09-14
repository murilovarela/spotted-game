import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { dimensions, downscale, encodePng, mimeOf, toPng } from "../images";

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
