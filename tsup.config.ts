import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      'helpers/imageData': 'src/helpers/imageData.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: false,
    treeshake: true,
  },
  {
    // The `dalib-ts` bin (HTOO-706): one CommonJS file, so Node 18 can load the
    // Node built-ins through `require`. It is not in `exports`, so a browser
    // bundle of the library never sees it.
    entry: { cli: 'src/cli/bin.ts' },
    format: ['cjs'],
    platform: 'node',
    target: 'node18',
    dts: false,
    sourcemap: false,
    clean: false,
    splitting: false,
    banner: { js: '#!/usr/bin/env node' },
  },
]);
