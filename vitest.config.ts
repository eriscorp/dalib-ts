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
        // Measure with `npm run test:coverage`. Some tests assert against a real
        // client install and skip when it is absent, so a machine with the client
        // reports higher numbers than CI does. Reproduce the CI case, which is the
        // lower of the two, by pointing the tests at a path that does not exist:
        //
        //   DALIB_CLIENT_DIR=/nonexistent npm run test:coverage
        //
        // Baseline on this commit, measured without a client (what CI sees):
        // lines 76.89, branches 68.46, functions 88.77, statements 75.74.
        lines: 75,
        branches: 67,
        functions: 87,
        statements: 74,
      },
    },
  },
});
