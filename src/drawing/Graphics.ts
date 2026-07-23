import type { Color, RgbaFrame } from '../constants.js';
import { HALF_TILE_HEIGHT, TILE_WIDTH, TILE_HEIGHT, TRANSPARENT } from '../constants.js';
import { AlphaMode, EfaBlendingType } from '../enums.js';
import { decodeRgb565 } from '../utility/ColorCodec.js';
import type { EfaFrame } from './EfaFrame.js';
import type { EpfFrame } from './EpfFrame.js';
import { epfFrameHeight, epfFrameWidth } from './EpfFrame.js';
import type { FntFile } from './FntFile.js';
import { HeaFile } from './HeaFile.js';
import type { HpfFile } from './HpfFile.js';
import type { LftFile } from './LftFile.js';
import type { MpfFrame } from './MpfFrame.js';
import { mpfFrameHeight, mpfFrameWidth } from './MpfFrame.js';
import type { Palette } from './Palette.js';
import type { PcxFile } from './PcxFile.js';
import type { SpfFrame } from './SpfFrame.js';
import { spfFrameHeight, spfFrameWidth } from './SpfFrame.js';
import type { Tile } from './Tile.js';

// ---------------------------------------------------------------------------
// Core render helpers
// ---------------------------------------------------------------------------

/**
 * Render a palettized frame (1 byte per pixel) to an RgbaFrame.
 *
 * @param alphaMode How RGB channels are stored relative to alpha.
 *   Default {@link AlphaMode.Straight} matches canvas `ImageData`; pass
 *   {@link AlphaMode.Premultiplied} for consumers that need baked-in alpha
 *   (WebGL texture uploads with `UNPACK_PREMULTIPLY_ALPHA_WEBGL`, etc.).
 * @param colorKey Whether palette index 0 is transparent. True (the default) matches
 *   the sprite path. Ground and background art draws index 0 as an ordinary opaque
 *   color, so those callers must pass `false` — see {@link renderTile}.
 */
export function renderPalettized(
  left: number,
  top: number,
  width: number,
  height: number,
  data: Uint8Array,
  palette: Palette,
  alphaMode: AlphaMode = AlphaMode.Straight,
  colorKey = true,
): RgbaFrame {
  // Empty placeholder frames encode Right < Left / Bottom < Top, giving non-positive
  // dimensions and no pixel data. Guard centrally so every caller (HPF/SPF/MPF/Tile) is
  // covered. Mirrors the C# DALib SimpleRender fix (commit b2d0de3).
  if (width <= 0 || height <= 0) {
    return { width: 1, height: 1, data: new Uint8ClampedArray(4) };
  }

  const dstOffsetX = Math.max(0, left);
  const dstOffsetY = Math.max(0, top);
  const bitmapWidth = width + dstOffsetX;
  const bitmapHeight = height + dstOffsetY;

  const pixels = new Uint8ClampedArray(bitmapWidth * bitmapHeight * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const paletteIndex = data[y * width + x]!;
      const color = colorKey && paletteIndex === 0 ? TRANSPARENT : palette.get(paletteIndex);
      const dst = ((y + dstOffsetY) * bitmapWidth + (x + dstOffsetX)) * 4;
      writePixel(pixels, dst, color.r, color.g, color.b, color.a, alphaMode);
    }
  }

  return { width: bitmapWidth, height: bitmapHeight, data: pixels };
}

/**
 * Render a direct-color frame (Color[] per pixel) to an RgbaFrame.
 * Pure black or fully transparent pixels are skipped (treated as transparent).
 */
export function renderColorized(
  left: number,
  top: number,
  width: number,
  height: number,
  colorData: Color[],
  alphaMode: AlphaMode = AlphaMode.Straight,
): RgbaFrame {
  // See renderPalettized: guard non-positive dimensions from empty placeholder frames
  // centrally. Mirrors the C# DALib SimpleRender fix (commit b2d0de3).
  if (width <= 0 || height <= 0) {
    return { width: 1, height: 1, data: new Uint8ClampedArray(4) };
  }

  const dstOffsetX = Math.max(0, left);
  const dstOffsetY = Math.max(0, top);
  const bitmapWidth = width + dstOffsetX;
  const bitmapHeight = height + dstOffsetY;

  const pixels = new Uint8ClampedArray(bitmapWidth * bitmapHeight * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = colorData[y * width + x]!;
      // Skip transparent-black and pure-black (they represent transparency in DA formats)
      if ((color.r === 0 && color.g === 0 && color.b === 0)) continue;
      const dst = ((y + dstOffsetY) * bitmapWidth + (x + dstOffsetX)) * 4;
      writePixel(pixels, dst, color.r, color.g, color.b, color.a, alphaMode);
    }
  }

  return { width: bitmapWidth, height: bitmapHeight, data: pixels };
}

/**
 * Write one RGBA pixel respecting {@link AlphaMode}.
 * For {@link AlphaMode.Premultiplied}, RGB is scaled by `alpha / 255` using round-half-up.
 */
function writePixel(
  pixels: Uint8ClampedArray,
  offset: number,
  r: number,
  g: number,
  b: number,
  a: number,
  alphaMode: AlphaMode,
): void {
  if (alphaMode === AlphaMode.Premultiplied && a < 255) {
    pixels[offset] = Math.round((r * a) / 255);
    pixels[offset + 1] = Math.round((g * a) / 255);
    pixels[offset + 2] = Math.round((b * a) / 255);
  } else {
    pixels[offset] = r;
    pixels[offset + 1] = g;
    pixels[offset + 2] = b;
  }
  pixels[offset + 3] = a;
}

// ---------------------------------------------------------------------------
// Format-specific render entry points
// ---------------------------------------------------------------------------

/** Render an HpfFile to an RgbaFrame using the supplied palette. */
export function renderHpf(
  hpf: HpfFile,
  palette: Palette,
  yOffset = 0,
  alphaMode: AlphaMode = AlphaMode.Straight,
): RgbaFrame {
  return renderPalettized(0, yOffset, hpf.pixelWidth, hpf.pixelHeight, hpf.data, palette, alphaMode);
}

/** Render a palettized SpfFrame to an RgbaFrame. */
export function renderSpfPalettized(
  frame: SpfFrame,
  palette: Palette,
  alphaMode: AlphaMode = AlphaMode.Straight,
): RgbaFrame {
  const width = spfFrameWidth(frame);
  const height = spfFrameHeight(frame);

  // Indexed rows advance by the frame's pitch, which is not always the row width.
  // Repack into a tightly packed buffer when they differ.
  let data = frame.data!;
  const stride = frame.byteWidth;
  if (stride > 0 && stride !== width) {
    const packed = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      const src = y * stride;
      if (src >= data.length) break;
      packed.set(data.subarray(src, Math.min(src + width, data.length)), y * width);
    }
    data = packed;
  }

  return renderPalettized(frame.left, frame.top, width, height, data, palette, alphaMode);
}

/** Render a colorized SpfFrame to an RgbaFrame. */
export function renderSpfColorized(
  frame: SpfFrame,
  alphaMode: AlphaMode = AlphaMode.Straight,
): RgbaFrame {
  return renderColorized(frame.left, frame.top, spfFrameWidth(frame), spfFrameHeight(frame), frame.colorData!, alphaMode);
}

/** Render an MpfFrame to an RgbaFrame using the supplied palette. */
export function renderMpf(
  frame: MpfFrame,
  palette: Palette,
  alphaMode: AlphaMode = AlphaMode.Straight,
): RgbaFrame {
  return renderPalettized(
    frame.left,
    frame.top,
    mpfFrameWidth(frame),
    mpfFrameHeight(frame),
    frame.data,
    palette,
    alphaMode,
  );
}

/**
 * Render an EpfFrame to an RgbaFrame using the supplied palette.
 * Zero-dimension frames return a 1×1 transparent frame (matches upstream DALib guard).
 */
export function renderEpf(
  frame: EpfFrame,
  palette: Palette,
  alphaMode: AlphaMode = AlphaMode.Straight,
): RgbaFrame {
  const width = epfFrameWidth(frame);
  const height = epfFrameHeight(frame);
  if (width <= 0 || height <= 0) {
    return { width: 1, height: 1, data: new Uint8ClampedArray(4) };
  }
  return renderPalettized(frame.left, frame.top, width, height, frame.data, palette, alphaMode);
}

/**
 * Render an EfaFrame to an RgbaFrame, applying the specified blend mode.
 * Returns a frame with full image dimensions (imagePixelWidth × imagePixelHeight).
 */
export function renderEfa(
  frame: EfaFrame,
  blendingType: EfaBlendingType = EfaBlendingType.Additive,
  alphaMode: AlphaMode = AlphaMode.Straight,
): RgbaFrame {
  if (frame.byteCount === 0 || frame.byteWidth === 0) {
    const w = Math.max(1, frame.imagePixelWidth);
    const h = Math.max(1, frame.imagePixelHeight);
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  }

  const dataWidth = frame.byteWidth / 2;
  const dataHeight = frame.byteCount / frame.byteWidth;

  const dstOffsetX = Math.max(0, frame.left);
  const dstOffsetY = Math.max(0, frame.top);
  const bitmapWidth = Math.max(frame.imagePixelWidth, dataWidth + dstOffsetX);
  const bitmapHeight = Math.max(frame.imagePixelHeight, dataHeight + dstOffsetY);

  const pixels = new Uint8ClampedArray(bitmapWidth * bitmapHeight * 4);

  // Decode alpha surface if needed
  let perPixelAlpha: Uint8Array | null = null;
  if (
    frame.alphaData &&
    frame.alphaData.length > 0 &&
    (blendingType === EfaBlendingType.SeparateAlpha || blendingType === EfaBlendingType.PerChannelAlpha)
  ) {
    if (blendingType === EfaBlendingType.PerChannelAlpha) {
      perPixelAlpha = decodePerChannelAlphaSurface(frame.alphaData, dataWidth, dataHeight);
    } else if (frame.unknown4 === 4) {
      perPixelAlpha = decodeRleAlphaSurface(frame.alphaData, dataWidth, dataHeight);
    } else {
      perPixelAlpha = decodeRawAlphaSurface(frame.alphaData, dataWidth, dataHeight);
    }
  }

  const dataView = new DataView(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
  let offset = 0;

  for (let y = 0; y < dataHeight; y++) {
    for (let x = 0; x < dataWidth; x++) {
      // Skip pixels beyond the actual frame dimensions (padding)
      if ((x + frame.left) >= frame.framePixelWidth) { offset += 2; continue; }
      if ((y + frame.top) >= frame.framePixelHeight) { offset += 2; continue; }

      const encoded = dataView.getUint16(offset, true);
      offset += 2;
      const color = decodeRgb565(encoded);

      let alpha: number;
      switch (blendingType) {
        case EfaBlendingType.Additive:
        case EfaBlendingType.SelfAlpha:
          alpha = 255;
          break;
        case EfaBlendingType.SeparateAlpha:
        case EfaBlendingType.PerChannelAlpha: {
          if (perPixelAlpha) {
            const ai = y * dataWidth + x;
            alpha = ai < perPixelAlpha.length ? perPixelAlpha[ai]! : 0;
          } else {
            alpha = Math.max(color.r, color.g, color.b);
          }
          break;
        }
        default:
          alpha = 255;
      }

      const dstX = x + dstOffsetX;
      const dstY = y + dstOffsetY;
      const dst = (dstY * bitmapWidth + dstX) * 4;
      writePixel(pixels, dst, color.r, color.g, color.b, alpha, alphaMode);
    }
  }

  return { width: bitmapWidth, height: bitmapHeight, data: pixels };
}

// ---------------------------------------------------------------------------
// Alpha surface decoders
// ---------------------------------------------------------------------------

function decodePerChannelAlphaSurface(alphaData: Uint8Array, width: number, height: number): Uint8Array {
  const result = new Uint8Array(width * height);
  let offset = 0;
  for (let i = 0; i < result.length; i++) {
    if (offset + 1 >= alphaData.length) break;
    const alphaPx = alphaData[offset]! | (alphaData[offset + 1]! << 8);
    offset += 2;
    const alphaR = (alphaPx >> 10) & 0x1f;
    const alphaG = (alphaPx >> 5) & 0x1f;
    const alphaB = alphaPx & 0x1f;
    result[i] = Math.min(255, Math.max(alphaR, alphaG, alphaB) * 255 / 31);
  }
  return result;
}

function decodeRawAlphaSurface(alphaData: Uint8Array, width: number, height: number): Uint8Array {
  const result = new Uint8Array(width * height);
  let offset = 0;
  for (let i = 0; i < result.length; i++) {
    if (offset + 1 >= alphaData.length) break;
    const alpha16 = alphaData[offset]! | (alphaData[offset + 1]! << 8);
    result[i] = Math.min(255, alpha16 * 255 / 31);
    offset += 2;
  }
  return result;
}

function decodeRleAlphaSurface(alphaData: Uint8Array, width: number, height: number): Uint8Array {
  const result = new Uint8Array(width * height);
  const tableSize = height * 4;
  if (alphaData.length < tableSize) return result;

  for (let row = 0; row < height; row++) {
    const rowOffset =
      alphaData[row * 4]! |
      (alphaData[row * 4 + 1]! << 8) |
      (alphaData[row * 4 + 2]! << 16) |
      (alphaData[row * 4 + 3]! << 24);

    let col = 0;
    let rleOffset = rowOffset;

    while (col < width) {
      if (rleOffset + 1 >= alphaData.length) break;
      const word = alphaData[rleOffset]! | (alphaData[rleOffset + 1]! << 8);
      rleOffset += 2;
      const count = (word >> 8) & 0xff;
      const alpha = word & 0xff;
      const scaled = Math.min(255, (alpha * 255) / 31);
      for (let i = 0; i < count && col < width; i++, col++) {
        result[row * width + col] = scaled;
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// PCX rendering
// ---------------------------------------------------------------------------

/**
 * Render a {@link PcxFile} to an RgbaFrame using the file's embedded palette.
 * PCX has no transparent-index semantic — every pixel is opaque (alpha 255).
 * The `alphaMode` parameter is accepted for API consistency but has no effect
 * on output for fully-opaque pixels.
 */
export function renderPcx(
  pcx: PcxFile,
  alphaMode: AlphaMode = AlphaMode.Straight,
): RgbaFrame {
  const { width, height, data, palette } = pcx;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = data[y * width + x]!;
      const pi = idx * 3;
      const dst = (y * width + x) * 4;
      writePixel(pixels, dst, palette[pi]!, palette[pi + 1]!, palette[pi + 2]!, 255, alphaMode);
    }
  }
  return { width, height, data: pixels };
}

// ---------------------------------------------------------------------------
// Tile rendering
// ---------------------------------------------------------------------------

/**
 * Render a palettized ground tile (56×27) to an RgbaFrame.
 *
 * Only the isometric diamond inside the 56×27 record is visible: row `y` spans
 * `x = abs(13 - y) * 2` for `56 - left * 2` pixels, giving 784 visible pixels. Bytes
 * outside that diamond are padding and are written as fully transparent — real banks
 * do contain non-zero padding, which would otherwise show up as corner garbage.
 *
 * Unlike the sprite path, palette index 0 inside the diamond is an ordinary opaque
 * color, not a transparency key.
 */
export function renderTile(
  tile: Tile,
  palette: Palette,
  alphaMode: AlphaMode = AlphaMode.Straight,
): RgbaFrame {
  const frame = renderPalettized(
    0,
    0,
    TILE_WIDTH,
    TILE_HEIGHT,
    tile.data,
    palette,
    alphaMode,
    /* colorKey */ false,
  );

  for (let y = 0; y < TILE_HEIGHT; y++) {
    const left = Math.abs(HALF_TILE_HEIGHT - 1 - y) * 2;
    const right = TILE_WIDTH - left;
    for (let x = 0; x < TILE_WIDTH; x++) {
      if (x >= left && x < right) continue;
      const dst = (y * TILE_WIDTH + x) * 4;
      frame.data[dst] = 0;
      frame.data[dst + 1] = 0;
      frame.data[dst + 2] = 0;
      frame.data[dst + 3] = 0;
    }
  }

  return frame;
}

// ---------------------------------------------------------------------------
// HeaFile darkness overlay
// ---------------------------------------------------------------------------

/**
 * Render a single HeaFile layer as an RGBA darkness overlay.
 * Fully dark pixels (light=0) get alpha=`darknessOpacity`; fully lit pixels are transparent.
 */
export function renderDarknessLayer(hea: HeaFile, layerIndex: number, darknessOpacity = 200): RgbaFrame {
  if (layerIndex < 0 || layerIndex >= hea.layerCount) {
    throw new RangeError(`layerIndex ${layerIndex} out of range`);
  }
  const width = hea.getLayerWidth(layerIndex);
  const height = hea.scanlineCount;
  const data = new Uint8ClampedArray(width * height * 4);
  const rowBuf = new Uint8Array(width);

  for (let y = 0; y < height; y++) {
    hea.decodeScanline(layerIndex, y, rowBuf);
    const rowBase = y * width * 4;
    for (let x = 0; x < width; x++) {
      const value = rowBuf[x]!;
      const lightRatio = Math.min(1, value / HeaFile.MAX_LIGHT_VALUE);
      const alpha = Math.round(darknessOpacity * (1 - lightRatio));
      const i = rowBase + x * 4;
      // r=0, g=0, b=0, a=alpha (black overlay with varying opacity)
      data[i + 3] = alpha;
    }
  }

  return { width, height, data };
}

/**
 * Render all layers of a HeaFile stitched together as a full-width darkness overlay.
 */
export function renderDarknessOverlay(hea: HeaFile, darknessOpacity = 200): RgbaFrame {
  const width = hea.scanlineWidth;
  const height = hea.scanlineCount;
  const data = new Uint8ClampedArray(width * height * 4);
  const rowBuf = new Uint8Array(HeaFile.LAYER_STRIP_WIDTH);

  for (let layer = 0; layer < hea.layerCount; layer++) {
    const layerWidth = hea.getLayerWidth(layer);
    const xOffset = hea.thresholds[layer]!;

    for (let y = 0; y < height; y++) {
      hea.decodeScanline(layer, y, rowBuf);
      const rowBase = y * width;
      for (let x = 0; x < layerWidth; x++) {
        const value = rowBuf[x]!;
        if (value === 0) continue;
        const lightRatio = Math.min(1, value / HeaFile.MAX_LIGHT_VALUE);
        const alpha = Math.round(darknessOpacity * (1 - lightRatio));
        const i = (rowBase + xOffset + x) * 4;
        data[i + 3] = alpha;
      }
    }
  }

  return { width, height, data };
}

// ---------------------------------------------------------------------------
// FntFile text rendering
// ---------------------------------------------------------------------------

/**
 * Draw a single glyph into a pre-allocated RGBA pixel buffer.
 * Color channels should be pre-multiplied by alpha before calling.
 * @param font       The bitmap font.
 * @param buffer     Flat RGBA Uint8Array/Uint8ClampedArray of `bufferWidth × height × 4` bytes.
 * @param bufferWidth Width of the buffer in pixels.
 * @param glyphIndex Glyph index within the font (use `getGlyphIndex`).
 * @param x          X cursor position.
 * @param y          Y cursor position.
 * @param color      `{ r, g, b, a }` — alpha premultiplied internally.
 */
export function drawGlyph(
  font: FntFile,
  buffer: Uint8Array | Uint8ClampedArray,
  bufferWidth: number,
  glyphIndex: number,
  x: number,
  y: number,
  color: Color,
): void {
  if (!font.isValidIndex(glyphIndex)) return;

  const bufferHeight = Math.floor(buffer.length / (bufferWidth * 4));
  const a = color.a;
  const r = Math.round(color.r * a / 255);
  const g = Math.round(color.g * a / 255);
  const b = Math.round(color.b * a / 255);

  const bytesPerRow = font.bytesPerRow;
  const glyphOffset = glyphIndex * font.bytesPerGlyph;

  for (let row = 0; row < font.glyphHeight; row++) {
    const pixelY = y + row;
    if (pixelY < 0 || pixelY >= bufferHeight) continue;

    const rowOffset = glyphOffset + row * bytesPerRow;

    for (let byteIdx = 0; byteIdx < bytesPerRow; byteIdx++) {
      const dataByte = font.data[rowOffset + byteIdx]!;
      if (dataByte === 0) continue;

      for (let bit = 7; bit >= 0; bit--) {
        if ((dataByte & (1 << bit)) === 0) continue;
        const pixelX = x + byteIdx * 8 + (7 - bit);
        if (pixelX < 0 || pixelX >= bufferWidth) continue;
        const pixelOffset = (pixelY * bufferWidth + pixelX) * 4;
        buffer[pixelOffset] = r;
        buffer[pixelOffset + 1] = g;
        buffer[pixelOffset + 2] = b;
        buffer[pixelOffset + 3] = a;
      }
    }
  }
}

/**
 * Map a character to its glyph index in the given font.
 * - English fonts (94 glyphs): ASCII 33-126.
 * - Korean fonts (2401 glyphs): EUC-KR Jamo + syllables via TextEncoder.
 * Returns -1 if the character is not supported.
 */
export function getGlyphIndex(font: FntFile, c: string): number {
  const code = c.charCodeAt(0);

  // English font (94 glyphs: ASCII 33-126)
  if (font.glyphCount === 94) {
    return code >= 33 && code <= 126 ? code - 33 : -1;
  }

  // Korean font (2401 glyphs)
  if (font.glyphCount === 2401) {
    if (code <= 127) return -1;

    try {
      const encoded = eucKrEncoder(c);
      if (!encoded || encoded.length !== 2) return -1;
      const lead = encoded[0]!;
      const trail = encoded[1]!;

      // Hangul Jamo: lead=0xA4, trail 0xA1-0xD3 → indices 0-50
      if (lead === 0xA4 && trail >= 0xA1 && trail <= 0xD3) return trail - 0xA1;

      // Hangul syllables: lead 0xB0-0xC8, trail 0xA1-0xFE → indices 51-2400
      if (lead >= 0xB0 && lead <= 0xC8 && trail >= 0xA1 && trail <= 0xFE) {
        return 51 + (lead - 0xB0) * 94 + (trail - 0xA1);
      }

      return -1;
    } catch {
      return -1;
    }
  }

  // Unknown font — try direct ASCII offset
  const index = code - 33;
  return font.isValidIndex(index) ? index : -1;
}

/**
 * Measure the pixel width of a text string rendered with the given font.
 * Tracks line breaks and returns the width of the widest line.
 */
export function measureText(font: FntFile, text: string): number {
  if (!text) return 0;
  const advance = font.glyphWidth - 2;
  let maxWidth = 0;
  let currentWidth = 0;

  for (const c of text) {
    if (c === '\n') {
      if (currentWidth > maxWidth) maxWidth = currentWidth;
      currentWidth = 0;
    } else {
      currentWidth += advance;
    }
  }

  return Math.max(maxWidth, currentWidth);
}

/**
 * Render a text string to an RgbaFrame using the given bitmap font and color.
 * Supports multi-line text (newline characters).
 * Characters unsupported by the font are rendered as blank space.
 */
export function renderText(font: FntFile, text: string, color: Color): RgbaFrame {
  if (!text) text = ' ';

  const advance = font.glyphWidth - 2;
  const lineCount = 1 + [...text].filter(c => c === '\n').length;
  const totalWidth = Math.max(1, measureText(font, text));
  const totalHeight = font.glyphHeight * lineCount;

  const data = new Uint8ClampedArray(totalWidth * totalHeight * 4);
  let cursorX = 0;
  let cursorY = 0;

  for (const c of text) {
    if (c === '\n') {
      cursorX = 0;
      cursorY += font.glyphHeight;
      continue;
    }
    const glyphIndex = getGlyphIndex(font, c);
    if (glyphIndex >= 0) {
      drawGlyph(font, data, totalWidth, glyphIndex, cursorX, cursorY, color);
    }
    cursorX += advance;
  }

  return { width: totalWidth, height: totalHeight, data };
}

// ---------------------------------------------------------------------------
// LFT text rendering — the format the client actually draws text with
// ---------------------------------------------------------------------------

/** Ink bounds of a measured line, in pixels relative to the pen origin. */
export interface LftTextMetrics {
  /** Sum of the glyph advances — use this to position the next string or control. */
  advanceWidth: number;
  /** Tight bounding box of the drawn pixels. Empty lines report all zeroes. */
  ink: { left: number; top: number; right: number; bottom: number };
}

/**
 * Convert text into the 16-bit glyph keys an {@link LftFile} is indexed by.
 *
 * LFT keys are raw ANSI bytes, not Unicode: a single byte becomes `0x0000`–`0x00FF`,
 * and a DBCS pair becomes `(lead << 8) | trail`. Pass a `string` only for single-byte
 * text — each code unit above `0xFF` cannot be represented and is skipped. For Korean,
 * Japanese or Traditional Chinese, encode to that code page yourself and pass the bytes
 * with an explicit `isLeadByte` predicate; relying on the host locale would split the
 * same byte string differently.
 *
 * Key `0xFFFF` has no record and is dropped.
 */
export function lftGlyphKeys(
  text: string | Uint8Array | number[],
  isLeadByte?: (byte: number) => boolean,
): number[] {
  let bytes: number[];
  if (typeof text === 'string') {
    bytes = [];
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code <= 0xff) bytes.push(code);
    }
  } else {
    bytes = Array.from(text);
  }

  const keys: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const first = bytes[i]!;
    let key = first;

    if (isLeadByte?.(first)) {
      // A lead byte at the very end of the buffer has no trail byte to pair with.
      if (i + 1 >= bytes.length) break;
      key = (first << 8) | bytes[++i]!;
    }

    if (key !== 0xffff) keys.push(key);
  }

  return keys;
}

/**
 * Measure one line of LFT text.
 *
 * Use {@link LftTextMetrics.advanceWidth} for layout and `ink` for a tightly cropped
 * image — they differ because each glyph carries its own bounds. This measures a single
 * line; splitting paragraphs is the caller's job, as it is in the client.
 */
export function measureLftText(font: LftFile, keys: number[]): LftTextMetrics {
  let penX = 0;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  for (const key of keys) {
    const glyph = font.getGlyph(key);
    if (glyph && glyph.bitmapOffset !== 0) {
      left = Math.min(left, penX + glyph.left);
      right = Math.max(right, penX + glyph.right);
      top = Math.min(top, glyph.top);
      bottom = Math.max(bottom, glyph.bottom);
    }
    penX += font.getAdvance(key);
  }

  const empty = left === Infinity;
  return {
    advanceWidth: penX,
    ink: empty
      ? { left: 0, top: 0, right: 0, bottom: 0 }
      : { left, top, right, bottom },
  };
}

/**
 * Draw one LFT glyph into an RGBA buffer at the given pen position.
 *
 * `lineTop` is the top of the nominal cell. Glyphs with no bitmap draw nothing but
 * still advance the pen — see {@link LftFile.getAdvance}.
 */
export function drawLftGlyph(
  font: LftFile,
  buffer: Uint8Array | Uint8ClampedArray,
  bufferWidth: number,
  key: number,
  penX: number,
  lineTop: number,
  color: Color,
): void {
  const glyph = font.getGlyph(key);
  if (!glyph || glyph.bitmapOffset === 0) return;

  const { width, height, data } = font.getGlyphPixels(key);
  if (width === 0 || height === 0) return;

  const bufferHeight = Math.floor(buffer.length / (bufferWidth * 4));
  const a = color.a;
  const r = Math.round((color.r * a) / 255);
  const g = Math.round((color.g * a) / 255);
  const b = Math.round((color.b * a) / 255);

  for (let y = 0; y < height; y++) {
    const pixelY = lineTop + glyph.top + y;
    if (pixelY < 0 || pixelY >= bufferHeight) continue;

    for (let x = 0; x < width; x++) {
      if (data[y * width + x] === 0) continue;
      const pixelX = penX + glyph.left + x;
      if (pixelX < 0 || pixelX >= bufferWidth) continue;

      const offset = (pixelY * bufferWidth + pixelX) * 4;
      buffer[offset] = r;
      buffer[offset + 1] = g;
      buffer[offset + 2] = b;
      buffer[offset + 3] = a;
    }
  }
}

/**
 * Render text to an RgbaFrame using an {@link LftFile} and real per-glyph metrics.
 *
 * Accepts the same input forms as {@link lftGlyphKeys}. Line feeds start a new line and
 * move down by the font's nominal height; every other control character follows the
 * client's zero-advance rule. The frame is `advanceWidth` wide by
 * `nominalHeight × lineCount` tall, retaining the original cell offsets rather than
 * cropping to ink.
 */
export function renderLftText(
  font: LftFile,
  text: string | Uint8Array | number[],
  color: Color,
  isLeadByte?: (byte: number) => boolean,
): RgbaFrame {
  const keys = lftGlyphKeys(text, isLeadByte);

  // Split on line feed; carriage returns advance by zero and are simply drawn as nothing.
  const lines: number[][] = [[]];
  for (const key of keys) {
    if (key === 0x0a) lines.push([]);
    else lines[lines.length - 1]!.push(key);
  }

  const metrics = lines.map(line => measureLftText(font, line));
  const width = Math.max(1, ...metrics.map(m => m.advanceWidth));
  const height = Math.max(1, font.nominalHeight * lines.length);

  const data = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < lines.length; i++) {
    const lineTop = i * font.nominalHeight;
    let penX = 0;
    for (const key of lines[i]!) {
      drawLftGlyph(font, data, width, key, penX, lineTop, color);
      penX += font.getAdvance(key);
    }
  }

  return { width, height, data };
}

// EUC-KR encoder: attempts TextEncoder('euc-kr'), falls back to returning null for non-ASCII
let _eucKrEncoder: ((s: string) => Uint8Array | null) | null = null;
function eucKrEncoder(s: string): Uint8Array | null {
  if (!_eucKrEncoder) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const enc = new (TextEncoder as any)('euc-kr');
      _eucKrEncoder = (str: string) => enc.encode(str) as Uint8Array;
    } catch {
      _eucKrEncoder = () => null;
    }
  }
  return _eucKrEncoder(s);
}
