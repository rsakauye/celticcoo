import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test/browser',
  timeout: 30000,
  expect: { timeout: 5000 },
  fullyParallel: true,
  reporter: 'line',
  use: { baseURL: 'http://127.0.0.1:4399' },
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4399',
    url: 'http://127.0.0.1:4399/groups/',
    reuseExistingServer: !process.env.CI,
    timeout: 180000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit-iphone', use: { ...devices['iPhone 13'] } },
  ],
});
