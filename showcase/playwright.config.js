import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  use: { baseURL: 'http://localhost:4173', browserName: 'chromium' },
  webServer: { command: 'npm run dev -- --port 4173', url: 'http://localhost:4173', reuseExistingServer: true },
});
