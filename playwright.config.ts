import { defineConfig, devices } from '@playwright/test';

const PORT = 61000;

export default defineConfig({
  testDir: './e2e',
  // 'list' prints a line per test as it finishes; a silent runner is
  // indistinguishable from a hung one.
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      // viewport must come after the device spread: devices['Desktop Chrome']
      // carries its own 1280x720, and project-level `use` outranks top-level,
      // so a viewport set above is silently discarded.
      use: { ...devices['Desktop Chrome'], viewport: { width: 1200, height: 800 } },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], viewport: { width: 1200, height: 800 } },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], viewport: { width: 1200, height: 800 } },
    },
  ],
  webServer: {
    command: 'npm run ladle',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
