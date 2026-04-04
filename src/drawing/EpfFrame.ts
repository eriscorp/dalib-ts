/** A single frame within an EPF palettized animation file. */
export interface EpfFrame {
  top: number;
  left: number;
  bottom: number;
  right: number;
  /** Palette-indexed pixel data (1 byte per pixel). */
  data: Uint8Array;
}

export function epfFrameWidth(frame: EpfFrame): number {
  return frame.right - frame.left;
}

export function epfFrameHeight(frame: EpfFrame): number {
  return frame.bottom - frame.top;
}
