import type { RgbaFrame } from '../constants.js';
import { crc32 } from '../cryptography/CRC32.js';
import { nodeZlib } from './nodeBuiltins.js';

const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  // The CRC covers the type and the data, not the length.
  view.setUint32(8 + data.length, crc32(out, 4, 4 + data.length));
  return out;
}

/**
 * Encode an {@link RgbaFrame} as a PNG: 8-bit RGBA, no interlace, filter type 0
 * on every row, one IDAT chunk. The pixels are written as they are: straight
 * alpha, which is what the render functions give by default.
 *
 * **Node.js only** — it deflates with `node:zlib` and throws in a browser.
 * In a browser, draw the frame to a canvas (`helpers/imageData`) and use the
 * canvas's own encoder.
 */
export function encodePng(frame: RgbaFrame): Uint8Array {
  const { width, height, data } = frame;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`encodePng: the frame must be at least 1x1, not ${width}x${height}`);
  }
  if (data.length !== width * height * 4) {
    throw new Error(`encodePng: ${data.length} bytes is not ${width}x${height} RGBA`);
  }

  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  // compression, filter and interlace stay 0

  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type: none
    raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const compressed = new Uint8Array(nodeZlib().deflateSync(raw));

  const parts = [SIGNATURE, chunk('IHDR', header), chunk('IDAT', compressed), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
