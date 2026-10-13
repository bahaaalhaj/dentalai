import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@dentalai/ui': fileURLToPath(new URL('../../packages/ui/src/index.ts', import.meta.url)),
    },
  },
  plugins: [react()],
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    clearMocks: true,
    restoreMocks: true,
    // Bound jsdom forks on Windows/CI; keep isolation and all error checks enabled.
    maxWorkers: 1,
    coverage: {
      thresholds: { statements: 36.27, branches: 38.49, functions: 25.66, lines: 36.76 },
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
      allowExternal: true,
      exclude: [
        'src/**/*.test.*',
        'src/tests/**',
        'src/test/**',
        'src/test_utils/**',
        '**/*.d.ts',
        'src/i18n/generated.ts',
      ],
      reportsDirectory: '../../coverage/web',
      reporter: ['text-summary', 'json', 'json-summary', 'html', 'lcov'],
    },
  },
});
