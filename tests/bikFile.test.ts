import { describe, expect, it } from 'vitest';
import { BikFile } from '../src/drawing/BikFile.js';

function buildBikHeader(opts: {
  version?: string;
  frameCount: number;
  width: number;
  height: number;
  frameRateDividend: number;
  frameRateDivisor: number;
  audioTrackCount: number;
}): Uint8Array {
  const buf = new Uint8Array(64);
  const view = new DataView(buf.buffer);
  buf[0] = 0x42; // 'B'
  buf[1] = 0x49; // 'I'
  buf[2] = 0x4b; // 'K'
  buf[3] = (opts.version ?? 'i').charCodeAt(0);
  view.setUint32(4, 0, true); // file size minus 8 (don't care)
  view.setUint32(8, opts.frameCount, true);
  view.setUint32(12, 0, true); // max frame size
  view.setUint32(16, opts.frameCount, true); // frame count again
  view.setUint32(20, opts.width, true);
  view.setUint32(24, opts.height, true);
  view.setUint32(28, opts.frameRateDividend, true);
  view.setUint32(32, opts.frameRateDivisor, true);
  view.setUint32(36, 0, true); // video flags
  view.setUint32(40, opts.audioTrackCount, true);
  return buf;
}

describe('BikFile', () => {
  it('parses canonical BIKi 640×480 metadata', () => {
    const bik = BikFile.fromBuffer(
      buildBikHeader({
        version: 'i',
        frameCount: 360,
        width: 640,
        height: 480,
        frameRateDividend: 60,
        frameRateDivisor: 1,
        audioTrackCount: 1,
      }),
    );
    expect(bik.version).toBe('i');
    expect(bik.width).toBe(640);
    expect(bik.height).toBe(480);
    expect(bik.frameCount).toBe(360);
    expect(bik.fps).toBe(60);
    expect(bik.audioTrackCount).toBe(1);
  });

  it('computes fps as dividend/divisor', () => {
    const bik = BikFile.fromBuffer(
      buildBikHeader({
        frameCount: 1,
        width: 1,
        height: 1,
        frameRateDividend: 30000,
        frameRateDivisor: 1001,
        audioTrackCount: 0,
      }),
    );
    expect(bik.fps).toBeCloseTo(30000 / 1001);
  });

  it('returns fps=0 when divisor is zero', () => {
    const bik = BikFile.fromBuffer(
      buildBikHeader({
        frameCount: 1,
        width: 1,
        height: 1,
        frameRateDividend: 60,
        frameRateDivisor: 0,
        audioTrackCount: 0,
      }),
    );
    expect(bik.fps).toBe(0);
  });

  it('throws on wrong magic', () => {
    const buf = buildBikHeader({
      frameCount: 1,
      width: 1,
      height: 1,
      frameRateDividend: 1,
      frameRateDivisor: 1,
      audioTrackCount: 0,
    });
    buf[0] = 0x00;
    expect(() => BikFile.fromBuffer(buf)).toThrow(/Not a BIK file/);
  });

  it('throws on truncated buffer', () => {
    expect(() => BikFile.fromBuffer(new Uint8Array(20))).toThrow(/too short/);
  });
});
