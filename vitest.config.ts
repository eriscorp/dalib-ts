import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        '**/*.d.ts',
        '**/*.config.*',
        // Pure re-export barrel — counting it only inflates the totals.
        'src/index.ts',
      ],
      thresholds: {
        // Global floors, set just under the measured numbers so the suite guards
        // against regression without blocking work. Raise them as coverage
        // improves; do not lower them to make a red build pass.
        //
        // Measure with `npm run test:coverage`. Note that some tests assert
        // against a real client install and skip when it is absent, so a machine
        // with the client reports higher numbers than CI does. Set these floors
        // from the CI case, which is the lower of the two.
        // Baseline measured on this commit: lines 33.76, branches 26.70,
        // functions 40.55, statements 31.98.
        lines: 32,
        branches: 25,
        functions: 38,
        statements: 30,
      },
    },
  },
});
