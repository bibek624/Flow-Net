import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, resetDemo, postReport, waitForTriage, bgColor, contrast, noHorizontalScroll } from './fixtures.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PHOTO = path.resolve(__dirname, '../../flow_net.jpg');

const screen = (page, name) => page.locator(`[data-screen="${name}"]`);
const visibleGo = (page, from, to) => page.locator(`[data-screen="${from}"] [data-go="${to}"]`).first();

test.beforeAll(async ({ request }) => {
  await resetDemo(request);
});

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-loc-pill]')).not.toHaveText('Finding you…');
});

test.describe('Home', () => {
  test('shows the question and three ways to report', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'What are you seeing?' })).toBeVisible();
    for (const name of ['Camera', 'Voice', 'Text']) await expect(screen(page, 'home').getByText(name, { exact: true })).toBeVisible();
  });

  test('help button sits in thumb reach at the bottom and is red', async ({ page }) => {
    const btn = page.getByRole('button', { name: 'I need help now' });
    await expect(btn).toBeVisible();
    const box = await btn.boundingBox();
    expect(box.y + box.height).toBeGreaterThan(844 * 0.75);
    expect(box.height).toBeGreaterThanOrEqual(56);
    const color = await btn.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(color).not.toBe('rgba(0, 0, 0, 0)');
  });

  test('location pill confirms location is on', async ({ page }) => {
    await expect(page.locator('[data-loc-pill]')).toHaveText('Location on');
  });

  test('uses a labeled demo location when location is blocked', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, permissions: [] });
    await ctx.route(/(cartocdn|googleapis|gstatic|open-meteo|nominatim)/, (r) => r.abort());
    const page = await ctx.newPage();
    await page.goto('/');
    await expect(page.locator('[data-loc-pill]')).toHaveText('Demo location', { timeout: 12000 });
    await ctx.close();
  });

  test('shows active incidents near you with distance', async ({ page }) => {
    const panel = page.locator('[data-nearby]');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.near-row').first()).toBeVisible();
    await expect(panel.locator('.near-title').first()).toContainText(/smoke|fire/i);
    await expect(panel.locator('.near-dist').first()).toHaveText(/\d+ m|\d\.\d mi/);
    await expect(page.locator('[data-note]')).toBeHidden();
  });

  test('flags when you are inside an incident area', async ({ page }) => {
    await expect(page.locator('.near-zone').first()).toHaveText('You are in the area', { timeout: 10000 });
  });

  test('hides the near-you panel far from any incident', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, permissions: ['geolocation'], geolocation: { latitude: 32.7157, longitude: -117.1611 } });
    const page = await ctx.newPage();
    await page.goto('/');
    await expect(page.locator('[data-loc-pill]')).toHaveText('Location on');
    await page.waitForTimeout(800);
    await expect(page.locator('[data-nearby]')).toBeHidden();
    await expect(page.locator('[data-note]')).toBeVisible();
    await ctx.close();
  });

  for (const width of [320, 360, 390, 430]) {
    test(`fits a ${width}px wide phone with no sideways scrolling`, async ({ page }) => {
      await page.setViewportSize({ width, height: 740 });
      expect(await noHorizontalScroll(page)).toBe(true);
      await expect(page.getByRole('button', { name: 'I need help now' })).toBeInViewport();
    });
  }

  test('main buttons are at least 44px tall for easy tapping', async ({ page }) => {
    for (const sel of ['[data-screen="home"] .card', '.btn-help', '.pill']) {
      const boxes = await page.locator(sel).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
      for (const h of boxes) expect(h).toBeGreaterThanOrEqual(32);
    }
    const cards = await page.locator('[data-screen="home"] .card').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    for (const h of cards) expect(h).toBeGreaterThanOrEqual(44);
  });

  test('page is ready fast', async ({ page }) => {
    const t = await page.evaluate(() => performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd);
    expect(t).toBeLessThan(1500);
  });
});

test.describe('Theme', () => {
  test('cycles system, light, dark and remembers the choice', async ({ page }) => {
    const btn = page.locator('[data-action="theme"]');
    await btn.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await btn.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.locator('[data-action="theme"]').click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  });

  test('dark theme uses a dark background and readable text', async ({ page }) => {
    await page.evaluate(() => { localStorage.setItem('resident-theme', 'dark'); });
    await page.reload();
    const bg = await bgColor(page, '#app');
    const [r, g, b] = bg.match(/\d+/g).map(Number);
    expect(r + g + b).toBeLessThan(150);
    expect(await contrast(page, '.big-title', '#app')).toBeGreaterThan(7);
    expect(await contrast(page, '.card-sub', '.card')).toBeGreaterThan(4.5);
  });

  test('light theme uses a light background and readable text', async ({ page }) => {
    await page.evaluate(() => { localStorage.setItem('resident-theme', 'light'); });
    await page.reload();
    const [r, g, b] = (await bgColor(page, '#app')).match(/\d+/g).map(Number);
    expect(r + g + b).toBeGreaterThan(600);
    expect(await contrast(page, '.big-title', '#app')).toBeGreaterThan(7);
    expect(await contrast(page, '.card-sub', '.card')).toBeGreaterThan(4.5);
  });

  test('follows the phone setting when set to system', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, colorScheme: 'dark', viewport: { width: 390, height: 844 }, permissions: ['geolocation'], geolocation: { latitude: 34.1187, longitude: -118.2902 } });
    const page = await ctx.newPage();
    await page.goto('/');
    const [r, g, b] = (await bgColor(page, '#app')).match(/\d+/g).map(Number);
    expect(r + g + b).toBeLessThan(150);
    await ctx.close();
  });
});

test.describe('Text report', () => {
  test('asks for words or a chip before sending', async ({ page }) => {
    await visibleGo(page, 'home', 'text').click();
    await page.locator('[data-action="text-send"]').click();
    await expect(page.locator('[data-toast]')).toHaveText(/Type what you see/);
    await expect(screen(page, 'text')).toBeVisible();
  });

  test('chips turn on and off', async ({ page }) => {
    await visibleGo(page, 'home', 'text').click();
    const chip = page.locator('.chip', { hasText: 'Flood' });
    await chip.click();
    await expect(chip).toHaveClass(/on/);
    await chip.click();
    await expect(chip).not.toHaveClass(/on/);
  });

  test('sends and walks through each status step', async ({ page }) => {
    await visibleGo(page, 'home', 'text').click();
    await page.locator('[data-text]').fill('Flames on the hillside behind my house, smoke getting thick');
    await page.locator('.chip', { hasText: 'Fire' }).click();
    await page.locator('[data-action="text-send"]').click();
    await expect(screen(page, 'sent')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Got it.' })).toBeVisible();
    await expect(page.locator('[data-step="sent"]')).toHaveClass(/done/);
    await expect(page.locator('[data-step="loc"]')).toHaveClass(/done/);
    await expect(page.locator('[data-sent-type]')).toHaveText(/smoke|fire/i, { timeout: 10000 });
    await expect(page.locator('[data-sent-nearby]')).toHaveText(/\d+ others? reported this nearby/);
    await expect(page.locator('[data-step="review"]')).toHaveClass(/active/);
  });

  test('turns "Reviewed by a person" on when a responder confirms', async ({ page, request }) => {
    await visibleGo(page, 'home', 'text').click();
    await page.locator('[data-text]').fill('Gas smell getting stronger near the corner');
    await page.locator('[data-action="text-send"]').click();
    await expect(page.locator('[data-sent-nearby]')).toHaveText(/reported this nearby|First report/, { timeout: 10000 });
    const states = await (await request.get('/api/state')).json();
    const id = await page.evaluate(() => document.querySelector('[data-sent-type]')?.textContent);
    expect(id).toBeTruthy();
    // Confirm every incident near the reporter, then check the phone updates.
    for (const inc of states.incidents) await request.post(`/api/incidents/${inc.id}/review`);
    await expect(page.locator('[data-step="review"]')).toHaveClass(/done/, { timeout: 6000 });
    await expect(page.locator('[data-sent-review]')).toHaveText('A responder has seen this');
  });

  test('clears the form after sending', async ({ page }) => {
    await visibleGo(page, 'home', 'text').click();
    await page.locator('[data-text]').fill('Tree down across the road');
    await page.locator('.chip', { hasText: 'Road blocked' }).click();
    await page.locator('[data-action="text-send"]').click();
    await expect(screen(page, 'sent')).toBeVisible();
    await visibleGo(page, 'sent', 'text').click();
    await expect(page.locator('[data-text]')).toHaveValue('');
    await expect(page.locator('.chip.on')).toHaveCount(0);
  });

  test('cancel returns home', async ({ page }) => {
    await visibleGo(page, 'home', 'text').click();
    await visibleGo(page, 'text', 'home').click();
    await expect(screen(page, 'home')).toBeVisible();
  });
});

test.describe('Sent screen', () => {
  test('back to home works', async ({ page }) => {
    await visibleGo(page, 'home', 'text').click();
    await page.locator('[data-text]').fill('Smoke over the park');
    await page.locator('[data-action="text-send"]').click();
    await page.locator('.center-link').click();
    await expect(screen(page, 'home')).toBeVisible();
  });

  test('"Add more" buttons open camera, voice, and text', async ({ page }) => {
    await visibleGo(page, 'home', 'text').click();
    await page.locator('[data-text]').fill('Ash falling on cars');
    await page.locator('[data-action="text-send"]').click();
    for (const target of ['camera', 'voice', 'text']) {
      await expect(screen(page, 'sent')).toBeVisible();
      await visibleGo(page, 'sent', target).click();
      await expect(screen(page, target)).toBeVisible();
      await page.evaluate(() => { for (const s of document.querySelectorAll('[data-screen]')) s.hidden = s.dataset.screen !== 'sent'; });
    }
  });
});

test.describe('Camera', () => {
  test('photo: preview, caption, send, and the server stores the image', async ({ page, request }) => {
    await visibleGo(page, 'home', 'camera').click();
    await page.locator('[data-cam-input="photo"]').setInputFiles(PHOTO);
    await expect(page.locator('[data-cam-preview] img')).toBeVisible();
    await expect(page.locator('[data-cam-label]')).toHaveText('Photo');
    await page.locator('[data-cam-caption]').fill('Water over the road');
    await page.locator('[data-action="cam-send"]').click();
    await expect(screen(page, 'sent')).toBeVisible({ timeout: 10000 });
    await expect
      .poll(async () => (await (await request.get('/api/state')).json()).incidents.some((i) => i.counts.photo > 0), { timeout: 10000 })
      .toBe(true);
  });

  test('photo is shrunk before upload to save data', async ({ page }) => {
    await visibleGo(page, 'home', 'camera').click();
    const reqPromise = page.waitForRequest((r) => r.url().endsWith('/api/reports') && r.method() === 'POST');
    await page.locator('[data-cam-input="photo"]').setInputFiles(PHOTO);
    await page.waitForTimeout(400);
    await page.locator('[data-action="cam-send"]').click();
    const req = await reqPromise;
    expect(req.postDataBuffer().length).toBeLessThan(600 * 1024);
  });

  test('video: preview, frame grab, send', async ({ page, request }) => {
    await visibleGo(page, 'home', 'camera').click();
    // Make a short real video in the browser and hand it to the file input.
    await page.evaluate(async () => {
      const canvas = Object.assign(document.createElement('canvas'), { width: 320, height: 240 });
      const ctx = canvas.getContext('2d');
      const stream = canvas.captureStream(15);
      const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
      const chunks = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.start(100);
      for (let i = 0; i < 12; i++) {
        ctx.fillStyle = `hsl(${i * 30} 80% 50%)`;
        ctx.fillRect(0, 0, 320, 240);
        await new Promise((r) => setTimeout(r, 70));
      }
      rec.stop();
      await new Promise((r) => (rec.onstop = r));
      const file = new File(chunks, 'clip.webm', { type: 'video/webm' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const input = document.querySelector('[data-cam-input="video"]');
      input.files = dt.files;
      input.dispatchEvent(new Event('change'));
    });
    await expect(page.locator('[data-cam-preview] video')).toBeAttached();
    await expect(page.locator('[data-cam-label]')).toHaveText('Video');
    await page.waitForTimeout(800);
    await page.locator('[data-action="cam-send"]').click();
    await expect(screen(page, 'sent')).toBeVisible({ timeout: 10000 });
    await expect
      .poll(async () => (await (await request.get('/api/state')).json()).incidents.some((i) => i.counts.video > 0), { timeout: 10000 })
      .toBe(true);
  });

  test('retake clears the preview', async ({ page }) => {
    await visibleGo(page, 'home', 'camera').click();
    await page.locator('[data-cam-input="photo"]').setInputFiles(PHOTO);
    await expect(page.locator('[data-cam-preview] img')).toBeVisible();
    await page.locator('[data-action="cam-retake"]').click();
    await expect(page.locator('[data-cam-preview] img')).toHaveCount(0);
    await expect(page.locator('[data-cam-pick]')).toBeVisible();
  });

  test('close returns home', async ({ page }) => {
    await visibleGo(page, 'home', 'camera').click();
    await visibleGo(page, 'camera', 'home').click();
    await expect(screen(page, 'home')).toBeVisible();
  });

  test('photo and video inputs open the rear camera', async ({ page }) => {
    await expect(page.locator('[data-cam-input="photo"]')).toHaveAttribute('capture', 'environment');
    await expect(page.locator('[data-cam-input="video"]')).toHaveAttribute('accept', 'video/*');
  });
});

test.describe('Voice', () => {
  test('records, shows a running timer and level bars, then sends audio', async ({ page, request }) => {
    await visibleGo(page, 'home', 'voice').click();
    await page.locator('[data-action="voice-toggle"]').click();
    await expect(page.locator('[data-voice-hint]')).toHaveText('Tap to stop');
    await expect(page.locator('[data-mic-pulse]')).toBeVisible();
    await expect(page.locator('[data-voice-time]')).toHaveText('0:02', { timeout: 4000 });
    await page.locator('[data-action="voice-toggle"]').click();
    await expect(page.locator('[data-voice-hint]')).toHaveText(/Edit the words/);
    await page.locator('[data-transcript]').fill('Smoke coming down the hill toward the houses');
    const reqPromise = page.waitForRequest((r) => r.url().endsWith('/api/reports') && r.method() === 'POST');
    await page.locator('[data-action="voice-send"]').click();
    const req = await reqPromise;
    expect(req.postDataBuffer().toString('latin1')).toContain('name="media"');
    await expect(screen(page, 'sent')).toBeVisible();
    await expect
      .poll(async () => (await (await request.get('/api/state')).json()).incidents.some((i) => i.counts.voice > 0), { timeout: 10000 })
      .toBe(true);
  });

  test('send stays disabled until there is something to send', async ({ page }) => {
    await visibleGo(page, 'home', 'voice').click();
    await expect(page.locator('[data-voice-actions]')).toHaveCSS('pointer-events', 'none');
    await page.locator('[data-transcript]').fill('Power lines down on my street');
    await expect(page.locator('[data-voice-actions]')).toHaveCSS('pointer-events', 'auto');
  });

  test('typed note alone can be sent', async ({ page }) => {
    await visibleGo(page, 'home', 'voice').click();
    await page.locator('[data-transcript]').fill('Strong gas smell outside');
    await page.locator('[data-action="voice-send"]').click();
    await expect(screen(page, 'sent')).toBeVisible();
  });

  test('redo clears the recording', async ({ page }) => {
    await visibleGo(page, 'home', 'voice').click();
    await page.locator('[data-action="voice-toggle"]').click();
    await page.waitForTimeout(1200);
    await page.locator('[data-action="voice-toggle"]').click();
    await page.locator('[data-action="voice-redo"]').click();
    await expect(page.locator('[data-voice-time]')).toHaveText('0:00');
    await expect(page.locator('[data-transcript]')).toHaveValue('');
  });

  test('cancel stops recording and goes home', async ({ page }) => {
    await visibleGo(page, 'home', 'voice').click();
    await page.locator('[data-action="voice-toggle"]').click();
    await page.waitForTimeout(600);
    await page.locator('[data-action="voice-cancel"]').click();
    await expect(screen(page, 'home')).toBeVisible();
    await visibleGo(page, 'home', 'voice').click();
    await expect(page.locator('[data-voice-time]')).toHaveText('0:00');
    await expect(page.locator('[data-voice-hint]')).toHaveText('Tap to start');
  });
});

test.describe('Help', () => {
  test('Call 911 dials 911', async ({ page }) => {
    await visibleGo(page, 'home', 'help').click();
    await expect(page.getByRole('link', { name: /Call 911/ })).toHaveAttribute('href', 'tel:911');
  });

  test('switches turn on and off', async ({ page }) => {
    await visibleGo(page, 'home', 'help').click();
    const row = page.locator('.toggle-row', { hasText: 'Someone is hurt' });
    await row.click();
    await expect(page.locator('.toggle-row', { hasText: 'Someone is hurt' })).toHaveClass(/on/);
    await page.locator('.toggle-row', { hasText: 'Someone is hurt' }).click();
    await expect(page.locator('.toggle-row', { hasText: 'Someone is hurt' })).not.toHaveClass(/on/);
  });

  test('"I can\'t speak safely" switches to silent text', async ({ page }) => {
    await visibleGo(page, 'home', 'help').click();
    await page.locator('.toggle-row', { hasText: "I can't speak safely" }).click();
    await expect(page.locator('[data-connect-title]')).toHaveText('Text with a responder');
    await expect(page.locator('[data-connect-sub]')).toHaveText('Silent. No call or sound.');
  });

  test('location sharing only says "sharing" after asking for help', async ({ page }) => {
    await visibleGo(page, 'home', 'help').click();
    await expect(page.locator('.sharing-title')).toHaveText('Your location is sent when you ask for help');
  });

  test('help request reaches the responder queue and updates when assigned', async ({ page, request }) => {
    await visibleGo(page, 'home', 'help').click();
    await page.locator('.toggle-row', { hasText: "I'm trapped" }).click();
    await page.locator('[data-action="help-send"]').click();
    await expect(page.locator('[data-help-status-title]')).toHaveText('Request sent');
    await expect(page.locator('.sharing-title')).toHaveText('Sharing your location with responders');
    let urgent;
    await expect.poll(async () => {
      urgent = (await (await request.get('/api/state')).json()).urgent.filter((u) => u.flags.includes('trapped') && u.help_status === 'waiting' && !u.contact_name);
      return urgent.length;
    }).toBeGreaterThan(0);
    await request.post(`/api/help/${urgent.at(-1).id}/status`, { data: { status: 'assigned' } });
    await expect(page.locator('[data-help-status-title]')).toHaveText('A responder is on it', { timeout: 8000 });
  });

  test('silent request shows a text box that sends quietly', async ({ page }) => {
    await visibleGo(page, 'home', 'help').click();
    await page.locator('.toggle-row', { hasText: "I can't speak safely" }).click();
    await page.locator('[data-action="help-send"]').click();
    await expect(page.locator('[data-silent-box]')).toBeVisible();
    await page.locator('[data-silent-text]').fill('Someone is outside my door');
    await page.locator('[data-action="silent-send"]').click();
    await expect(page.locator('[data-toast]')).toHaveText(/Sent/);
  });

  test('offline help request tells the person to call 911', async ({ page, context }) => {
    await visibleGo(page, 'home', 'help').click();
    await context.setOffline(true);
    await page.locator('[data-action="help-send"]').click();
    await expect(page.locator('[data-toast]')).toHaveText(/Call 911/);
    await context.setOffline(false);
  });
});

test.describe('Alerts', () => {
  test('alert covering your location appears on the home screen', async ({ page, request }) => {
    const box = [[34.10, -118.31], [34.10, -118.27], [34.14, -118.27], [34.14, -118.31]];
    const res = await request.post('/api/alerts', { data: { level: 'Prepare to leave', title: 'Fire alert: Prepare to leave', message: 'Get ready to leave.', polygon: box, residents_est: 5000 } });
    expect(res.status()).toBe(201);
    await page.reload();
    await expect(page.locator('[data-alert]')).toBeVisible();
    await expect(page.locator('[data-alert-title]')).toHaveText('Fire alert: Prepare to leave');
    await expect(page.locator('[data-alert-level]')).toContainText('Prepare to leave');
  });

  test('alert elsewhere does not show', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, permissions: ['geolocation'], geolocation: { latitude: 33.9, longitude: -118.0 } });
    const page = await ctx.newPage();
    await page.goto('/');
    await expect(page.locator('[data-loc-pill]')).toHaveText('Location on');
    await page.waitForTimeout(800);
    await expect(page.locator('[data-alert]')).toBeHidden();
    await ctx.close();
  });
});

test.describe('No signal', () => {
  test('saves the report on the phone and says so', async ({ page, context }) => {
    await visibleGo(page, 'home', 'text').click();
    await page.locator('[data-text]').fill('Flooding at the underpass, no signal here');
    await context.setOffline(true);
    await page.locator('[data-action="text-send"]').click();
    await expect(page.getByRole('heading', { name: 'Saved on your phone.' })).toBeVisible();
    await expect(page.locator('[data-sent-time]')).toHaveText('Waiting for signal');
    await context.setOffline(false);
  });

  test('sends by itself when signal returns and updates the screen', async ({ page, context, request }) => {
    const before = (await (await request.get('/api/state')).json()).stats.reports_last_hour;
    await visibleGo(page, 'home', 'text').click();
    await page.locator('[data-text]').fill('Water rising in the garage');
    await context.setOffline(true);
    await page.locator('[data-action="text-send"]').click();
    await expect(page.getByRole('heading', { name: 'Saved on your phone.' })).toBeVisible();
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.getByRole('heading', { name: 'Got it.' })).toBeVisible({ timeout: 10000 });
    const after = (await (await request.get('/api/state')).json()).stats.reports_last_hour;
    expect(after).toBe(before + 1);
  });

  test('home shows how many reports are waiting, and clears after sending', async ({ page, context }) => {
    await visibleGo(page, 'home', 'text').click();
    await page.locator('[data-text]').fill('Power out on my block');
    await context.setOffline(true);
    await page.locator('[data-action="text-send"]').click();
    await page.locator('.center-link').click();
    await expect(page.locator('[data-outbox]')).toBeVisible();
    await expect(page.locator('[data-outbox-text]')).toContainText('1 report saved on this phone');
    await page.locator('[data-outbox]').click();
    await expect(page.locator('[data-toast]')).toHaveText(/Still offline/);
    // Signal comes back: the saved report goes out without the person doing anything.
    await context.setOffline(false);
    await expect(page.locator('[data-outbox]')).toBeHidden({ timeout: 10000 });
  });

  test('server errors also keep the report for later', async ({ page }) => {
    await page.route('**/api/reports', (r) => (r.request().method() === 'POST' ? r.fulfill({ status: 503, body: '{}' }) : r.continue()));
    await visibleGo(page, 'home', 'text').click();
    await page.locator('[data-text]').fill('Smoke near the school');
    await page.locator('[data-action="text-send"]').click();
    await expect(page.getByRole('heading', { name: 'Saved on your phone.' })).toBeVisible();
  });

  test('a rejected report is not retried forever and the person is told', async ({ page }) => {
    await page.route('**/api/reports', (r) => (r.request().method() === 'POST' ? r.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"Location is required."}' }) : r.continue()));
    await visibleGo(page, 'home', 'text').click();
    await page.locator('[data-text]').fill('Test');
    await page.locator('[data-action="text-send"]').click();
    await expect(page.locator('[data-toast]')).toHaveText(/Location is required/);
    await expect(screen(page, 'text')).toBeVisible();
  });
});

test.describe('Speed', () => {
  test('every screen opens in under 300 ms', async ({ page }) => {
    for (const target of ['camera', 'voice', 'text', 'help']) {
      const ms = await page.evaluate(async (t) => {
        const start = performance.now();
        document.querySelector(`[data-screen="home"] [data-go="${t}"]`).click();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const ok = !document.querySelector(`[data-screen="${t}"]`).hidden;
        return ok ? performance.now() - start : 99999;
      }, target);
      expect(ms, `${target} took ${ms} ms`).toBeLessThan(300);
      await page.evaluate(() => { for (const s of document.querySelectorAll('[data-screen]')) s.hidden = s.dataset.screen !== 'home'; });
    }
  });

  test('no frozen moments while clicking through the app', async ({ page }) => {
    for (const t of ['text', 'home', 'voice', 'home', 'help', 'home', 'camera', 'home']) {
      await page.evaluate((x) => document.querySelector(`[data-screen]:not([hidden]) [data-go="${x}"], [data-screen="home"] [data-go="${x}"]`)?.click(), t);
    }
    const long = await page.evaluate(() => window.__longTasks.filter((d) => d > 200));
    expect(long).toEqual([]);
  });
});

test.describe('Install and offline files', () => {
  test('web app manifest is valid', async ({ request }) => {
    const res = await request.get('/manifest.webmanifest');
    expect(res.ok()).toBe(true);
    const m = await res.json();
    expect(m.display).toBe('standalone');
    expect(m.icons.length).toBeGreaterThan(0);
  });

  test('offline support file and code are served fresh', async ({ request }) => {
    const sw = await request.get('/sw.js');
    expect(sw.ok()).toBe(true);
    const js = await request.get('/resident.js');
    expect(js.headers()['cache-control']).toContain('no-cache');
  });

  test('every button and link has a readable name', async ({ page }) => {
    const unnamed = await page.evaluate(() =>
      [...document.querySelectorAll('button, a')].filter((el) => !(el.getAttribute('aria-label') || el.textContent.trim())).map((el) => el.outerHTML.slice(0, 80)),
    );
    expect(unnamed).toEqual([]);
  });
});
