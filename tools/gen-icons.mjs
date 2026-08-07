// アイコン PNG を生成する。外部依存なし（node の zlib だけで PNG を書き出す）。
//   node git-quest/tools/gen-icons.mjs
//
// 絵柄: 暗い背景に、コミットグラフの「枝分かれして合流する」形。

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');

const BG = [13, 17, 23];      // --bg
const BLUE = [88, 166, 255];  // --accent
const GREEN = [63, 185, 80];  // --green
const PURPLE = [188, 140, 255];

// ---------------------------------------------------------------- PNG 書き出し

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** RGBA のピクセル配列（Uint8Array, 幅*高さ*4）を PNG バッファに。 */
function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // フィルタ種別 None
    rgba.copy
      ? rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
      : Buffer.from(rgba.subarray(y * width * 4, (y + 1) * width * 4)).copy(
          raw,
          y * (width * 4 + 1) + 1
        );
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- 描画

function makeCanvas(size) {
  const px = Buffer.alloc(size * size * 4);
  return {
    size,
    px,
    set(x, y, [r, g, b], a = 1) {
      if (x < 0 || y < 0 || x >= size || y >= size || a <= 0) return;
      const i = (Math.floor(y) * size + Math.floor(x)) * 4;
      const src = [r, g, b];
      for (let k = 0; k < 3; k++) px[i + k] = Math.round(px[i + k] * (1 - a) + src[k] * a);
      px[i + 3] = Math.round(Math.min(255, px[i + 3] + a * 255));
    },
    fill(color) {
      for (let i = 0; i < size * size; i++) {
        px[i * 4] = color[0];
        px[i * 4 + 1] = color[1];
        px[i * 4 + 2] = color[2];
        px[i * 4 + 3] = 255;
      }
    },
  };
}

/** アンチエイリアス付きの円。 */
function disc(c, cx, cy, r, color) {
  for (let y = Math.floor(cy - r - 2); y <= cy + r + 2; y++) {
    for (let x = Math.floor(cx - r - 2); x <= cx + r + 2; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const a = Math.max(0, Math.min(1, r + 0.5 - d));
      if (a > 0) c.set(x, y, color, a);
    }
  }
}

/** 太さのある線分。 */
function line(c, x1, y1, x2, y2, w, color) {
  const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 2);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    disc(c, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, w / 2, color);
  }
}

/** 2次ベジエ（枝の膨らみ用）。 */
function curve(c, x1, y1, cx, cy, x2, y2, w, color) {
  const steps = 160;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const x = mt * mt * x1 + 2 * mt * t * cx + t * t * x2;
    const y = mt * mt * y1 + 2 * mt * t * cy + t * t * y2;
    disc(c, x, y, w / 2, color);
  }
}

/**
 * アイコンの絵柄を描く。
 * @param {number} size
 * @param {number} inset 内側の余白の割合（maskable 用に中身を小さくする）
 */
function drawIcon(size, inset = 0) {
  const c = makeCanvas(size);
  c.fill(BG);

  const s = size;
  const pad = s * (0.2 + inset);
  const top = pad;
  const bottom = s - pad;
  const mainX = s * 0.36;
  const branchX = s * 0.66;
  const w = s * 0.062;
  const r = s * 0.072;

  // main の縦線
  line(c, mainX, top, mainX, bottom, w, BLUE);

  // 枝分かれ → 合流
  const y1 = top + (bottom - top) * 0.3;
  const y2 = top + (bottom - top) * 0.72;
  curve(c, mainX, y1, branchX, y1 + (y2 - y1) * 0.18, branchX, (y1 + y2) / 2, w, GREEN);
  curve(c, branchX, (y1 + y2) / 2, branchX, y2 - (y2 - y1) * 0.18, mainX, y2, w, GREEN);

  // コミットの丸
  disc(c, mainX, top, r, BLUE);
  disc(c, mainX, y1, r, BLUE);
  disc(c, mainX, y2, r, PURPLE); // マージコミット
  disc(c, mainX, bottom, r, BLUE);
  disc(c, branchX, (y1 + y2) / 2, r, GREEN);

  // マージコミットは中抜きに（アプリ内のグラフと同じ約束）
  disc(c, mainX, y2, r * 0.42, BG);

  return encodePng(size, size, c.px);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'icon-192.png'), drawIcon(192));
writeFileSync(join(OUT_DIR, 'icon-512.png'), drawIcon(512));
// maskable は端が丸く切られるので、中身を一回り小さく描く
writeFileSync(join(OUT_DIR, 'icon-maskable-512.png'), drawIcon(512, 0.07));

console.log('icons/ に 3 つの PNG を書き出しました');
