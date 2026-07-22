import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DataArchive } from '../src/data/DataArchive.js';
import {
  SotpDirection,
  SotpFile,
  SOTP_EMPTY_TILE_ID,
} from '../src/data/SotpFile.js';

describe('SotpFile', () => {
  it('maps file byte 0 to static tile ID 1', () => {
    const sotp = SotpFile.fromBuffer(new Uint8Array([0x0f, 0x00, 0x80]));
    expect(sotp.getFlags(1)).toBe(0x0f);
    expect(sotp.getFlags(2)).toBe(0x00);
    expect(sotp.getFlags(3)).toBe(0x80);
  });

  it('splits the byte into collision (low) and render (high) nibbles', () => {
    const sotp = SotpFile.fromBuffer(new Uint8Array([0x8f]));
    expect(sotp.getCollision(1)).toBe(0x0f);
    expect(sotp.getRenderFlags(1)).toBe(0x80);
    expect(sotp.isOverPlayer(1)).toBe(true);
  });

  it('decodes per-direction collision bits', () => {
    // 0x05 = left | right.
    const sotp = SotpFile.fromBuffer(new Uint8Array([0x05]));
    expect(sotp.blocksMovement(1, SotpDirection.Left)).toBe(true);
    expect(sotp.blocksMovement(1, SotpDirection.Right)).toBe(true);
    expect(sotp.blocksMovement(1, SotpDirection.Down)).toBe(false);
    expect(sotp.blocksMovement(1, SotpDirection.Up)).toBe(false);
    expect(sotp.canMove(1, SotpDirection.Up)).toBe(true);
  });

  it('treats the 0x2710 sentinel and out-of-range IDs as empty', () => {
    const sotp = SotpFile.fromBuffer(new Uint8Array([0x0f, 0x0f]));
    expect(sotp.getFlags(SOTP_EMPTY_TILE_ID)).toBe(0);
    expect(sotp.getFlags(0)).toBe(0); // no ID 0
    expect(sotp.getFlags(3)).toBe(0); // past the end
    expect(sotp.maxTileId).toBe(2);
  });

  // Real-client assertion: the doc records exact byte counts for this file. Runs only
  // where the client is installed; skipped in CI so no binary asset is committed.
  const clientRoot = 'e:/games/dark ages';
  const iaDat = `${clientRoot}/ia.dat`;
  describe.skipIf(!existsSync(iaDat))('against the installed ia.dat', () => {
    it('matches the documented size and byte histogram', () => {
      const buf = readFileSync(iaDat);
      const archive = DataArchive.fromBuffer(
        new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
      );
      const sotp = SotpFile.fromArchive(archive);

      expect(sotp.maxTileId).toBe(20423);

      const hist = new Map<number, number>();
      for (const b of sotp.data) hist.set(b, (hist.get(b) ?? 0) + 1);
      expect(hist.get(0x00)).toBe(4265);
      expect(hist.get(0x0f)).toBe(15782);
      expect(hist.get(0x80)).toBe(322);
      expect(hist.get(0x8f)).toBe(54);
      // Exactly those four values appear.
      expect([...hist.keys()].sort((a, b) => a - b)).toEqual([0x00, 0x0f, 0x80, 0x8f]);
    });
  });
});
