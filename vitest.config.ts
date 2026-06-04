import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    environmentMatchGlobs: [['packages/react/**', 'jsdom']],
    globals: false,
    coverage: { provider: 'v8', reporter: ['text', 'html'] },
  },
});
