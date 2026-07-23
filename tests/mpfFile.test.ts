import { describe, expect, it } from 'vitest';
import { buildArchive } from './archiveFixture.js';
import type { RgbaFrame } from '../src/constants.js';
import { MpfFile } from '../src/drawing/MpfFile.js';
import { MpfFormatType, MpfHeaderType, MpfIdleType } from '../src/enums.js';
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

  // Ported from C# DALib MpfHeaderTests (issue #10 / commit 20aebba). The Unknown
  // (0xFFFFFFFF magic) header carries a variable-length run: when bit 2 of the flags
  // field is set, a u32 count follows, then count*4 bytes. The old parser did a
  // `flags === 4` compare + fixed 8-byte read, correct only for flags==4, count==1.
  describe('Unknown variable-length header', () => {
    // Smallest valid Unknown-header MPF: given flags (+ count/data when bit 2 set),
    // zero real frames, trailing palette sentinel. A correct parse round-trips exactly.
    function buildUnknownHeaderMpf(flags: number, count: number): Uint8Array {
      const w = new SpanWriter();
      w.writeInt32LE(MpfHeaderType.Unknown); // magic -1
      w.writeInt32LE(flags);
      if ((flags & 4) !== 0) {
        w.writeInt32LE(count);
        for (let i = 0; i < count * 4; i++) w.writeUInt8((0x10 + i) & 0xff);
      }
      w.writeUInt8(1); // frameCount — just the palette sentinel
      w.writeInt16LE(64); // pixelWidth
      w.writeInt16LE(48); // pixelHeight
      w.writeInt32LE(0); // dataLength
      w.writeUInt8(0); // walkFrameIndex
      w.writeUInt8(0); // walkFrameCount
      for (let i = 0; i < 6; i++) w.writeUInt8(0); // SingleAttack format block (all zero)
      for (let i = 0; i < 12; i++) w.writeUInt8(0xff); // palette sentinel geometry
      w.writeInt32LE(0); // paletteNumber
      return w.toUint8Array();
    }

    it.each([
      { flags: 0x04, count: 1 }, // legacy-correct case (the only one the old logic got right)
      { flags: 0x04, count: 3 }, // bit 2 set, count != 1 — old code under-read by 8 bytes
      { flags: 0x06, count: 2 }, // bit 2 set alongside another bit — old `=== 4` missed it
      { flags: 0x14, count: 5 }, // higher bits set too
      { flags: 0x00, count: 0 }, // bit 2 clear — no count/data follows
      { flags: 0x02, count: 0 }, // other bit set, bit 2 clear — must NOT read a count
    ])('round-trips flags=$flags count=$count byte-for-byte', ({ flags, count }) => {
      const original = buildUnknownHeaderMpf(flags, count);
      const mpf = MpfFile.fromBuffer(original);

      expect(mpf.headerType).toBe(MpfHeaderType.Unknown);
      expect(mpf.pixelWidth).toBe(64);
      expect(mpf.pixelHeight).toBe(48);
      expect(mpf.frames.length).toBe(0);

      const expectedHeaderLen = (flags & 4) !== 0 ? 8 + count * 4 : 4;
      expect(mpf.unknownHeaderBytes.length).toBe(expectedHeaderLen);

      // Verbatim passthrough → re-serializing reproduces the input exactly.
      expect(Array.from(mpf.toUint8Array())).toEqual(Array.from(original));
    });
  });

  describe('archive factories', () => {
    const bytes = () => buildMultipleAttacksMpf([oneFrame()], { paletteNumber: 5 });

    it('reads from an entry, with or without the extension', () => {
      const archive = buildArchive([{ name: 'mns001.mpf', data: bytes() }]);
      expect(MpfFile.fromEntry(archive.get('mns001.mpf')!).paletteNumber).toBe(5);
      expect(MpfFile.fromArchive('mns001', archive).paletteNumber).toBe(5);
      expect(MpfFile.fromArchive('mns001.mpf', archive).paletteNumber).toBe(5);
    });

    it('throws when the entry is missing', () => {
      expect(() => MpfFile.fromArchive('nope', buildArchive([]))).toThrow(/not found/);
    });

    it('accepts an ArrayBuffer', () => {
      const copy = new Uint8Array(bytes());
      expect(MpfFile.fromBuffer(copy.buffer as ArrayBuffer).paletteNumber).toBe(5);
    });
  });

  describe('fromRgbaFrames', () => {
    /** An RGBA frame with one opaque pixel at (x, y); everything else transparent. */
    function dot(width: number, height: number, x: number, y: number, r: number, g: number, b: number): RgbaFrame {
      const data = new Uint8ClampedArray(width * height * 4);
      const o = (y * width + x) * 4;
      data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
      return { width, height, data };
    }

    it('sets the sprite size from the largest source frame', () => {
      const { entity } = MpfFile.fromRgbaFrames([dot(8, 6, 0, 0, 1, 1, 1), dot(4, 10, 0, 0, 1, 1, 1)]);
      expect(entity.pixelWidth).toBe(8);
      expect(entity.pixelHeight).toBe(10);
    });

    it('crops each frame to its ink and makes the crop offset the anchor', () => {
      const { entity } = MpfFile.fromRgbaFrames([dot(8, 6, 3, 2, 255, 0, 0)]);
      const frame = entity.frames[0]!;
      expect(frame.left).toBe(3);
      expect(frame.top).toBe(2);
      expect(frame.right).toBe(4);
      expect(frame.bottom).toBe(3);
      expect(frame.data).toHaveLength(1);
    });

    it('quantizes every frame against one shared palette', () => {
      const { entity, palette } = MpfFile.fromRgbaFrames([
        dot(4, 4, 0, 0, 255, 0, 0),
        dot(4, 4, 0, 0, 0, 0, 255),
      ]);
      expect(entity.frames).toHaveLength(2);
      expect(palette.length).toBe(256);
      expect(entity.frames[0]!.data[0]).not.toBe(entity.frames[1]!.data[0]);
    });

    it('drops a fully transparent frame, which crops to zero area', () => {
      const blank: RgbaFrame = { width: 4, height: 4, data: new Uint8ClampedArray(4 * 4 * 4) };
      const { entity } = MpfFile.fromRgbaFrames([blank, dot(4, 4, 1, 1, 9, 9, 9)]);
      expect(entity.frames).toHaveLength(1);
      expect(entity.frames[0]!.left).toBe(1);
    });

    it('round-trips the built file back through the parser', () => {
      const { entity } = MpfFile.fromRgbaFrames([dot(4, 4, 1, 1, 200, 100, 50)]);
      const reparsed = MpfFile.fromBuffer(entity.toUint8Array());
      expect(reparsed.pixelWidth).toBe(4);
      expect(reparsed.frames).toHaveLength(1);
      expect(Array.from(reparsed.frames[0]!.data)).toEqual(Array.from(entity.frames[0]!.data));
    });

    it('handles an empty frame list', () => {
      const { entity } = MpfFile.fromRgbaFrames([]);
      expect(entity.frames).toHaveLength(0);
      expect(entity.pixelWidth).toBe(0);
    });
  });
});
