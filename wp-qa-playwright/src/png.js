// Minimal PNG encoder/decoder using node:zlib. Supports 8-bit RGB/RGBA,
// non-interlaced — exactly what Playwright screenshots and our report need.
import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Encode {width, height, data: Buffer of RGBA bytes} into a PNG buffer. */
export function encodePng({ width, height, data }) {
  if (!width || !height || !data || data.length < width * height * 4) {
    throw new Error('encodePng: need width, height and RGBA data of width*height*4 bytes');
  }
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: None
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Decode a PNG buffer (8-bit RGB/RGBA, non-interlaced) into {width, height, data: RGBA}. */
export function decodePng(buf) {
  if (!Buffer.isBuffer(buf) || !buf.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error('decodePng: not a PNG buffer');
  }
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || data[12] !== 0) {
        throw new Error(`decodePng: unsupported PNG (bitDepth=${bitDepth}, colorType=${colorType}, interlace=${data[12]})`);
      }
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  const prev = Buffer.alloc(stride);
  const cur = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    raw.copy(cur, 0, y * (stride + 1) + 1, (y + 1) * (stride + 1));
    unfilterRow(cur, prev, filter, channels);
    for (let x = 0; x < width; x++) {
      const s = x * channels;
      const d = (y * width + x) * 4;
      out[d] = cur[s];
      out[d + 1] = cur[s + 1];
      out[d + 2] = cur[s + 2];
      out[d + 3] = channels === 4 ? cur[s + 3] : 255;
    }
    cur.copy(prev);
  }
  return { width, height, data: out };
}

function unfilterRow(cur, prev, filter, bpp) {
  const len = cur.length;
  switch (filter) {
    case 0:
      return;
    case 1: // Sub
      for (let i = bpp; i < len; i++) cur[i] = (cur[i] + cur[i - bpp]) & 0xff;
      return;
    case 2: // Up
      for (let i = 0; i < len; i++) cur[i] = (cur[i] + prev[i]) & 0xff;
      return;
    case 3: // Average
      for (let i = 0; i < len; i++) {
        const left = i >= bpp ? cur[i - bpp] : 0;
        cur[i] = (cur[i] + ((left + prev[i]) >> 1)) & 0xff;
      }
      return;
    case 4: // Paeth
      for (let i = 0; i < len; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        cur[i] = (cur[i] + pred) & 0xff;
      }
      return;
    default:
      throw new Error(`decodePng: unknown filter type ${filter}`);
  }
}
