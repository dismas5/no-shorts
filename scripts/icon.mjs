import { deflateSync } from 'node:zlib';
function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}
function chunk(type, bytes) {
  const name = Buffer.from(type), out = Buffer.alloc(bytes.length + 12);
  out.writeUInt32BE(bytes.length); name.copy(out, 4); bytes.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([name, bytes])), bytes.length + 8); return out;
}
// Rasterize the simple, source-controlled vector mark without a build-time graphics dependency.
export function icon(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = x / size * 96, dy = y / size * 96;
    const t = Math.max(0, Math.min(1, ((dx - 62) * -28 + (dy - 21) * 54) / (28 * 28 + 54 * 54)));
    const white = Math.hypot(dx - (62 - 28 * t), dy - (21 + 54 * t)) <= 6;
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    raw.set(white ? [255, 255, 255, 255] : [28, 96, 70, 255], offset);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
