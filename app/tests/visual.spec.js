// Captures every screen in both themes for a human to look over.
// Images land in test-results/visual/.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, resetDemo } from './fixtures.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../test-results/visual');
const PHOTO = path.resolve(__dirname, '../../flow_net.jpg');

test.beforeAll(async ({ request }) => {
  await resetDemo(request);
});

for (const theme of ['light', 'dark']) {
  test(`resident screens, ${theme}`, async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({
      baseURL, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, colorScheme: theme, timezoneId: 'America/Los_Angeles',
      permissions: ['geolocation', 'microphone'], geolocation: { latitude: 34.1187, longitude: -118.2902, accuracy: 12 },
    });
    await ctx.route(/(arcgisonline|openstreetmap\.org|cartocdn|googleapis|gstatic|open-meteo|nominatim|weather\.gov)/, (r) => r.abort());
    const page = await ctx.newPage();
    const shot = (name) => page.screenshot({ animations: 'disabled', path: `${OUT}/${theme}-resident-${name}.png` });
    await page.goto('/');
    await expect(page.locator('[data-nearby]')).toBeVisible();
    await shot('1-home');
    await page.locator('[data-screen="home"] [data-go="camera"]').click();
    await page.locator('[data-cam-input="photo"]').setInputFiles(PHOTO);
    await expect(page.locator('[data-cam-preview] img')).toBeVisible();
    await shot('2-camera-preview');
    await page.locator('[data-screen="camera"] [data-go="home"]').click();
    await page.locator('[data-screen="home"] [data-go="voice"]').click();
    await page.locator('[data-transcript]').fill("There's smoke coming down the hill behind the houses.");
    await shot('3-voice');
    await page.locator('[data-action="voice-cancel"]').click();
    await page.locator('[data-screen="home"] [data-go="text"]').click();
    await page.locator('[data-text]').fill('Flames on the hillside behind my street');
    await page.locator('.chip', { hasText: 'Fire' }).click();
    await shot('4-text');
    await page.locator('[data-action="text-send"]').click();
    await expect(page.locator('[data-sent-type]')).toBeVisible({ timeout: 10000 });
    await shot('5-sent');
    await page.locator('.center-link').click();
    await page.locator('[data-screen="home"] [data-go="help"]').click();
    await page.locator('.toggle-row', { hasText: "I'm trapped" }).click();
    await page.locator('[data-action="help-send"]').click();
    await expect(page.locator('[data-help-status]')).toBeVisible();
    await shot('6-help');
    await ctx.close();
  });

  test(`dashboard, ${theme}`, async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, timezoneId: 'America/Los_Angeles' });
    await ctx.route(/(arcgisonline|openstreetmap\.org|cartocdn|googleapis|gstatic|open-meteo|nominatim|weather\.gov)/, (r) => r.abort());
    await ctx.addInitScript((t) => localStorage.setItem('responder-theme', t), theme);
    const page = await ctx.newPage();
    await page.goto('/responder');
    await expect(page.locator('.inc').first()).toBeVisible();
    await page.screenshot({ animations: 'disabled', path: `${OUT}/${theme}-dashboard-1-overview.png` });
    await page.locator('.inc', { hasText: 'Wildfire smoke' }).click();
    await expect(page.locator('.zone-box')).toBeVisible({ timeout: 8000 });
    await page.waitForTimeout(700);
    await page.screenshot({ animations: 'disabled', path: `${OUT}/${theme}-dashboard-2-detail.png` });
    await page.locator('[data-action="alert"]').click();
    await page.waitForTimeout(500);
    await page.screenshot({ animations: 'disabled', path: `${OUT}/${theme}-dashboard-3-alert.png` });
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await page.screenshot({ animations: 'disabled', path: `${OUT}/${theme}-dashboard-4-phone.png` });
    await ctx.close();
  });
}
