import { describe, expect, it } from 'vitest';
import { crc16 } from '../src/cryptography/CRC16.js';

describe('crc16', () => {
  // The client does not use CRC-16/XMODEM. It generates the table from polynomial
  // 0x1021, starts at zero, applies no final XOR, and XORs the input byte AFTER the
  // table lookup rather than making it part of the index. That variant produces
  // 0xBEEF for "123456789"; XMODEM produces 0x31C3. This assertion is what stops a
  // future refactor from swapping in a stock CRC16.
  it('produces the check value 0xBEEF for "123456789"', () => {
    expect(crc16(new TextEncoder().encode('123456789'))).toBe(0xbeef);
    expect(crc16(new TextEncoder().encode('123456789'))).not.toBe(0x31c3);
  });

  it('returns 0 for an empty buffer', () => {
    expect(crc16(new Uint8Array(0))).toBe(0);
  });

  it('honours offset and count', () => {
    const padded = new Uint8Array([0xff, ...new TextEncoder().encode('123456789'), 0xff]);
    expect(crc16(padded, 1, 9)).toBe(0xbeef);
  });

  it('defaults count to the remainder of the buffer', () => {
    const bytes = new Uint8Array([0xaa, 1, 2, 3]);
    expect(crc16(bytes, 1)).toBe(crc16(bytes, 1, 3));
  });

  it('stays within 16 bits for a long buffer', () => {
    const big = new Uint8Array(1000).map((_, i) => i & 0xff);
    const result = crc16(big);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(0xffff);
  });

  it('is order sensitive', () => {
    expect(crc16(new Uint8Array([1, 2]))).not.toBe(crc16(new Uint8Array([2, 1])));
  });
});
