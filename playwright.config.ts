import { defineConfig, devices } from '@playwright/test';

// Dedicated port, distinct from vite.config.ts's dev-server port (5173), so this never
// collides with a real `npm run dev` someone might already have running locally.
const PORT = 5180;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: true,
  // Capped locally: many concurrent Chromium instances (each with WebAudio/WaveSurfer)
  // reliably crashed the renderer (STATUS_STACK_BUFFER_OVERRUN) on Windows under full parallelism.
  workers: process.env.CI ? undefined : 2,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /recording\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Fake mic (synthetic tone, no OS permission dialog) so RecordingPanel's
      // getUserMedia flow is exercisable headlessly.
      name: 'chromium-mic',
      testMatch: /recording\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['microphone'],
        launchOptions: {
          args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
        },
      },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
