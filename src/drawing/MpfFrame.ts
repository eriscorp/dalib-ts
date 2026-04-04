/** A single frame within an MPF stop-motion animation file. */
export interface MpfFrame {
  left: number;
  top: number;
  right: number;
  bottom: number;
  centerX: number;
  centerY: number;
  /** Byte offset of this frame's data within the file's data segment. */
  startAddress: number;
  /** Palette-indexed pixel data (1 byte per pixel). */
  data: Uint8Array;
}

export function mpfFrameWidth(frame: MpfFrame): number {
  return frame.right - frame.left;
}

export function mpfFrameHeight(frame: MpfFrame): number {
  return frame.bottom - frame.top;
}
