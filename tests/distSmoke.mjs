// Loads the built package from a plain Node process, through both entries that package.json
// declares. Vitest runs `src` through its own transform, where `require` exists, so it cannot
// see a Node-only path that fails in the ESM build. Run after `npm run build`.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const builds = {
  esm: await import('../dist/index.js'),
  cjs: require('../dist/index.cjs'),
};

const dir = mkdtempSync(join(tmpdir(), 'dalib-ts-smoke-'));
let failed = false;

try {
  const palettePath = join(dir, 'smoke.pal');
  writeFileSync(palettePath, new Uint8Array(256 * 3));

  for (const [name, lib] of Object.entries(builds)) {
    try {
      // fs: every fromFile factory uses the same accessor.
      lib.Palette.fromFile(palettePath);
      // zlib: the sync inflate path.
      lib.MetaFile.fromCompressedBuffer(deflateSync(new lib.MetaFile().toUint8Array()));
      console.log(`${name}: ok`);
    } catch (err) {
      failed = true;
      console.error(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // The `dalib-ts` bin (HTOO-706), as package.json names it: a CLI command and
  // an MCP call, each in a plain Node process. The tests import src/cli; only
  // this runs dist/cli.cjs.
  try {
    const bin = fileURLToPath(new URL(`../${require('../package.json').bin['dalib-ts']}`, import.meta.url));
    const content = join(dir, 'content');
    mkdirSync(content);
    writeFileSync(join(content, 'smoke.txt'), 'hello');
    const dat = join(dir, 'smoke.dat');
    writeFileSync(dat, builds.cjs.DataArchive.compileFromDirectory(content));

    const ls = JSON.parse(execFileSync(process.execPath, [bin, 'ls', dat], { encoding: 'utf8' }));
    if (!ls.ok || ls.result.items[0]?.name !== 'smoke.txt') throw new Error(`ls gave ${JSON.stringify(ls)}`);

    const mcp = execFileSync(process.execPath, [bin, 'mcp'], {
      encoding: 'utf8',
      input: `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'dalib_ls', arguments: { archive: dat } } })}\n`,
    });
    const reply = JSON.parse(JSON.parse(mcp.trim()).result.content[0].text);
    if (!reply.ok || reply.result.total !== 1) throw new Error(`mcp gave ${mcp}`);
    console.log('bin: ok');
  } catch (err) {
    failed = true;
    console.error(`bin: ${err instanceof Error ? err.message : String(err)}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failed) process.exit(1);
