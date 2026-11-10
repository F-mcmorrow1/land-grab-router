// Draws the app icons (concentric hexagons) as PNGs with no dependencies.
// Run: node scripts/make-icons.mjs
import { writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";

const BG = [0x11, 0x11, 0x12];
const LIME = [0xd2, 0xff, 0x00];

/** Inside a flat-topped hexagon of circumradius r centred on 0,0? */
const inHex = (x, y, r) => Math.abs(x) <= r && Math.abs(y) <= (r * Math.sqrt(3)) / 2 && Math.sqrt(3) * Math.abs(x) + Math.abs(y) <= Math.sqrt(3) * r;

function draw(size, scale) {
  const R = size * scale;
  const rings = [R, R * 0.66, R * 0.44]; // lime, gap, lime
  const px = Buffer.alloc(size * size * 4);
  const ss = 4; // 4x4 supersampling for smooth edges
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let lime = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const dx = x + (sx + 0.5) / ss - size / 2;
          const dy = y + (sy + 0.5) / ss - size / 2;
          const depth = rings.filter((r) => inHex(dx, dy, r)).length;
          if (depth % 2 === 1) lime++;
        }
      }
      const a = lime / (ss * ss);
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) px[i + c] = Math.round(BG[c] + (LIME[c] - BG[c]) * a);
      px[i + 3] = 255;
    }
  }
  return png(size, px);
}

function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const out = new URL("../public/icons/", import.meta.url);
writeFileSync(new URL("icon-192.png", out), draw(192, 0.4));
writeFileSync(new URL("icon-512.png", out), draw(512, 0.4));
writeFileSync(new URL("apple-touch-icon.png", out), draw(180, 0.36));
// Maskable icons get cropped to a circle; keep the design inside the middle 80%.
writeFileSync(new URL("icon-maskable-512.png", out), draw(512, 0.3));
console.log("icons written");
