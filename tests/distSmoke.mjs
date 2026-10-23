// Loads the built package from a plain Node process, through both entries that package.json
// declares. Vitest runs `src` through its own transform, where `require` exists, so it cannot
// see a Node-only path that fails in the ESM build. Run after `npm run build`.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failed) process.exit(1);
