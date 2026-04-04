// ============================================================================
// dalib — Dark Ages game asset library for JavaScript/TypeScript
// ============================================================================

// Core types
export type { Color, RgbaFrame } from './constants.js';
export {
  COLORS_PER_PALETTE,
  DATA_ARCHIVE_ENTRY_NAME_LENGTH,
  FIVE_BIT_MASK,
  HALF_TILE_HEIGHT,
  HALF_TILE_WIDTH,
  HPF_TILE_WIDTH,
  PALETTE_DYE_INDEX_START,
  RGB555_ALMOST_BLACK,
  RGB555_COLOR_LOSS_FACTOR,
  SIX_BIT_MASK,
  TILE_HEIGHT,
  TILE_SIZE,
  TILE_WIDTH,
  TRANSPARENT,
} from './constants.js';

// Enums
export {
  EfaBlendingType,
  Endianness,
  KhanPalOverrideType,
  MpfFormatType,
  MpfHeaderType,
  SpfFormatType,
} from './enums.js';

// Binary I/O
export { SpanReader } from './io/SpanReader.js';
export { SpanWriter } from './io/SpanWriter.js';
export {
  compressHpf,
  decompressHpf,
  HPF_SIGNATURE_UINT32,
  isHpfCompressed,
} from './io/Compression.js';

// Cryptography
export { crc16 } from './cryptography/CRC16.js';
export { crc32 } from './cryptography/CRC32.js';

// Utility
export { scaleRangeByte } from './utility/MathEx.js';
export {
  decodeRgb555,
  decodeRgb565,
  encodeRgb555,
  encodeRgb565,
} from './utility/ColorCodec.js';

// Data / Archive
export { DataArchive } from './data/DataArchive.js';
export { DataArchiveEntry } from './data/DataArchiveEntry.js';
export { MapFile } from './data/MapFile.js';
export type { MapTile } from './data/MapFile.js';
export { MetaFile } from './data/MetaFile.js';
export { MetaFileEntry } from './data/MetaFileEntry.js';

// Drawing — Palette
export { Palette } from './drawing/Palette.js';

// Drawing — Color & Palette tables
export { ColorTable } from './drawing/ColorTable.js';
export type { ColorTableEntry } from './drawing/ColorTableEntry.js';
export { emptyColorTableEntry } from './drawing/ColorTableEntry.js';
export type { PaletteCyclingEntry } from './drawing/PaletteCyclingEntry.js';
export { PaletteTable } from './drawing/PaletteTable.js';
export { PaletteLookup } from './drawing/PaletteLookup.js';

// Drawing — Image formats
export { HpfFile } from './drawing/HpfFile.js';
export { EfaFile } from './drawing/EfaFile.js';
export type { EfaFrame } from './drawing/EfaFrame.js';
export { EpfFile } from './drawing/EpfFile.js';
export type { EpfFrame } from './drawing/EpfFrame.js';
export { epfFrameHeight, epfFrameWidth } from './drawing/EpfFrame.js';
export { FntFile } from './drawing/FntFile.js';
export { HeaFile } from './drawing/HeaFile.js';
export { MpfFile } from './drawing/MpfFile.js';
export type { MpfFrame } from './drawing/MpfFrame.js';
export { mpfFrameHeight, mpfFrameWidth } from './drawing/MpfFrame.js';
export { SpfFile } from './drawing/SpfFile.js';
export type { SpfFrame } from './drawing/SpfFrame.js';
export { spfFrameHeight, spfFrameWidth } from './drawing/SpfFrame.js';

// Drawing — Tiles
export { Tile } from './drawing/Tile.js';
export { Tileset } from './drawing/Tileset.js';

// Drawing — Animation & Effect tables
export { TileAnimationEntry } from './drawing/TileAnimationEntry.js';
export { TileAnimationTable } from './drawing/TileAnimationTable.js';
export { EffectTableEntry } from './drawing/EffectTableEntry.js';
export { EffectTable } from './drawing/EffectTable.js';

// Drawing — Control UI files
export { Control } from './drawing/Control.js';
export type { Rect } from './drawing/Control.js';
export { ControlFile } from './drawing/ControlFile.js';

// Drawing — Virtualized lazy views
export { EfaView } from './drawing/virtualized/EfaView.js';
export { EpfView } from './drawing/virtualized/EpfView.js';
export { MpfView } from './drawing/virtualized/MpfView.js';
export { SpfView } from './drawing/virtualized/SpfView.js';
export { TilesetView } from './drawing/virtualized/TilesetView.js';

// Utility — Palettized wrapper
export type { Palettized } from './utility/Palettized.js';

// Utility — Image processing (quantization, transparency)
export {
  cropTransparentPixels,
  preserveNonTransparentBlacks,
  quantizeFrames,
} from './utility/ImageProcessor.js';
export type { QuantizeResult } from './utility/ImageProcessor.js';

// Drawing — Rendering
export {
  drawGlyph,
  getGlyphIndex,
  measureText,
  renderColorized,
  renderDarknessLayer,
  renderDarknessOverlay,
  renderEfa,
  renderEpf,
  renderHpf,
  renderMpf,
  renderPalettized,
  renderSpfColorized,
  renderSpfPalettized,
  renderText,
  renderTile,
} from './drawing/Graphics.js';
