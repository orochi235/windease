import { defaultExclude, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    setupFiles: ['./vitest.setup.ts'],
    coverage: { provider: 'v8', reporter: ['text', 'html'] },
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          exclude: [...defaultExclude, '**/dist/**', 'src/react/**', 'e2e/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'react',
          environment: 'jsdom',
          include: ['src/react/**/*.test.{ts,tsx}'],
        },
      },
    ],
  },
});
