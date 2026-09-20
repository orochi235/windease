// A second config on a non-default port: every worktree's Ladle defaults to
// 61000, so an e2e run there can silently attach to another worktree's server.

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  reporter: [['list']],
  workers: 4,
  use: { baseURL: 'http://localhost:61100', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1200, height: 800 } } },
  ],
  webServer: {
    command: './node_modules/.bin/ladle serve --port 61100',
    url: 'http://localhost:61100',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
