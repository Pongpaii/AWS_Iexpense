// สร้างไอคอน PWA/Android (PNG) แบบไม่ต้องพึ่ง library รูปภาพ
//   node scripts/generate-icons.mjs
// ภาพ: พื้นเขียวอมฟ้า + กราฟแท่ง 3 แท่ง + เส้นแนวโน้ม (สื่อ "กระแสเงิน")
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [15, 118, 110]; // #0f766e
const FG = [255, 255, 255];
const ACCENT = [253, 230, 138]; // #fde68a

function crc32(buf) {
  let c;
  const table = Array.from({ length: 256 }, (_, n) => {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** padding = สัดส่วนขอบ (maskable ต้องเว้น safe zone ~20%) */
function draw(size, { padding, rounded }) {
  const px = Buffer.alloc(size * size * 4);
  const r = rounded ? size * 0.22 : 0;
  const inRounded = (x, y) => {
    const cx = Math.min(Math.max(x, r), size - r);
    const cy = Math.min(Math.max(y, r), size - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  const inner = size * (1 - 2 * padding);
  const o = size * padding;
  const bars = [
    { x: 0.12, w: 0.2, h: 0.35 },
    { x: 0.4, w: 0.2, h: 0.55 },
    { x: 0.68, w: 0.2, h: 0.78 },
  ];
  const base = 0.88;
  // เส้นแนวโน้มจากซ้ายล่างไปขวาบน
  const line = (x) => base - 0.25 - x * 0.6;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      let color = BG;
      let alpha = 255;
      if (rounded && !inRounded(x, y)) alpha = 0;
      const u = (x - o) / inner;
      const v = (y - o) / inner;
      if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
        for (const b of bars) {
          if (u >= b.x && u <= b.x + b.w && v <= base && v >= base - b.h) color = FG;
        }
        if (u >= 0.08 && u <= 0.92 && Math.abs(v - line(u)) < 0.035) color = ACCENT;
      }
      px[i] = color[0];
      px[i + 1] = color[1];
      px[i + 2] = color[2];
      px[i + 3] = alpha;
    }
  }

  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = new URL('../web/public/icons/', import.meta.url);
mkdirSync(out, { recursive: true });
const files = {
  'icon-192.png': draw(192, { padding: 0.18, rounded: true }),
  'icon-512.png': draw(512, { padding: 0.18, rounded: true }),
  'maskable-512.png': draw(512, { padding: 0.26, rounded: false }),
  'apple-touch-icon-180.png': draw(180, { padding: 0.16, rounded: false }),
  'favicon-32.png': draw(32, { padding: 0.1, rounded: true }),
};
for (const [name, buf] of Object.entries(files)) {
  writeFileSync(new URL(name, out), buf);
  console.info(`${name} ${buf.length} bytes`);
}
