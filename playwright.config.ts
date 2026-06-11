import { defineConfig, devices } from '@playwright/test';

/** E2E runs against the PRODUCTION build (service worker included) served by
 *  `vite preview`, emulating an iPhone with touch. */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // shared origin + IndexedDB: keep tests serialized
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173/Things-3/',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'iphone',
      use: {
        ...devices['iPhone 13'],
        // Only Chromium is installed in this environment; keep the iPhone
        // viewport, touch and UA but swap the engine.
        browserName: 'chromium',
      },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/Things-3/',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
