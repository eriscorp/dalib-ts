import { describe, expect, it } from 'vitest';
import { MpfFile } from '../src/drawing/MpfFile.js';
import { MpfFormatType, MpfIdleType } from '../src/enums.js';
import { SpanWriter } from '../src/io/SpanWriter.js';

interface FrameSpec {
  left: number;
  top: number;
  right: number;
  bottom: number;
  centerX?: number;
  centerY?: number;
  data: Uint8Array;
}

interface MpfHeaderSpec {
  walkFrameIndex?: number;
  walkFrameCount?: number;
  standingFrameIndex?: number;
  standingFrameCount?: number;
  optionalAnimationFrameCount?: number;
  rawOptionalAnimationRatio?: number;
  attackFrameIndex?: number;
  attackFrameCount?: number;
  attack2StartIndex?: number;
  attack2FrameCount?: number;
  attack3StartIndex?: number;
  attack3FrameCount?: number;
  paletteNumber?: number;
}

/**
 * Build a MultipleAttacks MPF with `None` header variant.
 * Layout: headerByte=0 sentinel (MpfHeaderType.None) → seek back 4, then:
 *   frameCount(u8) pixelW(i16) pixelH(i16) dataLen(i32)
 *   walkIdx(u8) walkCnt(u8) formatType(i16=-1)
 *   standIdx(u8) standCnt(u8) optCnt(u8) rawRatio(u8)
 *   atk(u8) atkCnt(u8) atk2Idx(u8) atk2Cnt(u8) atk3Idx(u8) atk3Cnt(u8)
 *   per-frame 16 bytes × (N real + 1 palette marker)
 *   palette marker: 12× 0xFF + paletteNumber(i32)
 *   data blob
 */
function buildMultipleAttacksMpf(frames: FrameSpec[], hdr: MpfHeaderSpec = {}): Uint8Array {
  const writer = new SpanWriter();

  // HeaderType.None — wire has no MpfHeaderType.Unknown marker; parse() expects 4 bytes here
  // that are actually the start of (frameCount + pixelW + pixelH) word. Since parse() seeks back
  // 4 when headerType !== Unknown, we simply begin writing the normal header at offset 0.
  const pixelWidth = Math.max(0, ...frames.map(f => f.right));
  const pixelHeight = Math.max(0, ...frames.map(f => f.bottom));

  const realFrameCount = frames.length;
  const onDiskFrameCount = realFrameCount + 1; // +1 for palette sentinel
  const dataLength = frames.reduce((sum, f) => sum + f.data.length, 0);

  writer.writeUInt8(onDiskFrameCount);
  writer.writeInt16LE(pixelWidth);
  writer.writeInt16LE(pixelHeight);
  writer.writeInt32LE(dataLength);

  writer.writeUInt8(hdr.walkFrameIndex ?? 0);
  writer.writeUInt8(hdr.walkFrameCount ?? 0);
  writer.writeInt16LE(MpfFormatType.MultipleAttacks);
  writer.writeUInt8(hdr.standingFrameIndex ?? 0);
  writer.writeUInt8(hdr.standingFrameCount ?? 0);
  writer.writeUInt8(hdr.optionalAnimationFrameCount ?? 0);
  writer.writeUInt8(hdr.rawOptionalAnimationRatio ?? 0);
  writer.writeUInt8(hdr.attackFrameIndex ?? 0);
  writer.writeUInt8(hdr.attackFrameCount ?? 0);
  writer.writeUInt8(hdr.attack2StartIndex ?? 0);
  writer.writeUInt8(hdr.attack2FrameCount ?? 0);
  writer.writeUInt8(hdr.attack3StartIndex ?? 0);
  writer.writeUInt8(hdr.attack3FrameCount ?? 0);

  // Frame entries
  let startAddress = 0;
  for (const f of frames) {
    writer.writeInt16LE(f.left);
    writer.writeInt16LE(f.top);
    writer.writeInt16LE(f.right);
    writer.writeInt16LE(f.bottom);
    writer.writeInt16LE(f.centerX ?? 0);
    writer.writeInt16LE(f.centerY ?? 0);
    writer.writeInt32LE(startAddress);
    startAddress += f.data.length;
  }

  // Palette sentinel: 12× 0xFF + paletteNumber
  for (let i = 0; i < 12; i++) writer.writeUInt8(0xff);
  writer.writeInt32LE(hdr.paletteNumber ?? 0);

  // Data blob
  for (const f of frames) writer.writeBytes(f.data);

  return writer.toUint8Array();
}

function oneFrame(width = 4, height = 4): FrameSpec {
  return { left: 0, top: 0, right: width, bottom: height, data: new Uint8Array(width * height) };
}

describe('MpfFile', () => {
  describe('detectIdleType', () => {
    it('returns StaticNoIdle when optional frame count is 0', () => {
      expect(MpfFile.detectIdleType(0, 0)).toBe(MpfIdleType.StaticNoIdle);
      expect(MpfFile.detectIdleType(3, 0)).toBe(MpfIdleType.StaticNoIdle);
    });

    it('returns NormalIdle when standing count is 0 or matches optional count', () => {
      expect(MpfFile.detectIdleType(0, 4)).toBe(MpfIdleType.NormalIdle);
      expect(MpfFile.detectIdleType(5, 5)).toBe(MpfIdleType.NormalIdle);
    });

    it('returns NormalPlusOptional when standing and optional counts differ', () => {
      expect(MpfFile.detectIdleType(3, 5)).toBe(MpfIdleType.NormalPlusOptional);
      expect(MpfFile.detectIdleType(1, 2)).toBe(MpfIdleType.NormalPlusOptional);
    });
  });

  describe('parse → serialize', () => {
    it('decodes StaticNoIdle: raw byte → animationIntervalMs = 10000', () => {
      const buf = buildMultipleAttacksMpf([oneFrame()], {
        standingFrameCount: 0,
        optionalAnimationFrameCount: 0,
        rawOptionalAnimationRatio: 0,
      });
      const mpf = MpfFile.fromBuffer(buf);

      expect(mpf.idleType).toBe(MpfIdleType.StaticNoIdle);
      expect(mpf.animationIntervalMs).toBe(10_000);
      expect(mpf.optionalAnimationProbability).toBe(0);
    });

    it('decodes NormalIdle: raw byte → animationIntervalMs = raw * 100 (floor 100ms)', () => {
      const buf = buildMultipleAttacksMpf([oneFrame()], {
        standingFrameCount: 4,
        optionalAnimationFrameCount: 4,
        rawOptionalAnimationRatio: 5,
      });
      const mpf = MpfFile.fromBuffer(buf);

      expect(mpf.idleType).toBe(MpfIdleType.NormalIdle);
      expect(mpf.animationIntervalMs).toBe(500);
    });

    it('NormalIdle with raw=0 normalizes to 300ms default', () => {
      const buf = buildMultipleAttacksMpf([oneFrame()], {
        standingFrameCount: 4,
        optionalAnimationFrameCount: 4,
        rawOptionalAnimationRatio: 0,
      });
      const mpf = MpfFile.fromBuffer(buf);

      expect(mpf.idleType).toBe(MpfIdleType.NormalIdle);
      expect(mpf.animationIntervalMs).toBe(300);
    });

    it('decodes NormalPlusOptional: raw byte → probability, interval = 300ms default', () => {
      const buf = buildMultipleAttacksMpf([oneFrame()], {
        standingFrameCount: 2,
        optionalAnimationFrameCount: 5,
        rawOptionalAnimationRatio: 128,
      });
      const mpf = MpfFile.fromBuffer(buf);

      expect(mpf.idleType).toBe(MpfIdleType.NormalPlusOptional);
      expect(mpf.animationIntervalMs).toBe(300);
      expect(mpf.optionalAnimationProbability).toBe(128);
    });

    it('NormalIdle round-trips raw non-zero ratio byte-identically', () => {
      const raw = 3;
      const buf = buildMultipleAttacksMpf([oneFrame()], {
        standingFrameCount: 4,
        optionalAnimationFrameCount: 4,
        rawOptionalAnimationRatio: raw,
      });
      const mpf = MpfFile.fromBuffer(buf);
      const reparsed = MpfFile.fromBuffer(mpf.toUint8Array());

      expect(reparsed.animationIntervalMs).toBe(raw * 100);
    });

    it('NormalPlusOptional round-trips probability byte-identically', () => {
      const buf = buildMultipleAttacksMpf([oneFrame()], {
        standingFrameCount: 2,
        optionalAnimationFrameCount: 5,
        rawOptionalAnimationRatio: 200,
      });
      const mpf = MpfFile.fromBuffer(buf);
      const reparsed = MpfFile.fromBuffer(mpf.toUint8Array());

      expect(reparsed.optionalAnimationProbability).toBe(200);
    });

    it('preserves paletteNumber and frame geometry', () => {
      const frame: FrameSpec = { left: 1, top: 2, right: 5, bottom: 6, centerX: 3, centerY: 4, data: new Uint8Array(16) };
      const buf = buildMultipleAttacksMpf([frame], { paletteNumber: 1234 });
      const mpf = MpfFile.fromBuffer(buf);

      expect(mpf.paletteNumber).toBe(1234);
      expect(mpf.frames.length).toBe(1);
      expect(mpf.frames[0]).toMatchObject({ left: 1, top: 2, right: 5, bottom: 6, centerX: 3, centerY: 4 });
    });
  });
});
