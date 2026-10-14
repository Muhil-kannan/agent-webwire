import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/core/**/*.ts', 'src/security/**/*.ts'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 80 },
    },
  },
});
