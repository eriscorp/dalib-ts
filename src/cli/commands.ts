import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Color, RgbaFrame } from '../constants.js';
import type { DataArchiveEntry } from '../data/DataArchiveEntry.js';
import { MapFile } from '../data/MapFile.js';
import { SotpDirection, SotpFile } from '../data/SotpFile.js';
import { ColorTable } from '../drawing/ColorTable.js';
import { EfaFile } from '../drawing/EfaFile.js';
import { EpfFile } from '../drawing/EpfFile.js';
import { epfFrameHeight, epfFrameWidth } from '../drawing/EpfFrame.js';
import { renderEfa, renderEpf, renderHpf, renderMpf, renderSpfColorized, renderSpfPalettized } from '../drawing/Graphics.js';
import { HpfFile } from '../drawing/HpfFile.js';
import { MpfFile } from '../drawing/MpfFile.js';
import { mpfFrameHeight, mpfFrameWidth } from '../drawing/MpfFrame.js';
import { Palette } from '../drawing/Palette.js';
import { PaletteResolver } from '../drawing/PaletteResolver.js';
import { matchPaletteRule } from '../drawing/paletteRules.js';
import { PaletteTable } from '../drawing/PaletteTable.js';
import { SpfFile } from '../drawing/SpfFile.js';
import { spfFrameHeight, spfFrameWidth } from '../drawing/SpfFrame.js';
import { encodePng } from '../io/PngWriter.js';
import { CliError, entryCount, insideFolder, type CliContext, type OpenArchive } from './context.js';

/**
 * One function for each command of the client-asset CLI (HTOO-706). Each one
 * calls the library's public classes. The interface reads the client and never
 * writes to it: `extract` writes copies, outside the client folder.
 */

/** Lists longer than this are cut unless the command is given `--all`. */
export const LIST_LIMIT = 50;

/** The longest side of a render, after scaling, unless `--max` says otherwise. */
export const RENDER_LIMIT = 1024;

export interface Cut<T> {
  items: T[];
  more?: number;
}

function cut<T>(list: T[], all: boolean | undefined): Cut<T> {
  return all || list.length <= LIST_LIMIT ? { items: list } : { items: list.slice(0, LIST_LIMIT), more: list.length - LIST_LIMIT };
}

const hasGlob = (s: string): boolean => /[*?]/.test(s);

/** A glob (`*`, `?`) as a case-folded test. Text with no glob is a prefix. */
export function nameMatcher(pattern: string | undefined): (name: string) => boolean {
  if (!pattern) return () => true;
  const p = pattern.toLowerCase();
  if (!hasGlob(p)) return (name) => name.toLowerCase().startsWith(p);
  const source = p.replace(/[.+^${}()|[\]\\]/g, (c) => `\\${c}`).replace(/\*/g, '.*').replace(/\?/g, '.');
  const re = new RegExp(`^${source}$`);
  return (name) => re.test(name.toLowerCase());
}

const ext = (name: string): string => name.slice(name.lastIndexOf('.') + 1).toLowerCase();

const hex = (c: Color): string =>
  `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('')}${c.a === 255 ? '' : c.a.toString(16).padStart(2, '0')}`;

function entryOf(a: OpenArchive, name: string): DataArchiveEntry {
  const entry = a.archive.get(name);
  if (!entry) throw new CliError(`No entry "${name}" in ${a.name}`);
  return entry;
}

/** Every `.dat` the client holds, with its entry count and size, from the headers. */
export function archives(ctx: CliContext): { client: string; archives: { name: string; entries: number; bytes: number }[] } {
  const dir = ctx.clientDir();
  const list = [...ctx.datNames().values()].sort((a, b) => a.localeCompare(b));
  return {
    client: dir,
    archives: list.map((name) => {
      const path = join(dir, name);
      return { name, entries: entryCount(path), bytes: statSync(path).size };
    }),
  };
}

/** Entries matching a glob or a prefix, in one archive or (`*`) in every one. */
export function ls(ctx: CliContext, archive: string, pattern: string | undefined, all?: boolean) {
  const names = archive === '*' ? [...ctx.datNames().values()].sort((a, b) => a.localeCompare(b)) : [archive];
  const test = nameMatcher(pattern);
  const rows: { archive: string; name: string; bytes: number }[] = [];
  for (const n of names) {
    const a = ctx.open(n);
    for (const e of a.archive.entries) if (test(e.entryName)) rows.push({ archive: a.name, name: e.entryName, bytes: e.fileSize });
  }
  return { pattern: pattern ?? null, total: rows.length, ...cut(rows, all) };
}

/** A text entry as a string (ASCII, else EUC-KR), or its bytes as hex. */
export function cat(ctx: CliContext, archive: string, name: string, opts: { hex?: boolean; encoding?: string | undefined } = {}) {
  const a = ctx.open(archive);
  const bytes = entryOf(a, name).toUint8Array();
  if (opts.hex) {
    const shown = bytes.subarray(0, 4096);
    return {
      archive: a.name,
      name,
      bytes: bytes.length,
      hex: [...shown].map((b) => b.toString(16).padStart(2, '0')).join(' '),
      ...(bytes.length > shown.length ? { truncated: true } : {}),
    };
  }
  const encoding = opts.encoding ?? (bytes.every((b) => b < 0x80) ? 'ascii' : 'euc-kr');
  let text: string;
  try {
    text = new TextDecoder(encoding === 'ascii' ? 'utf-8' : encoding, { fatal: false }).decode(bytes);
  } catch {
    throw new CliError(`Unknown encoding "${encoding}"`);
  }
  return { archive: a.name, name, bytes: bytes.length, encoding, text };
}

interface FrameRow {
  index: number;
  left: number;
  top: number;
  width: number;
  height: number;
  empty: boolean;
}

const frameRow = (index: number, left: number, top: number, width: number, height: number): FrameRow => ({
  index,
  left,
  top,
  width: Math.max(0, width),
  height: Math.max(0, height),
  empty: width <= 0 || height <= 0,
});

/** What the library reads in one entry, by its extension. */
function describe(a: OpenArchive, entry: DataArchiveEntry, all?: boolean): Record<string, unknown> {
  const kind = ext(entry.entryName);
  const base = { archive: a.name, name: entry.entryName, bytes: entry.fileSize, kind };
  const rule = matchPaletteRule(a.name, entry.entryName);
  const palette = rule ? { ruleId: rule.ruleId, kind: rule.kind } : null;
  const frames = (rows: FrameRow[]) => ({
    frameCount: rows.length,
    emptyFrames: rows.filter((r) => r.empty).map((r) => r.index),
    frames: cut(rows, all),
  });
  switch (kind) {
    case 'epf': {
      const f = EpfFile.fromEntry(entry);
      const rows = f.frames.map((fr, i) => frameRow(i, fr.left, fr.top, epfFrameWidth(fr), epfFrameHeight(fr)));
      return { ...base, width: f.pixelWidth, height: f.pixelHeight, palette, ...frames(rows) };
    }
    case 'mpf': {
      const f = MpfFile.fromEntry(entry);
      const rows = f.frames.map((fr, i) => frameRow(i, fr.left, fr.top, mpfFrameWidth(fr), mpfFrameHeight(fr)));
      return {
        ...base,
        width: f.pixelWidth,
        height: f.pixelHeight,
        paletteNumber: f.paletteNumber,
        animation: {
          format: f.formatType === -1 ? 'multipleAttacks' : 'singleAttack',
          walk: { index: f.walkFrameIndex, count: f.walkFrameCount },
          standing: { index: f.standingFrameIndex, count: f.standingFrameCount },
          optionalCount: f.optionalAnimationFrameCount,
          intervalMs: f.animationIntervalMs,
        },
        palette,
        ...frames(rows),
      };
    }
    case 'hpf': {
      const f = HpfFile.fromEntry(entry);
      return { ...base, width: f.pixelWidth, height: f.pixelHeight, palette };
    }
    case 'spf': {
      const f = SpfFile.fromEntry(entry);
      const rows = f.frames.map((fr, i) => frameRow(i, fr.left, fr.top, spfFrameWidth(fr), spfFrameHeight(fr)));
      return { ...base, format: f.format === 0 ? 'palettized' : 'colorized', ...frames(rows) };
    }
    case 'efa': {
      const f = EfaFile.fromEntry(entry);
      const rows = f.frames.map((fr, i) => frameRow(i, fr.left, fr.top, fr.imagePixelWidth, fr.imagePixelHeight));
      return { ...base, blending: f.blendingType, intervalMs: f.frameIntervalMs, ...frames(rows) };
    }
    case 'pal':
      return { ...base, colors: Palette.fromEntry(entry).length };
    default:
      return { ...base, palette };
  }
}

/** One entry in detail, or (with a glob) one row for each matching entry. */
export function info(ctx: CliContext, archive: string, nameOrPattern: string, all?: boolean) {
  const a = ctx.open(archive);
  if (!hasGlob(nameOrPattern)) return describe(a, entryOf(a, nameOrPattern), all);
  const test = nameMatcher(nameOrPattern);
  const rows = a.archive.entries
    .filter((e) => test(e.entryName))
    .map((e) => {
      try {
        const d = describe(a, e, false);
        return {
          name: e.entryName,
          bytes: e.fileSize,
          ...(typeof d.frameCount === 'number' ? { frameCount: d.frameCount, emptyFrames: (d.emptyFrames as number[]).length } : {}),
        };
      } catch (err) {
        return { name: e.entryName, bytes: e.fileSize, error: (err as Error).message };
      }
    });
  return { archive: a.name, pattern: nameOrPattern, total: rows.length, ...cut(rows, all) };
}

/** A palette named `name.pal` (in `a`) or `archive/name.pal`. */
function namedPalette(ctx: CliContext, a: OpenArchive, spec: string): { palette: Palette; source: string } {
  const slash = spec.lastIndexOf('/');
  const from = slash === -1 ? a : ctx.open(spec.slice(0, slash));
  const name = slash === -1 ? spec : spec.slice(slash + 1);
  return { palette: Palette.fromEntry(entryOf(from, name)), source: `${from.name}/${name}` };
}

interface PaletteChoice {
  palette: Palette;
  source: string;
  ruleId?: string;
  paletteNumber?: number;
}

function choosePalette(ctx: CliContext, a: OpenArchive, entry: DataArchiveEntry, spec: string | undefined, frame: number): PaletteChoice {
  if (spec && spec !== 'auto') return namedPalette(ctx, a, spec);
  const resolved = new PaletteResolver(a.name, a.archive, ctx.provider).resolve(entry, frame);
  if (!resolved) {
    throw new CliError(`No palette rule resolves ${a.name}/${entry.entryName}; pass --palette <name.pal> or <archive>/<name.pal>`);
  }
  return { palette: resolved.palette, source: 'auto', ruleId: resolved.ruleId, paletteNumber: resolved.paletteNumber };
}

function dyed(ctx: CliContext, a: OpenArchive, palette: Palette, dye: number): Palette {
  const holder = a.archive.has('color0.tbl') ? a : ctx.open('legend');
  const table = ColorTable.fromEntry(entryOf(holder, 'color0.tbl'));
  const row = table.get(dye);
  if (!row) throw new CliError(`color0.tbl has no dye ${dye}`);
  return palette.dye(row);
}

/** "0,3-5" as frame indexes, each checked against the count. */
export function parseFrames(spec: string | undefined, count: number, sheet: boolean): number[] {
  if (count === 0) throw new CliError('The entry has no frames');
  if (!spec) return sheet ? Array.from({ length: count }, (_, i) => i) : [0];
  const out: number[] = [];
  for (const part of spec.split(',')) {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
    if (!m) throw new CliError(`--frames takes indexes and ranges such as "0,3-5", not "${spec}"`);
    const from = Number(m[1]);
    const to = m[2] === undefined ? from : Number(m[2]);
    for (let i = Math.min(from, to); i <= Math.max(from, to); i++) {
      if (i >= count) throw new CliError(`Frame ${i} is out of range: the entry has ${count} frames (0-${count - 1})`);
      out.push(i);
    }
  }
  return out;
}

function parseBackground(spec: string | undefined): [number, number, number, number] {
  if (!spec || spec === 'transparent') return [0, 0, 0, 0];
  const m = /^#?([0-9a-f]{6})$/i.exec(spec);
  if (!m) throw new CliError(`--bg takes "transparent" or #rrggbb, not "${spec}"`);
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

/** Frames laid out left to right in `columns`, on a background, then scaled. */
export function compose(frames: RgbaFrame[], columns: number, scale: number, bg: [number, number, number, number]): RgbaFrame {
  const cellW = Math.max(...frames.map((f) => f.width));
  const cellH = Math.max(...frames.map((f) => f.height));
  const cols = Math.min(columns, frames.length);
  const rows = Math.ceil(frames.length / cols);
  const w = cellW * cols * scale;
  const h = cellH * rows * scale;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) data.set(bg, i);
  frames.forEach((f, n) => {
    const ox = (n % cols) * cellW;
    const oy = Math.floor(n / cols) * cellH;
    for (let y = 0; y < f.height; y++) {
      for (let x = 0; x < f.width; x++) {
        const src = (y * f.width + x) * 4;
        if (f.data[src + 3] === 0) continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const dst = (((oy + y) * scale + sy) * w + (ox + x) * scale + sx) * 4;
            data.set(f.data.subarray(src, src + 4), dst);
          }
        }
      }
    }
  });
  return { width: w, height: h, data };
}

export interface RenderOptions {
  frames?: string | undefined;
  palette?: string | undefined;
  dye?: number | undefined;
  scale?: number | undefined;
  sheet?: number | undefined;
  bg?: string | undefined;
  max?: number | undefined;
  out?: string | undefined;
}

/** Render frames of an EPF, MPF, HPF, SPF or EFA entry to a PNG. */
export function render(ctx: CliContext, archive: string, name: string, opts: RenderOptions = {}) {
  const a = ctx.open(archive);
  const entry = entryOf(a, name);
  const kind = ext(entry.entryName);
  const scale = opts.scale ?? 1;
  if (!Number.isInteger(scale) || scale < 1 || scale > 16) throw new CliError('--scale takes a whole number from 1 to 16');
  if (opts.sheet !== undefined && (!Number.isInteger(opts.sheet) || opts.sheet < 1)) throw new CliError('--sheet takes a number of columns');
  if (opts.dye !== undefined && !['epf', 'mpf', 'hpf'].includes(kind)) throw new CliError(`--dye applies to EPF, MPF and HPF, not ${kind}`);
  if (opts.palette !== undefined && !['epf', 'mpf', 'hpf'].includes(kind)) throw new CliError(`--palette applies to EPF, MPF and HPF; a ${kind} carries its own colours`);

  let chosen: PaletteChoice | null = null;
  const paletteFor = (frame: number): Palette => {
    const c = choosePalette(ctx, a, entry, opts.palette, frame);
    chosen ??= c;
    return opts.dye === undefined ? c.palette : dyed(ctx, a, c.palette, opts.dye);
  };

  const sheet = opts.sheet !== undefined;
  let indexes: number[];
  let images: RgbaFrame[];
  switch (kind) {
    case 'epf': {
      const f = EpfFile.fromEntry(entry);
      indexes = parseFrames(opts.frames, f.frames.length, sheet);
      images = indexes.map((i) => renderEpf(f.frames[i]!, paletteFor(i)));
      break;
    }
    case 'mpf': {
      const f = MpfFile.fromEntry(entry);
      indexes = parseFrames(opts.frames, f.frames.length, sheet);
      images = indexes.map((i) => renderMpf(f.frames[i]!, paletteFor(i)));
      break;
    }
    case 'hpf': {
      indexes = parseFrames(opts.frames, 1, sheet);
      images = [renderHpf(HpfFile.fromEntry(entry), paletteFor(0))];
      break;
    }
    case 'spf': {
      const f = SpfFile.fromEntry(entry);
      indexes = parseFrames(opts.frames, f.frames.length, sheet);
      images = indexes.map((i) =>
        f.format === 0 ? renderSpfPalettized(f.frames[i]!, f.primaryColors ?? new Palette()) : renderSpfColorized(f.frames[i]!),
      );
      break;
    }
    case 'efa': {
      const f = EfaFile.fromEntry(entry);
      indexes = parseFrames(opts.frames, f.frames.length, sheet);
      images = indexes.map((i) => renderEfa(f.frames[i]!, f.blendingType));
      break;
    }
    default:
      throw new CliError(`render takes an EPF, MPF, HPF, SPF or EFA entry, not .${kind}`);
  }

  const image = compose(images, opts.sheet ?? 1, scale, parseBackground(opts.bg));
  const limit = opts.max ?? RENDER_LIMIT;
  if (Math.max(image.width, image.height) > limit) {
    throw new CliError(
      `The render would be ${image.width}x${image.height}, over the ${limit} px limit; render fewer frames, a smaller --scale, or pass --max`,
    );
  }
  const png = encodePng(image);
  let written: string | undefined;
  if (opts.out) {
    written = resolve(ctx.base, opts.out);
    mkdirSync(dirname(written), { recursive: true });
    writeFileSync(written, png);
  }
  const c = chosen as PaletteChoice | null;
  return {
    result: {
      archive: a.name,
      name: entry.entryName,
      frames: indexes,
      width: image.width,
      height: image.height,
      ...(c ? { palette: { source: c.source, ...(c.ruleId ? { ruleId: c.ruleId, paletteNumber: c.paletteNumber } : {}) } } : {}),
      ...(opts.dye !== undefined ? { dye: opts.dye } : {}),
      ...(written ? { out: written } : {}),
    },
    png,
  };
}

/** The palette an entry resolves to, and its colours on request. */
export function palette(ctx: CliContext, archive: string, name: string, opts: { colors?: boolean; frame?: number | undefined } = {}) {
  const a = ctx.open(archive);
  const entry = entryOf(a, name);
  const resolved = new PaletteResolver(a.name, a.archive, ctx.provider).resolve(entry, opts.frame ?? 0);
  const rule = matchPaletteRule(a.name, entry.entryName);
  if (!resolved) return { archive: a.name, name: entry.entryName, resolved: false, ruleId: rule?.ruleId ?? null };
  return {
    archive: a.name,
    name: entry.entryName,
    resolved: true,
    ruleId: resolved.ruleId,
    kind: resolved.kind,
    paletteNumber: resolved.paletteNumber,
    luminanceBlended: resolved.luminanceBlended,
    ...(opts.colors ? { colors: resolved.palette.colors.map(hex) } : {}),
  };
}

/** The indexes where two palettes differ. Each is `archive/name.pal`. */
export function paletteDiff(ctx: CliContext, first: string, second: string) {
  const load = (spec: string) => {
    const slash = spec.lastIndexOf('/');
    if (slash === -1) throw new CliError(`A palette is <archive>/<name.pal>, not "${spec}"`);
    return namedPalette(ctx, ctx.open(spec.slice(0, slash)), spec.slice(slash + 1));
  };
  const a = load(first);
  const b = load(second);
  const diffs: { index: number; first: string; second: string }[] = [];
  for (let i = 0; i < 256; i++) {
    const x = hex(a.palette.get(i));
    const y = hex(b.palette.get(i));
    if (x !== y) diffs.push({ index: i, first: x, second: y });
  }
  return { first: a.source, second: b.source, differ: diffs.length, diffs };
}

/** A colour table (`color*.tbl`), a palette-cycling table (`<n>.tbl`) or a palette lookup table. */
export function tbl(ctx: CliContext, archive: string, name: string, as?: string, all?: boolean) {
  const a = ctx.open(archive);
  const entry = entryOf(a, name);
  const lower = entry.entryName.toLowerCase();
  const kind = as ?? (lower.startsWith('color') ? 'color' : /\d\.tbl$/.test(lower) ? 'cycling' : 'palette');
  switch (kind) {
    case 'color': {
      const t = ColorTable.fromEntry(entry);
      const rows = t.entries.map((e) => ({ index: e.colorIndex, colors: e.colors.map(hex) }));
      return { archive: a.name, name: entry.entryName, as: kind, total: rows.length, ...cut(rows, all) };
    }
    case 'cycling':
      return { archive: a.name, name: entry.entryName, as: kind, entries: PaletteTable.cyclingEntriesFromEntry(entry) };
    case 'palette': {
      const lines = PaletteTable.fromEntry(entry)
        .toText()
        .split(/\r?\n/)
        .filter((l) => l.trim());
      return { archive: a.name, name: entry.entryName, as: kind, total: lines.length, ...cut(lines, all) };
    }
    default:
      throw new CliError(`--as takes color, cycling or palette, not "${kind}"`);
  }
}

function parseSize(spec: string | undefined): [number, number] {
  const m = spec ? /^(\d+)x(\d+)$/i.exec(spec) : null;
  if (!m) throw new CliError('A map needs --size <width>x<height>; a map file does not hold its size');
  return [Number(m[1]), Number(m[2])];
}

function loadMap(ctx: CliContext, file: string, size: [number, number]): { path: string; map: MapFile } {
  const path = resolve(ctx.base, file);
  try {
    return { path, map: MapFile.fromFile(path, size[0], size[1]) };
  } catch (err) {
    throw new CliError(`Cannot read the map ${path} at ${size[0]}x${size[1]}: ${(err as Error).message}`);
  }
}

/** A map's distinct tile ids for each layer, with counts, or the tile at one point. */
export function map(ctx: CliContext, file: string, sizeSpec: string | undefined, opts: { at?: string | undefined; all?: boolean } = {}) {
  const size = parseSize(sizeSpec);
  const { path, map: m } = loadMap(ctx, file, size);
  if (opts.at) {
    const p = /^(\d+),(\d+)$/.exec(opts.at);
    if (!p) throw new CliError('--at takes x,y');
    const [x, y] = [Number(p[1]), Number(p[2])];
    if (x >= m.width || y >= m.height) throw new CliError(`${x},${y} is outside the ${m.width}x${m.height} map`);
    return { file: path, width: m.width, height: m.height, at: { x, y, ...m.getTile(x, y) } };
  }
  const layer = (pick: (t: (typeof m.tiles)[number]) => number) => {
    const counts = new Map<number, number>();
    for (const t of m.tiles) counts.set(pick(t), (counts.get(pick(t)) ?? 0) + 1);
    const rows = [...counts].sort((x, y) => y[1] - x[1] || x[0] - y[0]).map(([id, count]) => ({ id, count }));
    return { distinct: rows.length, ...cut(rows, opts.all) };
  };
  return {
    file: path,
    width: m.width,
    height: m.height,
    background: layer((t) => t.background),
    leftForeground: layer((t) => t.leftForeground),
    rightForeground: layer((t) => t.rightForeground),
  };
}

/** The cells where two maps of one size differ. */
export function mapDiff(ctx: CliContext, first: string, second: string, sizeSpec: string | undefined, all?: boolean) {
  const size = parseSize(sizeSpec);
  const a = loadMap(ctx, first, size);
  const b = loadMap(ctx, second, size);
  const cells: Record<string, unknown>[] = [];
  for (let y = 0; y < size[1]; y++) {
    for (let x = 0; x < size[0]; x++) {
      const p = a.map.getTile(x, y);
      const q = b.map.getTile(x, y);
      if (p.background !== q.background || p.leftForeground !== q.leftForeground || p.rightForeground !== q.rightForeground)
        cells.push({ x, y, first: p, second: q });
    }
  }
  return { first: a.path, second: b.path, differ: cells.length, ...cut(cells, all) };
}

const DIRECTIONS: [string, SotpDirection][] = [
  ['left', SotpDirection.Left],
  ['down', SotpDirection.Down],
  ['right', SotpDirection.Right],
  ['up', SotpDirection.Up],
];

/** The SOTP flags of each static tile id (`sotp.dat` in `ia.dat`). */
export function sotp(ctx: CliContext, ids: string[]) {
  const a = ctx.open('ia');
  const s = SotpFile.fromEntry(entryOf(a, 'sotp.dat'));
  return {
    maxTileId: s.maxTileId,
    tiles: ids.map((raw) => {
      const id = Number(raw);
      if (!Number.isInteger(id) || id < 0) throw new CliError(`A tile id is a whole number, not "${raw}"`);
      const flags = s.getFlags(id);
      return {
        id,
        flags: `0x${flags.toString(16).padStart(2, '0')}`,
        collision: s.getCollision(id),
        renderFlags: s.getRenderFlags(id),
        overPlayer: s.isOverPlayer(id),
        blocks: Object.fromEntries(DIRECTIONS.map(([n, d]) => [n, s.blocksMovement(id, d)])),
      };
    }),
  };
}

/** Write copies of the matching entries to a folder outside the client folder. */
export function extract(ctx: CliContext, archive: string, pattern: string, out: string | undefined) {
  if (!out) throw new CliError('extract needs --out <dir>');
  const dir = resolve(ctx.base, out);
  const a = ctx.open(archive);
  // With no client folder the archive came by path; its own folder is still guarded.
  let client: string | undefined;
  try {
    client = ctx.clientDir();
  } catch {
    client = undefined;
  }
  if (client !== undefined && insideFolder(client, dir)) throw new CliError(`Refused: ${dir} is inside the client folder`);
  if (insideFolder(dirname(a.path), dir)) throw new CliError(`Refused: ${dir} is inside the archive's folder`);
  const test = nameMatcher(pattern);
  const written: string[] = [];
  mkdirSync(dir, { recursive: true });
  for (const e of a.archive.entries) {
    if (!test(e.entryName)) continue;
    writeFileSync(join(dir, e.entryName), e.toUint8Array());
    written.push(e.entryName);
  }
  return { archive: a.name, out: dir, count: written.length, files: written };
}
