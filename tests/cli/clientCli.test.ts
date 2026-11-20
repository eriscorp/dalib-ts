import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli/cli.js';
import { CLIENT_DIR, hasClientArchive } from '../clientAssets.js';

// HTOO-706. The CLI against a real client. These skip without one, and a skip
// is not a pass (AGENTS.md): confirm they ran.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Out = Record<string, any>;
const call = async (...argv: string[]): Promise<Out> => (await run([...argv, '--client', CLIENT_DIR], {})).out as Out;

describe.skipIf(!hasClientArchive('hades.dat') || !hasClientArchive('legend.dat'))('the CLI against the real client', () => {
  it('finds Legend.dat by its lowercase name', async () => {
    const r = await call('ls', 'legend', 'color0');
    expect(r.ok).toBe(true);
    expect(r.result.items[0].archive.toLowerCase()).toBe('legend.dat');
  });

  it('reads a creature MPF: eight frames, the mpf/mns rule', async () => {
    const r = (await call('info', 'hades', 'mns001.mpf')).result;
    expect(r).toMatchObject({ kind: 'mpf', frameCount: 8, emptyFrames: [], palette: { ruleId: 'mpf/mns' } });
  });

  it('renders it with the palette the rule resolves', async () => {
    const r = await run(['render', 'hades', 'mns001.mpf', '--sheet', '4', '--inline', '--client', CLIENT_DIR], {});
    expect((r.out as Out).result.palette).toMatchObject({ source: 'auto', ruleId: 'mpf/mns' });
    expect(r.content?.[0]?.type).toBe('image');
  });

  it('reads SOTP flags from ia.dat', async () => {
    const r = (await call('sotp', '1')).result;
    expect(r.maxTileId).toBeGreaterThan(1000);
  });
});

describe.skipIf(!hasClientArchive('seo.dat'))('ground tiles against the real client', () => {
  it('keys each tile on its map id + 1, as the client does', async () => {
    // Map tile 278 opens a range in mptpal.tbl: id 279 maps to palette 34 and
    // id 278 to palette 2. A key one short gives the tile the wrong palette.
    expect((await call('palette', 'seo', 'tilea.bmp', '--tile', '278')).result).toMatchObject({ ruleId: 'tileset/mpt', paletteNumber: 34 });
    const r = (await call('render', 'seo', 'tilea.bmp', '--tiles', '277-278', '--sheet', '2', '--inline')).result;
    expect(r).toMatchObject({ tiles: [277, 278], width: 112, palette: { ruleId: 'tileset/mpt', paletteNumbers: [2, 34] } });
  });

  it('gives the tileset its tile count', async () => {
    expect((await call('info', 'seo', 'tilea.bmp')).result).toMatchObject({ kind: 'tileset', tileCount: 19415 });
  });
});
