import { defineConfig } from '@playwright/test';

const PORT = 3200;

export default defineConfig({
  testDir: './tests',
  // One server, shared state: run tests one at a time so they never step on each other.
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  expect: { timeout: 6_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'test-report' }]],
  outputDir: 'test-results',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    timezoneId: 'America/Los_Angeles',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'rm -rf .test-data && node --disable-warning=ExperimentalWarning server.js',
    url: `http://127.0.0.1:${PORT}/api/config`,
    reuseExistingServer: false,
    timeout: 20_000,
    env: {
      PORT: String(PORT),
      DATA_DIR: '.test-data/db',
      UPLOAD_DIR: '.test-data/uploads',
      REPLAY_INTERVAL_MS: '400',
      ANTHROPIC_API_KEY: '',
      TZ_DISPLAY: 'America/Los_Angeles',
    },
  },
  projects: [
    {
      name: 'resident-phone',
      testMatch: /resident.*\.spec\.js/,
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        permissions: ['geolocation', 'microphone'],
        geolocation: { latitude: 34.1187, longitude: -118.2902, accuracy: 12 },
        launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
      },
    },
    {
      name: 'responder-desktop',
      testMatch: /responder.*\.spec\.js/,
      use: { viewport: { width: 1600, height: 1000 } },
    },
    {
      name: 'profiles',
      testMatch: /profiles\.spec\.js/,
      use: { viewport: { width: 1600, height: 1000 } },
    },
    {
      name: 'visual',
      testMatch: /visual\.spec\.js/,
      use: {
        permissions: ['geolocation', 'microphone'],
        geolocation: { latitude: 34.1187, longitude: -118.2902, accuracy: 12 },
      },
    },
  ],
});
