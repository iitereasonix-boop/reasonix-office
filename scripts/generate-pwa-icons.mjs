// توليد أيقونات PWA من شعار reasonix-mark.png (أو أيقونة السمة) بمقاسات قياسية.
// يعمل بلا أي حزم خارجية: يقرأ SVG/بيانات البكسل ويرسم يدوياً.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public", "icons");
fs.mkdirSync(outDir, { recursive: true });

// ألوان الهوية: خلفية داكنة + ذهبي
const BG = [11, 21, 38]; // #0b1526
const GOLD = [224, 186, 114]; // #e0ba72

function pngEncode(width, height, pixels) {
  // pixels: RGBA buffer
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter none
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const chunks = [];
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const t = Buffer.from(type, "ascii");
    const crcBuf = Buffer.concat([t, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(crcBuf) >>> 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  chunks.push(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  chunks.push(chunk("IHDR", ihdr));
  chunks.push(chunk("IDAT", idat));
  chunks.push(chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

let crcTable;
function crc32(buf) {
  if (!crcTable) {
    crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// رسم أيقونة "ميزان" (شعار ريزونكس) على خلفية داكنة بزوايا دائرية.
function drawIcon(size, { maskable = false } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const r = maskable ? 0 : size * 0.22; // نصف قطر الزوايا
  const pad = maskable ? size * 0.2 : size * 0.1; // هامش الأمان للـ maskable
  const cx = size / 2;
  const top = pad + size * 0.12;
  const bottom = size - pad - size * 0.06;
  const halfW = (size - 2 * pad) * 0.34;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // خلفية بزوايا دائرية (شفافة خارجها)
      if (!maskable && r > 0) {
        const dx = Math.max(r - x, 0, x - (size - 1 - r));
        const dy = Math.max(r - y, 0, y - (size - 1 - r));
        if (dx * dx + dy * dy > r * r) {
          px[i + 3] = 0;
          continue;
        }
      }
      px[i] = BG[0];
      px[i + 1] = BG[1];
      px[i + 2] = BG[2];
      px[i + 3] = 255;

      const gx = x - cx;
      const gy = y;
      let gold = false;
      // العمود الأوسط
      if (Math.abs(gx) <= size * 0.012 && gy >= top && gy <= bottom) gold = true;
      // القاعدة
      if (gy >= bottom - size * 0.015 && gy <= bottom && Math.abs(gx) <= halfW * 0.75) gold = true;
      // الكفتة العلوية
      if (gy >= top && gy <= top + size * 0.02 && Math.abs(gx) <= halfW * 0.85) gold = true;
      // خيوط السلاسل
      const armTop = top + size * 0.06;
      if ((gy >= armTop && gy <= bottom) && (Math.abs(gx - halfW) <= size * 0.012 || Math.abs(gx + halfW) <= size * 0.012)) gold = true;
      // الكفتة الأفقية العلوية
      if (gy >= armTop - size * 0.02 && gy <= armTop && Math.abs(gx) <= halfW * 1.15) gold = true;
      // الكفتتان السفلية (مثلثات)
      const triW = halfW * 0.75;
      const triTop = armTop + size * 0.02;
      const triBot = bottom - size * 0.08;
      for (const s of [-1, 1]) {
        const ax = gx - s * halfW;
        if (gy >= triTop && gy <= triBot && Math.abs(ax) <= triW * (0.15 + 0.85 * ((gy - triTop) / (triBot - triTop)))) gold = true;
      }
      if (gold) {
        px[i] = GOLD[0];
        px[i + 1] = GOLD[1];
        px[i + 2] = GOLD[2];
      }
    }
  }
  return px;
}

const targets = [
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
  { file: "maskable-192.png", size: 192, maskable: true },
  { file: "maskable-512.png", size: 512, maskable: true },
  { file: "apple-touch-icon.png", size: 180 }, // Apple: بلا شفافية، زوايا ممتلئة
];
for (const t of targets) {
  const buf = pngEncode(t.size, t.size, drawIcon(t.size, { maskable: t.maskable ?? false }));
  fs.writeFileSync(path.join(outDir, t.file), buf);
  console.log("✓", t.file, buf.length, "bytes");
}
// نسخة apple-touch بزوايا ممتلئة (الخلفية تصل للحواف)
const apple = pngEncode(180, 180, drawIcon(180, { maskable: true }));
fs.writeFileSync(path.join(outDir, "apple-touch-icon.png"), apple);
console.log("✓ apple-touch-icon.png rewritten (full-bleed)");
