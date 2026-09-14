#!/usr/bin/env node
// Regenerates the committed fixture PNGs from objects.json. Run once: node src/db/seed/fixtures/make.mjs
// Pure Node PNG writer (8-bit RGB, no filter) so the seed has no image dependency.
import { crc32, deflateSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(readFileSync(join(here, "objects.json"), "utf8"));
const { width: W, height: H } = spec.image;
const OBJ = 96; // object sprite size in px

function png(w, h, px) {
  const stride = w * 3 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = px(x, y);
      const o = y * stride + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // bit depth, colour type RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Background: soft gradient with a faint grid so drags are visually anchored.
const background = (x, y) => {
  const grid = x % 64 === 0 || y % 64 === 0 ? -18 : 0;
  return [Math.round(200 + 40 * (x / W)) + grid, Math.round(210 - 40 * (y / H)) + grid, 230 + grid];
};

// Sprite pixel test, in sprite-local coords (0..OBJ). Returns true when inside the shape.
function inside(shape, lx, ly) {
  const c = OBJ / 2;
  const dx = lx - c, dy = ly - c;
  if (shape === "circle") return dx * dx + dy * dy <= (c - 4) * (c - 4);
  if (shape === "square") return Math.abs(dx) <= c - 8 && Math.abs(dy) <= c - 8;
  // triangle: apex at top centre
  return ly >= 8 && ly <= OBJ - 8 && Math.abs(dx) <= (ly - 8) / 2;
}

for (const o of spec.objects) {
  writeFileSync(join(here, o.file), png(OBJ, OBJ, (x, y) => (inside(o.shape, x, y) ? o.color : [255, 255, 255])));
}
writeFileSync(join(here, "background.png"), png(W, H, background));
writeFileSync(
  join(here, "generated.png"),
  png(W, H, (x, y) => {
    for (const o of spec.objects) {
      const lx = x - Math.round(o.x * W - OBJ / 2);
      const ly = y - Math.round(o.y * H - OBJ / 2);
      if (lx >= 0 && lx < OBJ && ly >= 0 && ly < OBJ && inside(o.shape, lx, ly)) return o.color;
    }
    return background(x, y);
  }),
);
console.log("fixtures written");
