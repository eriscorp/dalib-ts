import { describe, expect, it } from 'vitest';
import { crc32 } from '../src/cryptography/CRC32.js';

const CHECK = new TextEncoder().encode('123456789');

describe('crc32', () => {
  it('matches the standard CRC-32 check value (finalXor on by default)', () => {
    // Canonical CRC-32/ISO-HDLC check value for "123456789".
    expect(crc32(CHECK) >>> 0).toBe(0xcbf43926);
  });

  it('omits the final inversion when finalXor is false (DA wire variant)', () => {
    // Non-inverting variant = bitwise-NOT of the standard result.
    expect(crc32(CHECK, 0, CHECK.length, false) >>> 0).toBe((~0xcbf43926) >>> 0);
  });

  it('honors offset and count', () => {
    const padded = new Uint8Array([0xaa, ...CHECK, 0xbb]);
    expect(crc32(padded, 1, CHECK.length) >>> 0).toBe(0xcbf43926);
  });
});
