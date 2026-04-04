import { describe, expect, it } from 'vitest';
import { compressHpf, decompressHpf, isHpfCompressed } from '../src/io/Compression.js';
import { crc32 } from '../src/cryptography/CRC32.js';

// HPF signature bytes: [0x55, 0xAA, 0x02, 0xFF]
const HPF_SIGNATURE = new Uint8Array([0x55, 0xaa, 0x02, 0xff]);

describe('HPF Compression', () => {
  it('round-trip: compress then decompress preserves data', () => {
    const original = new Uint8Array(Array.from({ length: 256 }, (_, i) => i % 256));
    const compressed = compressHpf(original);
    const decompressed = decompressHpf(compressed);

    expect(decompressed).toEqual(original);
  });

  it('compressHpf produces correct 4-byte header signature', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const compressed = compressHpf(data);

    expect(compressed[0]).toBe(0x55);
    expect(compressed[1]).toBe(0xaa);
    expect(compressed[2]).toBe(0x02);
    expect(compressed[3]).toBe(0xff);
  });

  it('isHpfCompressed detects the signature', () => {
    const withSig = new Uint8Array([0x55, 0xaa, 0x02, 0xff, 0x00]);
    const withoutSig = new Uint8Array([0x00, 0x01, 0x02, 0x03]);

    expect(isHpfCompressed(withSig)).toBe(true);
    expect(isHpfCompressed(withoutSig)).toBe(false);
  });

  it('isHpfCompressed returns false for buffers shorter than 4 bytes', () => {
    expect(isHpfCompressed(new Uint8Array([0x55, 0xaa]))).toBe(false);
    expect(isHpfCompressed(new Uint8Array([]))).toBe(false);
  });

  it('compressed output is smaller than large repetitive input', () => {
    // Highly compressible data: all zeros
    const data = new Uint8Array(1024);
    const compressed = compressHpf(data);
    expect(compressed.length).toBeLessThan(data.length);
  });

  it('empty data compresses and round-trips correctly', () => {
    const empty = new Uint8Array(0);
    const compressed = compressHpf(empty);
    const decompressed = decompressHpf(compressed);
    expect(decompressed.length).toBe(0);
  });

  it('large data round-trip with CRC32 validation', () => {
    const original = new Uint8Array(10 * 1024);
    for (let i = 0; i < original.length; i++) {
      original[i] = (i * 37 + 13) & 0xff;
    }
    const originalCrc = crc32(original);

    const compressed = compressHpf(original);
    const decompressed = decompressHpf(compressed);
    const decompressedCrc = crc32(decompressed);

    expect(decompressedCrc).toBe(originalCrc);
    expect(decompressed).toEqual(original);
  });

  it('random byte data round-trips correctly', () => {
    // Simulate random-ish data (harder to compress, but should still round-trip)
    const data = new Uint8Array(512);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.sin(i * 1.7) * 127 + 128) & 0xff;
    }
    const compressed = compressHpf(data);
    const decompressed = decompressHpf(compressed);
    expect(decompressed).toEqual(data);
  });
});
