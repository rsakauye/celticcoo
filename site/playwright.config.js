import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// BRAVE_PATH wins when it is set. Otherwise use the official package path when that binary is installed.
const bravePath = process.env.BRAVE_PATH || '/opt/brave.com/brave/brave';
const projects = [
  { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  { name: 'webkit-iphone', use: { ...devices['iPhone 13'] } },
];
if (process.env.BRAVE_PATH || existsSync(bravePath)) {
  projects.push({
    name: 'brave',
    use: {
      ...devices['Desktop Chrome'],
      launchOptions: { executablePath: bravePath },
    },
  });
}

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
  projects,
});
