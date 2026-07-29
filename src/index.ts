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
  AlphaMode,
  EfaBlendingType,
  Endianness,
  KhanPalOverrideType,
  MpfFormatType,
  MpfHeaderType,
  MpfIdleType,
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
export type {
  DataArchiveOptions,
  DataArchiveWarning,
  DataArchiveWarningKind,
} from './data/DataArchive.js';
export { DataArchiveEntry } from './data/DataArchiveEntry.js';
export { MapFile } from './data/MapFile.js';
export type { MapTile } from './data/MapFile.js';
export { MetaFile } from './data/MetaFile.js';
export { MetaFileEntry } from './data/MetaFileEntry.js';
export {
  SotpDirection,
  SotpFile,
  SOTP_EMPTY_TILE_ID,
  SOTP_RENDER_OVER_PLAYER,
} from './data/SotpFile.js';

// Drawing — Palette
export { Palette } from './drawing/Palette.js';

// Drawing — Color & Palette tables
export { ColorTable } from './drawing/ColorTable.js';
export type { ColorTableEntry } from './drawing/ColorTableEntry.js';
export { emptyColorTableEntry } from './drawing/ColorTableEntry.js';
export type { PaletteCyclingEntry } from './drawing/PaletteCyclingEntry.js';
export { PaletteTable } from './drawing/PaletteTable.js';
export { PaletteLookup } from './drawing/PaletteLookup.js';
export type { PaletteLookupResult } from './drawing/PaletteLookup.js';

// Drawing — Palette resolution
export { matchPaletteRule } from './drawing/paletteRules.js';
export type {
  PaletteIdKind,
  PaletteRuleMatch,
  PaletteSourceKind,
} from './drawing/paletteRules.js';
export { PaletteResolver } from './drawing/PaletteResolver.js';
export type { ArchiveProvider, ResolvedPalette } from './drawing/PaletteResolver.js';

// Drawing — Image formats
export { BikFile } from './drawing/BikFile.js';
export { HpfFile } from './drawing/HpfFile.js';
export { EfaFile } from './drawing/EfaFile.js';
export type { EfaFrame } from './drawing/EfaFrame.js';
export { EpfFile } from './drawing/EpfFile.js';
export type { EpfFrame } from './drawing/EpfFrame.js';
export { epfFrameHeight, epfFrameWidth } from './drawing/EpfFrame.js';
export { FntFile } from './drawing/FntFile.js';
export { HeaFile } from './drawing/HeaFile.js';
export { JpfFile } from './drawing/JpfFile.js';
export {
  LftFile,
  lftGlyphHeight,
  lftGlyphWidth,
  lftRowStride,
  LFT_BITMAP_BASE,
  LFT_GLYPH_COUNT,
  LFT_RECORD_LENGTH,
} from './drawing/LftFile.js';
export type { LftGlyph } from './drawing/LftFile.js';
export { MpfFile } from './drawing/MpfFile.js';
export type { MpfFrame } from './drawing/MpfFrame.js';
export { mpfFrameHeight, mpfFrameWidth } from './drawing/MpfFrame.js';
export { PcxFile } from './drawing/PcxFile.js';
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
  drawLftGlyph,
  getGlyphIndex,
  lftGlyphKeys,
  measureLftText,
  measureText,
  renderColorized,
  renderLftText,
  renderDarknessLayer,
  renderDarknessOverlay,
  renderEfa,
  renderEpf,
  renderHpf,
  renderMpf,
  renderPalettized,
  renderPcx,
  renderSpfColorized,
  renderSpfPalettized,
  renderText,
  renderTile,
} from './drawing/Graphics.js';
export type { LftTextMetrics } from './drawing/Graphics.js';
