import { describe, expect, it } from 'vitest';
import { buildArchive } from './archiveFixture.js';
import { JpfFile } from '../src/drawing/JpfFile.js';

/** A JPF whose body is a short but well-formed JFIF preamble. */
function jpfBytes(): Uint8Array {
  const body = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46];
  return new Uint8Array([0x4a, 0x50, 0x46, 0x00, ...body]);
}

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

  it('accepts an ArrayBuffer', () => {
    const bytes = jpfBytes();
    const copy = new Uint8Array(bytes);
    expect(JpfFile.fromBuffer(copy.buffer as ArrayBuffer).jpegBytes[0]).toBe(0xff);
  });

  it('reads from an archive entry', () => {
    const archive = buildArchive([{ name: 'splash.jpf', data: jpfBytes() }]);
    const jpf = JpfFile.fromEntry(archive.get('splash.jpf')!);
    expect(jpf.jpegBytes).toHaveLength(10);
  });

  it('appends the extension when the caller omits it', () => {
    const archive = buildArchive([{ name: 'splash.jpf', data: jpfBytes() }]);
    expect(JpfFile.fromArchive('splash', archive).jpegBytes[0]).toBe(0xff);
    expect(JpfFile.fromArchive('splash.jpf', archive).jpegBytes[0]).toBe(0xff);
  });

  it('throws when the entry is missing', () => {
    expect(() => JpfFile.fromArchive('nope', buildArchive([]))).toThrow(/not found/);
  });
});
