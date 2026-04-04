/** Byte-order preference for multi-byte reads/writes. */
export const enum Endianness {
  LittleEndian = 'LE',
  BigEndian = 'BE',
}

/**
 * Blend modes used by EFA files.
 * All EFA rendering operates in RGB555 color space.
 */
export const enum EfaBlendingType {
  /**
   * Saturated additive blend.
   * Each channel is added to the destination and clamped (min(src+dst, 31) in RGB555).
   * Equivalent to SKBlendMode.Plus.
   */
  Additive = 1,

  /**
   * Per-channel self-alpha blend.
   * Each channel's value serves as its own alpha — bright channels are opaque, dark are transparent.
   * Formula: result_ch = (srcCh * 32 + dstCh * (32 - srcCh)) >> 5.
   * Equivalent to SKBlendMode.Screen.
   */
  SelfAlpha = 2,

  /**
   * Standard alpha blend using a separate per-pixel scalar alpha surface encoded in the EFA data.
   */
  SeparateAlpha = 3,

  /**
   * Per-channel alpha blend.
   * Like SeparateAlpha but the alpha surface provides independent alpha values per color channel.
   */
  PerChannelAlpha = 4,
}

/** MPF header variant indicator. */
export const enum MpfHeaderType {
  /** Indicates 4 extra header bytes of unknown purpose. */
  Unknown = -1,
  /** No extra header bytes. */
  None = 0,
}

/** MPF animation format variant. */
export const enum MpfFormatType {
  /** Multiple attack animation sequences. */
  MultipleAttacks = -1,
  /** Single attack animation sequence. */
  SingleAttack = 0,
}

/** SPF file format variant. */
export const enum SpfFormatType {
  /**
   * 1 byte per pixel, palette-indexed.
   * The file contains RGB565 + RGB555 palettes (256 entries each).
   */
  Palettized = 0,

  /**
   * 2 bytes per pixel (direct color).
   * Each frame stores a full RGB565 copy and a full RGB555 copy.
   */
  Colorized = 2,
}

/** Control element type within a ControlFile. */
export const enum ControlType {
  /** Full-bounds anchor — all other controls are within this rect. */
  Anchor = 0,
  /** Returns a value. */
  ReturnsValue = 3,
  /** Always returns 0. */
  Returns0 = 4,
  /** Read-only text (non-editable, returns no value). */
  ReadonlyText = 5,
  /** Editable text (returns no value). */
  EditableText = 6,
  /** Never returns a value. */
  DoesNotReturnValue = 7,
}

/** Palette override gender selector for KHAN archives. */
export const enum KhanPalOverrideType {
  Male = -1,
  Female = -2,
  None = 0,
}
