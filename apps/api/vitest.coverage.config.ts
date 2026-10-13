import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: {
    alias: {
      '@dentalai/domain': fileURLToPath(
        new URL('../../packages/domain/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['test/unit/**/*.test.ts', 'test/integration/**/*.test.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
    fileParallelism: false,
    coverage: {
      thresholds: { statements: 84.48, branches: 76.77, functions: 88.65, lines: 86.14 },
      provider: 'v8',
      allowExternal: true,
      include: ['src/**/*.ts', '../../packages/domain/src/**/*.ts'],
      exclude: ['**/*.d.ts'],
      reportsDirectory: '../../coverage/api',
      reporter: ['text-summary', 'json', 'json-summary', 'html', 'lcov'],
    },
  },
});
