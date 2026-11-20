// HTOO-706. `npm run -s dalib-ts -- <command> …` in a checkout: bundle the CLI
// (src/cli) from the source and run it, so it never runs a stale dist/. The
// published package runs dist/cli.cjs instead (the `dalib-ts` bin).
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = join(repo, 'node_modules', '.cache', 'dalib-ts-cli', 'cli.cjs');

await build({
  entryPoints: [join(repo, 'src', 'cli', 'bin.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  packages: 'external',
  outfile,
  logLevel: 'warning',
});

createRequire(import.meta.url)(outfile);
