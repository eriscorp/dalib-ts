import { describe, expect, it } from 'vitest';
import { JpfFile } from '../src/drawing/JpfFile.js';

describe('JpfFile', () => {
  it('strips the 4-byte JPF prefix and exposes the inner JPEG bytes', () => {
    const tail = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const buf = new Uint8Array(4 + tail.length);
    buf.set([0x4a, 0x50, 0x46, 0x00], 0);
    buf.set(tail, 4);

    const jpf = JpfFile.fromBuffer(buf);
    expect(Array.from(jpf.jpegBytes)).toEqual(Array.from(tail));
    expect(Array.from(jpf.toJpegBuffer())).toEqual(Array.from(tail));
  });

  it('throws on wrong magic', () => {
    const buf = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0xff, 0xd8]);
    expect(() => JpfFile.fromBuffer(buf)).toThrow(/Not a JPF file/);
  });

  it('throws on a buffer that cannot hold the prefix and a JPEG body', () => {
    expect(() => JpfFile.fromBuffer(new Uint8Array([0x4a, 0x50, 0x46, 0x00]))).toThrow(/too short/);
  });
});
