// Generates build/icon.png (1024×1024) — the app icon used by electron-builder for Windows/macOS.
// Pure Node (zlib) so it needs no image libraries:  node scripts/make-icon.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { projectRoot } from './launch.mjs';

const N = 1024;
const SS = 3; // supersampling per axis
const px = new Float64Array(N * N * 4);

const bg = [57, 135, 229]; // --accent
const fg = [255, 255, 255];
const radius = 0.22; // corner radius (fraction of size)

// Trace curve from the SVG logo (viewBox 32): M5 21 C 9 21, 10 9, 14 9 S 18 23, 22 23 S 25 13, 27 11
const segs = [
  [[5, 21], [9, 21], [10, 9], [14, 9]],
  [[14, 9], [18, 9], [18, 23], [22, 23]],
  [[22, 23], [26, 23], [25, 13], [27, 11]],
];
const pts = [];
for (const [a, b, c, d] of segs)
  for (let i = 0; i <= 200; i++) {
    const t = i / 200,
      u = 1 - t;
    pts.push([
      u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0],
      u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1],
    ]);
  }
const stroke = 2.6 / 2;

function inRoundedSquare(x, y) {
  const m = 0.03,
    r = radius;
  const cx = Math.min(Math.max(x, m + r), 1 - m - r);
  const cy = Math.min(Math.max(y, m + r), 1 - m - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r && x >= m && x <= 1 - m && y >= m && y <= 1 - m;
}
function onCurve(x, y) {
  const X = x * 32,
    Y = y * 32;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1],
      [bx, by] = pts[i];
    const dx = bx - ax,
      dy = by - ay;
    const t = Math.max(0, Math.min(1, ((X - ax) * dx + (Y - ay) * dy) / (dx * dx + dy * dy || 1)));
    if ((X - ax - t * dx) ** 2 + (Y - ay - t * dy) ** 2 <= stroke * stroke) return true;
  }
  return false;
}

for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    let r = 0,
      g = 0,
      b = 0,
      a = 0;
    for (let sy = 0; sy < SS; sy++)
      for (let sx = 0; sx < SS; sx++) {
        const u = (x + (sx + 0.5) / SS) / N;
        const v = (y + (sy + 0.5) / SS) / N;
        if (!inRoundedSquare(u, v)) continue;
        const c = onCurve(u, v) ? fg : bg;
        r += c[0];
        g += c[1];
        b += c[2];
        a += 255;
      }
    const k = SS * SS;
    const o = (y * N + x) * 4;
    px[o] = a ? r / (a / 255) : 0;
    px[o + 1] = a ? g / (a / 255) : 0;
    px[o + 2] = a ? b / (a / 255) : 0;
    px[o + 3] = a / k;
  }
}

// PNG encode (RGBA, 8-bit).
const raw = Buffer.alloc((N * 4 + 1) * N);
for (let y = 0; y < N; y++) {
  raw[y * (N * 4 + 1)] = 0;
  for (let x = 0; x < N * 4; x++) raw[y * (N * 4 + 1) + 1 + x] = Math.round(px[y * N * 4 + x]);
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0);
ihdr.writeUInt32BE(N, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
const out = path.join(projectRoot, 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log('wrote', out, png.length, 'bytes');
