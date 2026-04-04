import type { Color, RgbaFrame } from '../constants.js';
import { TILE_WIDTH, TILE_HEIGHT, TRANSPARENT } from '../constants.js';
import { EfaBlendingType } from '../enums.js';
import { decodeRgb565 } from '../utility/ColorCodec.js';
import type { EfaFrame } from './EfaFrame.js';
import type { EpfFrame } from './EpfFrame.js';
import { epfFrameHeight, epfFrameWidth } from './EpfFrame.js';
import type { FntFile } from './FntFile.js';
import { HeaFile } from './HeaFile.js';
import type { HpfFile } from './HpfFile.js';
import type { MpfFrame } from './MpfFrame.js';
import { mpfFrameHeight, mpfFrameWidth } from './MpfFrame.js';
import type { Palette } from './Palette.js';
import type { SpfFrame } from './SpfFrame.js';
import { spfFrameHeight, spfFrameWidth } from './SpfFrame.js';
import type { Tile } from './Tile.js';

// ---------------------------------------------------------------------------
// Core render helpers
// ---------------------------------------------------------------------------

/**
 * Render a palettized frame (1 byte per pixel) to an RgbaFrame.
 * Palette index 0 is always treated as transparent.
 */
export function renderPalettized(
  left: number,
  top: number,
  width: number,
  height: number,
  data: Uint8Array,
  palette: Palette,
): RgbaFrame {
  const dstOffsetX = Math.max(0, left);
  const dstOffsetY = Math.max(0, top);
  const bitmapWidth = width + dstOffsetX;
  const bitmapHeight = height + dstOffsetY;

  const pixels = new Uint8ClampedArray(bitmapWidth * bitmapHeight * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const paletteIndex = data[y * width + x]!;
      const color = paletteIndex === 0 ? TRANSPARENT : palette.get(paletteIndex);
      const dst = ((y + dstOffsetY) * bitmapWidth + (x + dstOffsetX)) * 4;
      pixels[dst] = color.r;
      pixels[dst + 1] = color.g;
      pixels[dst + 2] = color.b;
      pixels[dst + 3] = color.a;
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
): RgbaFrame {
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
      pixels[dst] = color.r;
      pixels[dst + 1] = color.g;
      pixels[dst + 2] = color.b;
      pixels[dst + 3] = color.a;
    }
  }

  return { width: bitmapWidth, height: bitmapHeight, data: pixels };
}

// ---------------------------------------------------------------------------
// Format-specific render entry points
// ---------------------------------------------------------------------------

/** Render an HpfFile to an RgbaFrame using the supplied palette. */
export function renderHpf(hpf: HpfFile, palette: Palette, yOffset = 0): RgbaFrame {
  return renderPalettized(0, yOffset, hpf.pixelWidth, hpf.pixelHeight, hpf.data, palette);
}

/** Render a palettized SpfFrame to an RgbaFrame. */
export function renderSpfPalettized(frame: SpfFrame, palette: Palette): RgbaFrame {
  return renderPalettized(frame.left, frame.top, spfFrameWidth(frame), spfFrameHeight(frame), frame.data!, palette);
}

/** Render a colorized SpfFrame to an RgbaFrame. */
export function renderSpfColorized(frame: SpfFrame): RgbaFrame {
  return renderColorized(frame.left, frame.top, spfFrameWidth(frame), spfFrameHeight(frame), frame.colorData!);
}

/** Render an MpfFrame to an RgbaFrame using the supplied palette. */
export function renderMpf(frame: MpfFrame, palette: Palette): RgbaFrame {
  return renderPalettized(frame.left, frame.top, mpfFrameWidth(frame), mpfFrameHeight(frame), frame.data, palette);
}

/** Render an EpfFrame to an RgbaFrame using the supplied palette. */
export function renderEpf(frame: EpfFrame, palette: Palette): RgbaFrame {
  return renderPalettized(frame.left, frame.top, epfFrameWidth(frame), epfFrameHeight(frame), frame.data, palette);
}

/**
 * Render an EfaFrame to an RgbaFrame, applying the specified blend mode.
 * Returns a frame with full image dimensions (imagePixelWidth × imagePixelHeight).
 */
export function renderEfa(
  frame: EfaFrame,
  blendingType: EfaBlendingType = EfaBlendingType.Additive,
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
      pixels[dst] = color.r;
      pixels[dst + 1] = color.g;
      pixels[dst + 2] = color.b;
      pixels[dst + 3] = alpha;
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
// Tile rendering
// ---------------------------------------------------------------------------

/** Render a palettized ground tile (56×27) to an RgbaFrame. */
export function renderTile(tile: Tile, palette: Palette): RgbaFrame {
  return renderPalettized(0, 0, TILE_WIDTH, TILE_HEIGHT, tile.data, palette);
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
