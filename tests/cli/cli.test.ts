import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { deflateSync, inflateSync } from 'node:zlib';
import type { RgbaFrame } from '../../src/constants.js';
import { MapFile } from '../../src/data/MapFile.js';
import { EfaFile } from '../../src/drawing/EfaFile.js';
import { EpfFile } from '../../src/drawing/EpfFile.js';
import { HpfFile } from '../../src/drawing/HpfFile.js';
import { MpfFile } from '../../src/drawing/MpfFile.js';
import { SpfFile } from '../../src/drawing/SpfFile.js';
import { EfaBlendingType } from '../../src/enums.js';
import { run, parseArgs, main } from '../../src/cli/cli.js';
import { compose, nameMatcher, parseFrames } from '../../src/cli/commands.js';
import { createContext, entryCount } from '../../src/cli/context.js';
import { handle, serve, TOOLS } from '../../src/cli/mcp.js';
import { buildArchiveBytes } from '../archiveFixture.js';

// HTOO-706. The CLI on a client folder of synthetic archives in a temp folder,
// so every command and every refusal runs without a real client.

const solid = (w: number, h: number, r: number, g: number, b: number): RgbaFrame => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) data.set([r, g, b, 255], i);
  return { width: w, height: h, data };
};
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

let client: string;
let out: string;

beforeAll(() => {
  client = mkdtempSync(join(tmpdir(), 'dalib-cli-client-'));
  out = mkdtempSync(join(tmpdir(), 'dalib-cli-out-'));

  const mpf = MpfFile.fromRgbaFrames([solid(4, 3, 255, 0, 0), solid(2, 2, 0, 0, 255), solid(3, 3, 0, 255, 0)]);
  const orphan = MpfFile.fromBuffer(mpf.entity.toUint8Array());
  orphan.paletteNumber = 7; // no mns007.pal: the rule cannot resolve it
  const epf = EpfFile.fromRgbaFrames([solid(3, 2, 255, 255, 0), solid(2, 2, 0, 255, 255)]);
  const hpf = new HpfFile(new Uint8Array(8), new Uint8Array(28 * 2).fill(1));
  const spf = SpfFile.fromPalettizedRgbaFrames([solid(2, 2, 10, 20, 30)]);
  const spfColor = SpfFile.fromColorizedRgbaFrames([solid(2, 2, 200, 100, 50)]);
  const efa = EfaFile.fromRgbaFrames([solid(3, 3, 255, 0, 0)], EfaBlendingType.Additive, 50);

  writeFileSync(
    join(client, 'hades.dat'),
    buildArchiveBytes([
      { name: 'mns000.pal', data: mpf.palette.toUint8Array() },
      { name: 'mns001.mpf', data: mpf.entity.toUint8Array() },
      { name: 'mns002.mpf', data: orphan.toUint8Array() },
      { name: 'test.epf', data: epf.entity.toUint8Array() },
      { name: 'test.pal', data: epf.palette.toUint8Array() },
      { name: 'other.pal', data: mpf.palette.toUint8Array() },
      { name: 'test.hpf', data: hpf.toUint8Array() },
      { name: 'test.spf', data: spf.toUint8Array() },
      { name: 'color.spf', data: spfColor.toUint8Array() },
      { name: 'spell.efa', data: efa.toUint8Array((d) => new Uint8Array(deflateSync(d))) },
      { name: 'notes.txt', data: enc('hello\nworld') },
      { name: 'korean.txt', data: new Uint8Array([0xb0, 0xa1]) },
      { name: 'data.bin', data: new Uint8Array(5000).fill(7) },
      { name: 'stspal.tbl', data: enc('1 3 7\n') },
      { name: 'mpt001.tbl', data: enc('10 20 300\n') },
    ]),
  );
  // The installer's casing: a name lookup must fold it.
  writeFileSync(
    join(client, 'Legend.dat'),
    // The first line is the number of colours in each entry.
    buildArchiveBytes([{ name: 'color0.tbl', data: enc(['2', '3', '9,9,9', '8,8,8'].join('\n')) }]),
  );
  writeFileSync(join(client, 'ia.dat'), buildArchiveBytes([{ name: 'sotp.dat', data: new Uint8Array([0x0f, 0x80, 0x00]) }]));
  writeFileSync(join(client, 'readme.txt'), 'not an archive');

  const a = new MapFile(2, 2);
  a.setTile(0, 0, { background: 5, leftForeground: 1, rightForeground: 0 });
  a.setTile(1, 1, { background: 5, leftForeground: 0, rightForeground: 2 });
  writeFileSync(join(out, 'a.map'), a.toUint8Array());
  a.setTile(1, 0, { background: 9, leftForeground: 0, rightForeground: 0 });
  writeFileSync(join(out, 'b.map'), a.toUint8Array());
});

afterAll(() => {
  rmSync(client, { recursive: true, force: true });
  rmSync(out, { recursive: true, force: true });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Out = Record<string, any>;

const call = async (...argv: string[]): Promise<Out & { code: number }> => {
  const { out: o, code } = await run([...argv, '--client', client], { INIT_CWD: out });
  return { ...(o as Out), code };
};

/** Width, height and the RGBA bytes of a PNG this module wrote. */
function decodePng(png: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let at = 8;
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  for (;;) {
    const len = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const data = png.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
    }
    if (type === 'IDAT') idat.push(data);
    at += 12 + len;
    if (type === 'IEND') break;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) rgba.set(raw.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4);
  return { width, height, rgba };
}

describe('the CLI', () => {
  it('parses flags, booleans and positionals', () => {
    expect(parseArgs(['render', 'hades', 'a.mpf', '--scale', '2', '--inline', '--bg=#000000'])).toEqual({
      positional: ['render', 'hades', 'a.mpf'],
      flags: { scale: '2', inline: true, bg: '#000000' },
    });
    expect(() => parseArgs(['ls', '--client'])).toThrow('--client needs a value');
  });

  it('prints usage with no command and with --help, and refuses an unknown command', async () => {
    expect((await run([], {})).code).toBe(2);
    expect((await run(['ls', '--help'], {})).code).toBe(0);
    expect((await run(['ls', '--client'], {})).code).toBe(2);
    expect(await call('fly')).toMatchObject({ code: 2, error: 'No command "fly"' });
    expect(await call('render', 'hades', 'test.epf', '--scale', 'big', '--inline')).toMatchObject({
      code: 2,
      error: '--scale must be a number',
    });
  });

  it('refuses each command that is missing an argument', async () => {
    for (const command of ['ls', 'cat', 'info', 'render', 'palette', 'palette-diff', 'tbl', 'map', 'map-diff', 'sotp', 'extract']) {
      expect((await call(command)).code).toBe(2);
    }
    expect((await call('render', 'hades', 'test.epf')).error).toBe('render needs --out <file.png>');
  });

  it('needs a client folder, and says so', async () => {
    const r = await run(['archives'], {});
    expect(r.code).toBe(1);
    expect((r.out as Out).error).toBe('No client folder: pass --client <dir> or set DALIB_CLIENT_DIR');
    const env = await run(['archives'], { DALIB_CLIENT_DIR: client });
    expect((env.out as Out).ok).toBe(true);
    expect((await run(['archives', '--client', join(client, 'nope')], {})).out).toMatchObject({ ok: false });
  });

  it('archives: each .dat with its entry count, from the header', async () => {
    const { result } = await call('archives');
    expect(result.archives.map((a: Out) => [a.name, a.entries])).toEqual([
      ['hades.dat', 15],
      ['ia.dat', 1],
      ['Legend.dat', 1],
    ]);
    expect(entryCount(join(client, 'ia.dat'))).toBe(1);
  });

  it('ls: a glob, a prefix, every archive, and the cut', async () => {
    expect((await call('ls', 'hades', '*.mpf')).result.items.map((r: Out) => r.name)).toEqual(['mns001.mpf', 'mns002.mpf']);
    expect((await call('ls', 'hades', 'mns')).result.total).toBe(3);
    expect((await call('ls', '*', '*.tbl')).result.items.map((r: Out) => r.archive)).toEqual(['hades.dat', 'hades.dat', 'Legend.dat']);
    // Case folded: the installer writes Legend.dat
    expect((await call('ls', 'legend')).result.items[0]).toMatchObject({ archive: 'Legend.dat', name: 'color0.tbl' });
    expect(await call('ls', 'nothing')).toMatchObject({ code: 1, error: `No archive "nothing" in ${client}` });
  });

  it('ls opens an archive by path', async () => {
    const r = await run(['ls', join(client, 'ia.dat')], { INIT_CWD: out });
    expect((r.out as Out).result.items[0].name).toBe('sotp.dat');
    expect(((await run(['ls', './missing.dat'], { INIT_CWD: out })).out as Out).error).toMatch(/^No archive "\.\/missing\.dat"/);
  });

  it('cat: ASCII text, EUC-KR text, hex, and a missing entry', async () => {
    expect((await call('cat', 'hades', 'notes.txt')).result).toMatchObject({ encoding: 'ascii', text: 'hello\nworld' });
    expect((await call('cat', 'hades', 'korean.txt')).result).toMatchObject({ encoding: 'euc-kr', text: '가' });
    expect((await call('cat', 'hades', 'notes.txt', '--hex')).result.hex).toBe('68 65 6c 6c 6f 0a 77 6f 72 6c 64');
    expect((await call('cat', 'hades', 'data.bin', '--hex')).result.truncated).toBe(true);
    expect((await call('cat', 'hades', 'notes.txt', '--encoding', 'nonsense')).error).toBe('Unknown encoding "nonsense"');
    expect((await call('cat', 'hades', 'none.txt')).error).toBe('No entry "none.txt" in hades.dat');
  });

  it('info: an MPF in detail, each format, and a glob of rows', async () => {
    const mpf = (await call('info', 'hades', 'mns001.mpf')).result;
    expect(mpf).toMatchObject({ kind: 'mpf', paletteNumber: 0, frameCount: 3, emptyFrames: [], palette: { ruleId: 'mpf/mns' } });
    expect(mpf.frames.items[0]).toMatchObject({ index: 0, width: 4, height: 3, empty: false });
    expect(mpf.animation.format).toBe('singleAttack');
    expect((await call('info', 'hades', 'test.epf')).result).toMatchObject({ kind: 'epf', frameCount: 2 });
    expect((await call('info', 'hades', 'test.hpf')).result).toMatchObject({ kind: 'hpf', width: 28, height: 2 });
    expect((await call('info', 'hades', 'test.spf')).result).toMatchObject({ kind: 'spf', format: 'palettized', frameCount: 1 });
    expect((await call('info', 'hades', 'color.spf')).result.format).toBe('colorized');
    expect((await call('info', 'hades', 'spell.efa')).result).toMatchObject({ kind: 'efa', frameCount: 1, intervalMs: 50 });
    expect((await call('info', 'hades', 'test.pal')).result).toMatchObject({ kind: 'pal', colors: 256 });
    expect((await call('info', 'hades', 'notes.txt')).result).toMatchObject({ kind: 'txt', palette: null });
    const rows = (await call('info', 'hades', '*.?pf')).result;
    expect(rows.items.map((r: Out) => r.name)).toEqual(['mns001.mpf', 'mns002.mpf', 'test.epf', 'test.hpf', 'test.spf', 'color.spf']);
    expect(rows.items[0]).toMatchObject({ frameCount: 3, emptyFrames: 0 });
    // An entry the reader refuses is a row with its error, not a failed command.
    const bad = await call('info', 'hades', 'data.*');
    expect(bad.result.items[0]).toMatchObject({ name: 'data.bin' });
  });
});

describe('render', () => {
  it('writes a PNG with the auto palette, and the pixels are the frame', async () => {
    const r = await call('render', 'hades', 'mns001.mpf', '--out', 'one.png');
    expect(r.result).toMatchObject({ frames: [0], palette: { source: 'auto', ruleId: 'mpf/mns', paletteNumber: 0 } });
    const png = decodePng(readFileSync(join(out, 'one.png')));
    expect([png.width, png.height]).toEqual([r.result.width, r.result.height]);
    // Somewhere in the frame is the red it was made from.
    const reds = [...Array(png.width * png.height).keys()].filter(
      (i) => png.rgba[i * 4] === 255 && png.rgba[i * 4 + 1] === 0 && png.rgba[i * 4 + 3] === 255,
    );
    expect(reds.length).toBe(12);
  });

  it('a sheet lays out every frame in columns, scaled, on a background', async () => {
    const r = await call('render', 'hades', 'mns001.mpf', '--sheet', '2', '--scale', '2', '--bg', '#102030', '--out', 'sheet.png');
    expect(r.result.frames).toEqual([0, 1, 2]);
    const png = decodePng(readFileSync(join(out, 'sheet.png')));
    expect(png.width).toBe(r.result.width);
    expect([...png.rgba.subarray(png.rgba.length - 4)]).toEqual([0x10, 0x20, 0x30, 255]);
  });

  it('takes a named palette, a palette in another archive, and a dye', async () => {
    const epf = await call('render', 'hades', 'test.epf', '--palette', 'test.pal', '--frames', '0-1', '--sheet', '2', '--inline');
    expect(epf.result.palette).toEqual({ source: 'hades.dat/test.pal' });
    expect((await call('render', 'hades', 'test.hpf', '--palette', 'hades/test.pal', '--inline')).result.width).toBe(28);
    const dyed = await call('render', 'hades', 'mns001.mpf', '--dye', '3', '--inline');
    expect(dyed.result.dye).toBe(3);
    expect((await call('render', 'hades', 'mns001.mpf', '--dye', '4', '--inline')).error).toBe('color0.tbl has no dye 4');
  });

  it('renders SPF in both formats and EFA with their own colours', async () => {
    expect((await call('render', 'hades', 'test.spf', '--inline')).result.palette).toBeUndefined();
    expect((await call('render', 'hades', 'color.spf', '--inline')).code).toBe(0);
    expect((await call('render', 'hades', 'spell.efa', '--inline')).code).toBe(0);
  });

  it('refuses what it cannot render, with the reason', async () => {
    const err = async (...a: string[]) => (await call('render', 'hades', ...a, '--inline')).error;
    expect(await err('mns002.mpf')).toMatch(/^No palette rule resolves hades\.dat\/mns002\.mpf; pass --palette/);
    expect(await err('test.hpf')).toMatch(/^No palette rule resolves hades\.dat\/test\.hpf/);
    expect(await err('notes.txt')).toBe('render takes an EPF, MPF, HPF, SPF or EFA entry, not .txt');
    expect(await err('mns001.mpf', '--frames', '9')).toBe('Frame 9 is out of range: the entry has 3 frames (0-2)');
    expect(await err('mns001.mpf', '--frames', 'x')).toBe('--frames takes indexes and ranges such as "0,3-5", not "x"');
    expect(await err('mns001.mpf', '--scale', '0')).toBe('--scale takes a whole number from 1 to 16');
    expect(await err('mns001.mpf', '--sheet', '0')).toBe('--sheet takes a number of columns');
    expect(await err('mns001.mpf', '--bg', 'red')).toBe('--bg takes "transparent" or #rrggbb, not "red"');
    expect(await err('test.spf', '--dye', '1')).toBe('--dye applies to EPF, MPF and HPF, not spf');
    expect(await err('test.spf', '--palette', 'test.pal')).toBe('--palette applies to EPF, MPF and HPF; a spf carries its own colours');
    expect(await err('mns001.mpf', '--scale', '16', '--sheet', '3', '--max', '100')).toMatch(
      /^The render would be \d+x\d+, over the 100 px limit/,
    );
  });

  it('parseFrames, compose and nameMatcher', () => {
    expect(parseFrames(undefined, 4, false)).toEqual([0]);
    expect(parseFrames(undefined, 3, true)).toEqual([0, 1, 2]);
    expect(parseFrames('3-1,0', 4, false)).toEqual([1, 2, 3, 0]);
    expect(() => parseFrames(undefined, 0, false)).toThrow('The entry has no frames');
    const two = compose([solid(1, 1, 1, 2, 3), solid(2, 1, 4, 5, 6)], 5, 1, [0, 0, 0, 0]);
    expect([two.width, two.height]).toEqual([4, 1]);
    expect(nameMatcher(undefined)('x')).toBe(true);
    expect(nameMatcher('MNS*.mpf')('mns001.mpf')).toBe(true);
    expect(nameMatcher('a.b')('axb')).toBe(false);
  });
});

describe('palettes, tables, maps, SOTP and extract', () => {
  it('palette: the rule, the number, and the colours on request', async () => {
    const p = (await call('palette', 'hades', 'mns001.mpf', '--colors', '--frame', '0')).result;
    expect(p).toMatchObject({ resolved: true, ruleId: 'mpf/mns', kind: 'indexed', paletteNumber: 0, luminanceBlended: false });
    expect(p.colors).toHaveLength(256);
    expect((await call('palette', 'hades', 'mns002.mpf')).result).toEqual({
      archive: 'hades.dat',
      name: 'mns002.mpf',
      resolved: false,
      ruleId: 'mpf/mns',
    });
    expect((await call('palette', 'hades', 'notes.txt')).result.ruleId).toBeNull();
  });

  it('palette-diff: the indexes where two palettes differ', async () => {
    const d = (await call('palette-diff', 'hades/test.pal', 'hades/other.pal')).result;
    expect(d.differ).toBeGreaterThan(0);
    expect(d.diffs[0]).toMatchObject({ index: expect.any(Number), first: expect.stringMatching(/^#/) });
    expect((await call('palette-diff', 'hades/test.pal', 'hades/test.pal')).result.differ).toBe(0);
    expect((await call('palette-diff', 'test.pal', 'hades/test.pal')).error).toBe('A palette is <archive>/<name.pal>, not "test.pal"');
  });

  it('tbl: a colour table, a cycling table and a palette table, by name or --as', async () => {
    expect((await call('tbl', 'legend', 'color0.tbl')).result).toMatchObject({
      as: 'color',
      items: [{ index: 3, colors: ['#090909', '#080808'] }],
    });
    expect((await call('tbl', 'hades', 'mpt001.tbl')).result.entries).toEqual([{ startIndex: 10, endIndex: 20, period: 300 }]);
    expect((await call('tbl', 'hades', 'stspal.tbl')).result).toMatchObject({ as: 'palette', total: 1 });
    expect((await call('tbl', 'hades', 'stspal.tbl', '--as', 'cycling')).result.as).toBe('cycling');
    expect((await call('tbl', 'hades', 'stspal.tbl', '--as', 'nope')).error).toBe('--as takes color, cycling or palette, not "nope"');
  });

  it('map: the layers with counts, one tile, and the refusals', async () => {
    const m = (await call('map', 'a.map', '--size', '2x2')).result;
    expect(m.background).toMatchObject({ distinct: 2, items: [{ id: 0, count: 2 }, { id: 5, count: 2 }] });
    expect((await call('map', 'a.map', '--size', '2x2', '--at', '1,1')).result.at).toEqual({
      x: 1,
      y: 1,
      background: 5,
      leftForeground: 0,
      rightForeground: 2,
    });
    expect((await call('map', 'a.map')).error).toMatch(/^A map needs --size/);
    expect((await call('map', 'a.map', '--size', '2x2', '--at', '5,5')).error).toBe('5,5 is outside the 2x2 map');
    expect((await call('map', 'a.map', '--size', '2x2', '--at', 'x')).error).toBe('--at takes x,y');
    expect((await call('map', 'gone.map', '--size', '2x2')).error).toMatch(/^Cannot read the map /);
  });

  it('map-diff: the cells that differ', async () => {
    const d = (await call('map-diff', 'a.map', 'b.map', '--size', '2x2')).result;
    expect(d.differ).toBe(1);
    expect(d.items[0]).toMatchObject({ x: 1, y: 0, second: { background: 9 } });
  });

  it('sotp: the flags of each tile id', async () => {
    const s = (await call('sotp', '1', '2', '10000')).result;
    expect(s.tiles[0]).toMatchObject({ id: 1, flags: '0x0f', collision: 15, blocks: { left: true, down: true, right: true, up: true } });
    expect(s.tiles[1]).toMatchObject({ id: 2, overPlayer: true, collision: 0 });
    expect(s.tiles[2].flags).toBe('0x00');
    expect((await call('sotp', 'x')).error).toBe('A tile id is a whole number, not "x"');
  });

  it('extract: copies outside the client folder, and refuses one inside it', async () => {
    const e = (await call('extract', 'hades', '*.txt', '--out', 'copies')).result;
    expect(e.files).toEqual(['notes.txt', 'korean.txt']);
    expect(readFileSync(join(out, 'copies', 'notes.txt'), 'utf8')).toBe('hello\nworld');
    expect((await call('extract', 'hades', '*.txt', '--out', join(client, 'x'))).error).toMatch(/^Refused: .* is inside the client folder$/);
    expect((await call('extract', 'hades', '*.txt')).error).toBe('extract needs --out <dir>');
    // With no client folder, the archive's own folder is still guarded.
    const r = await run(['extract', join(client, 'ia.dat'), '*', '--out', join(client, 'y')], { INIT_CWD: out });
    expect((r.out as Out).error).toMatch(/^Refused: .* is inside the archive's folder$/);
    const ok = await run(['extract', join(client, 'ia.dat'), '*', '--out', join(out, 'ia')], { INIT_CWD: out });
    expect((ok.out as Out).result.count).toBe(1);
    expect(existsSync(join(client, 'x'))).toBe(false);
  });

  it('a context provider gives null for an archive that is not there', () => {
    const ctx = createContext({ client, base: out });
    expect(ctx.provider('nothing.dat')).toBeNull();
    expect(ctx.provider('legend.dat')).not.toBeNull();
    expect(ctx.open('hades')).toBe(ctx.open('HADES.DAT'));
  });
});

describe('main', () => {
  it('prints one line of JSON and sets the exit code', async () => {
    const writes: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((s: string) => (writes.push(s), true)) as typeof process.stdout.write;
    try {
      await main(['archives', '--client', client]);
      await main(['fly', '--pretty']);
    } finally {
      process.stdout.write = write;
    }
    expect(JSON.parse(writes[0]!).ok).toBe(true);
    expect(writes[1]).toContain('\n  "ok": false');
    expect(process.exitCode).toBe(2);
    process.exitCode = 0;
  });
});

describe('the MCP front', () => {
  const rpc = (method: string, params?: Record<string, unknown>) =>
    handle({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) }, { client }) as Promise<Out>;
  const callTool = async (name: string, args: Record<string, unknown>) => {
    const res = await rpc('tools/call', { name, arguments: args });
    return { res, out: JSON.parse(res.result.content[0].text) as Out };
  };

  it('answers initialize as dalib-ts, and lists one tool for each command', async () => {
    expect((await rpc('initialize', {})).result.serverInfo.name).toBe('dalib-ts');
    const { result } = await rpc('tools/list');
    expect(result.tools.map((t: Out) => t.name)).toEqual(TOOLS.map((t) => t.name));
    // Guard the guard: one tool for each command in the usage.
    const usage = ((await run(['--help'], {})).out as Out).usage as string;
    const commands = [...usage.matchAll(/^ {2}([a-z-]+)\b/gm)].map((m) => m[1]);
    expect(commands).toHaveLength(12);
    expect(TOOLS.map((t) => t.name.replace(/^dalib_/, '').replace(/_/g, '-')).sort()).toEqual([...commands].sort());
  });

  it('dalib_render returns the PNG as image content', async () => {
    const { res, out: o } = await callTool('dalib_render', { archive: 'hades', entry: 'mns001.mpf' });
    expect(o.ok).toBe(true);
    const image = res.result.content[1];
    expect(image.type).toBe('image');
    expect(image.mimeType).toBe('image/png');
    expect(decodePng(Buffer.from(image.data, 'base64')).width).toBe(o.result.width);
  });

  it('each tool builds its argv', async () => {
    const calls: [string, Record<string, unknown>][] = [
      ['dalib_archives', {}],
      ['dalib_ls', { archive: 'hades', pattern: '*.pal', all: true }],
      ['dalib_ls', { archive: 'hades' }],
      ['dalib_cat', { archive: 'hades', entry: 'notes.txt' }],
      ['dalib_info', { archive: 'hades', entry: 'test.epf' }],
      ['dalib_palette', { archive: 'hades', entry: 'mns001.mpf' }],
      ['dalib_palette_diff', { first: 'hades/test.pal', second: 'hades/other.pal' }],
      ['dalib_tbl', { archive: 'legend', entry: 'color0.tbl' }],
      ['dalib_map', { file: join(out, 'a.map'), size: '2x2' }],
      ['dalib_map_diff', { first: join(out, 'a.map'), second: join(out, 'b.map'), size: '2x2' }],
      ['dalib_sotp', { ids: ['1'] }],
      ['dalib_extract', { archive: 'hades', pattern: 'notes.txt', out: join(out, 'mcp') }],
    ];
    for (const [name, args] of calls) expect((await callTool(name, args)).out.ok, name).toBe(true);
  });

  it('refuses a wrong type and a text that starts with "--"', async () => {
    expect((await callTool('dalib_render', { archive: 'hades', entry: 'mns001.mpf', scale: '2' })).out.error).toBe(
      'dalib_render: "scale" must be a number',
    );
    expect((await callTool('dalib_ls', { archive: '--all' })).out.error).toBe('dalib_ls: "archive" must not start with "--"');
  });

  it('serves on streams', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let text = '';
    output.on('data', (d) => (text += d));
    const done = serve(input, output, { client });
    input.end('{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"dalib_sotp","arguments":{"ids":["1"]}}}\n');
    await done;
    const reply = JSON.parse(text.trim());
    expect(JSON.parse(reply.result.content[0].text).result.tiles[0].id).toBe(1);
  });
});

describe('the scratch folder', () => {
  it('is not the client folder', () => {
    mkdirSync(join(out, 'probe'), { recursive: true });
    expect(existsSync(join(client, 'probe'))).toBe(false);
  });
});
