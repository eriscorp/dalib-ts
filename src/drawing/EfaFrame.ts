/**
 * A single frame within an EFA file.
 * Pixel data is stored as RGB565 (2 bytes per pixel), zlib-compressed on disk.
 */
export interface EfaFrame {
  /** Byte offset within the file's data segment where compressed data begins. */
  startAddress: number;
  /** Size of the compressed data in bytes. */
  compressedSize: number;
  /** Size of the data after zlib decompression in bytes (includes alphaData if present). */
  decompressedSize: number;
  /** Number of bytes of RGB565 pixel data (pixelWidth × pixelHeight × 2). */
  byteCount: number;
  /** Width of pixel data in bytes (pixelWidth × 2). */
  byteWidth: number;
  /** Pixel width of this frame. */
  framePixelWidth: number;
  /** Pixel height of this frame. */
  framePixelHeight: number;
  /** Pixel width of the full image this frame belongs to. */
  imagePixelWidth: number;
  /** Pixel height of the full image this frame belongs to. */
  imagePixelHeight: number;
  /** Left (X) padding offset within the full image canvas. */
  left: number;
  /** Top (Y) padding offset within the full image canvas. */
  top: number;
  /** X coordinate of the draw-area center point. */
  centerX: number;
  /** Y coordinate of the draw-area center point. */
  centerY: number;
  /** Decompressed RGB565 pixel data. */
  data: Uint8Array;
  /**
   * Optional alpha surface (SeparateAlpha: per-pixel scalar 0-31; PerChannelAlpha: RGB555 per pixel).
   * Present only for EfaBlendingType.SeparateAlpha and EfaBlendingType.PerChannelAlpha.
   */
  alphaData?: Uint8Array;

  unknown1: number;
  unknown2: number;
  unknown3: number;
  unknown4: number;
  unknown5: number;
  unknown6: number;
  unknown7: number;
}
