import { test, expect, resetDemo, postReport, waitForTriage, bgColor, contrast, noHorizontalScroll } from './fixtures.js';

const state = async (request) => (await request.get('/api/state')).json();

test.beforeAll(async ({ request }) => {
  await resetDemo(request);
});

test.beforeEach(async ({ page }) => {
  await page.goto('/responder');
  await expect(page.locator('.inc').first()).toBeVisible();
});

test.describe('Overview', () => {
  test('header stats match the server', async ({ page, request }) => {
    const s = await state(request);
    await expect(page.locator('[data-stat="active"]')).toHaveText(String(s.stats.active));
    await expect(page.locator('[data-stat="urgent"]')).toHaveText(String(s.stats.urgent));
    expect(s.stats.active).toBeGreaterThanOrEqual(6);
  });

  test('urgent queue lists people, longest wait first', async ({ page }) => {
    const names = await page.locator('.urg .urg-name').allTextContents();
    expect(names.slice(0, 3)).toEqual(['Maria L.', 'Caller A7F2', 'J. Okafor']);
    const waits = await page.locator('.urg-wait').allTextContents();
    const secs = waits.map((w) => w.split(':').reduce((m, s) => m * 60 + Number(s), 0));
    expect([...secs].sort((a, b) => b - a)).toEqual(secs);
  });

  test('wait timers count up live', async ({ page }) => {
    const first = await page.locator('.urg-wait').first().textContent();
    await page.waitForTimeout(2100);
    expect(await page.locator('.urg-wait').first().textContent()).not.toBe(first);
  });

  test('incident list is in priority order from the server', async ({ page, request }) => {
    const s = await state(request);
    const titles = await page.locator('.inc .inc-title').allTextContents();
    expect(titles).toEqual(s.incidents.map((i) => i.title));
  });

  test('each incident shows confidence, place, and report count', async ({ page }) => {
    const card = page.locator('.inc').first();
    await expect(card.locator('.conf')).toHaveText(/Unconfirmed|Likely|Confirmed/);
    await expect(card.locator('.inc-place')).not.toBeEmpty();
    await expect(card.locator('.inc-meta')).toContainText(/\d+ reports?/);
  });

  test('map shows one marker per incident plus urgent pins', async ({ page, request }) => {
    const s = await state(request);
    await expect(page.locator('.cluster')).toHaveCount(s.incidents.length);
    await expect(page.locator('.urgent-pin')).toHaveCount(s.urgent.length);
  });

  test('AI status badge says whether Claude is on', async ({ page }) => {
    await expect(page.locator('[data-ai-badge]')).toHaveText(/AI triage on|AI off/);
  });

  test('legend lists every category and confidence level', async ({ page }) => {
    for (const label of ['Fire', 'Smoke', 'Flood', 'Power out', 'Gas smell', 'Road blocked', 'Unconfirmed', 'Likely', 'Confirmed', 'Urgent help']) {
      await expect(page.locator('[data-legend]')).toContainText(label);
    }
  });
});

test.describe('Filters', () => {
  test('search narrows the list', async ({ page }) => {
    await page.locator('[data-search]').fill('flood');
    await expect(page.locator('.inc')).toHaveCount(1);
    await expect(page.locator('.inc-title')).toHaveText('Street flooding');
  });

  test('search with no match says so', async ({ page }) => {
    await page.locator('[data-search]').fill('zzz no such thing');
    await expect(page.locator('[data-inc-list] .empty')).toHaveText('No incidents match these filters.');
    await expect(page.locator('.cluster')).toHaveCount(0);
  });

  test('type filter shows one kind', async ({ page }) => {
    await page.locator('[data-type-filter]').selectOption('power');
    const titles = await page.locator('.inc-title').allTextContents();
    expect(titles).toEqual(['Power out']);
  });

  test('"Fire and smoke" includes both', async ({ page }) => {
    await page.locator('[data-type-filter]').selectOption('fire');
    const titles = await page.locator('.inc-title').allTextContents();
    expect(titles).toEqual(expect.arrayContaining(['Wildfire smoke', 'Structure fire']));
  });

  test('confidence filter keeps only confirmed', async ({ page }) => {
    await page.locator('[data-conf-filter]').selectOption('2');
    const confs = await page.locator('.inc .conf').allTextContents();
    expect(confs.length).toBeGreaterThan(0);
    expect(new Set(confs)).toEqual(new Set(['Confirmed']));
  });

  test('map layers can be hidden and shown', async ({ page }) => {
    await page.locator('[data-layer="incidents"]').click();
    await expect(page.locator('.cluster')).toHaveCount(0);
    await page.locator('[data-layer="urgent"]').click();
    await expect(page.locator('.urgent-pin')).toHaveCount(0);
    await page.locator('[data-layer="incidents"]').click();
    await expect(page.locator('.cluster').first()).toBeVisible();
  });
});

test.describe('Incident detail', () => {
  test('opens with summary, zone, reports, and timeline', async ({ page }) => {
    await page.locator('.inc', { hasText: 'Wildfire smoke' }).click();
    const d = page.locator('[data-detail]');
    await expect(d).toBeVisible();
    await expect(d.locator('.d-title')).toHaveText('Wildfire smoke');
    await expect(d.locator('.ai-box p')).not.toBeEmpty();
    await expect(d.locator('.zone-box')).toContainText(/residents/, { timeout: 8000 });
    await expect(d.locator('.voice-note').first()).toBeVisible();
    await expect(d.locator('.tl li').first()).toBeVisible();
  });

  test('flags people asking for help inside the area', async ({ page }) => {
    await page.locator('.inc', { hasText: 'Wildfire smoke' }).click();
    await expect(page.locator('.callout').first()).toContainText('Maria L.');
  });

  test('selected incident is highlighted in list and on map', async ({ page }) => {
    await page.locator('.inc', { hasText: 'Street flooding' }).click();
    await expect(page.locator('.inc.sel .inc-title')).toHaveText('Street flooding');
    await expect(page.locator('.cluster.sel')).toHaveCount(1);
  });

  test('clicking a map marker opens its incident', async ({ page }) => {
    await page.locator('.cluster').first().click({ force: true });
    await expect(page.locator('[data-detail]')).toBeVisible();
  });

  test('Escape and the close button both close it', async ({ page }) => {
    await page.locator('.inc').first().click();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-detail]')).toBeHidden();
    await page.locator('.inc').first().click();
    await page.locator('[data-action="close-detail"]').click();
    await expect(page.locator('[data-detail]')).toBeHidden();
  });

  test('Confirm marks it confirmed and residents see it was reviewed', async ({ page, request }) => {
    const id = await postReport(request, { text: 'Gas smell near Morton Ave', lat: '34.0791', lng: '-118.2581' });
    await waitForTriage(request, id);
    await page.reload();
    await page.locator('.inc', { hasText: 'Gas smell' }).click();
    await page.locator('[data-action="confirm"]').click();
    await expect(page.locator('[data-action="confirm"]')).toHaveText('Confirmed');
    await expect(page.locator('[data-action="confirm"]')).toBeDisabled();
    await expect(page.locator('.d-head .conf')).toHaveText('Confirmed');
    const r = await (await request.get(`/api/reports/${id}`)).json();
    expect(r.report.reviewed).toBe(true);
  });

  test('Dispatch logs the hand-off in the timeline', async ({ page }) => {
    await page.locator('.inc', { hasText: 'Structure fire' }).click();
    await page.locator('[data-action="dispatch"]').click();
    await expect(page.locator('.tl')).toContainText('Handed off to Engine 12');
  });
});

test.describe('Targeted alert', () => {
  test.beforeEach(async ({ page }) => {
    await page.locator('.inc', { hasText: 'Wildfire smoke' }).click();
    await expect(page.locator('.zone-box')).toBeVisible({ timeout: 8000 });
    await page.locator('[data-action="alert"]').click();
    await expect(page.locator('[data-modal]')).toBeVisible();
  });

  test('preview shows a zone, a resident estimate, and a ready message', async ({ page }) => {
    await expect(page.locator('#alertmap path.leaflet-interactive')).toHaveCount(1);
    await expect(page.locator('[data-residents]')).toHaveText(/~[\d,]+/);
    expect(Number((await page.locator('[data-residents]').textContent()).replace(/\D/g, ''))).toBeGreaterThan(0);
    await expect(page.locator('[data-msg]')).not.toHaveValue('');
    await expect(page.locator('[data-notif-title]')).toHaveText('Fire alert: Prepare to leave');
  });

  test('zone size slider changes how many people are reached', async ({ page }) => {
    const before = Number((await page.locator('[data-residents]').textContent()).replace(/\D/g, ''));
    await page.locator('[data-zone-scale]').fill('200');
    await expect(page.locator('[data-zone-scale-label]')).toHaveText('200%');
    const after = Number((await page.locator('[data-residents]').textContent()).replace(/\D/g, ''));
    expect(after).toBeGreaterThan(before * 3);
  });

  test('alert level changes the message and phone preview', async ({ page }) => {
    await page.locator('[data-level="2"]').click();
    await expect(page.locator('[data-notif-title]')).toHaveText('Evacuate now');
    await expect(page.locator('[data-msg]')).toHaveValue(/Leave now/);
  });

  test('editing the message updates the preview and counter', async ({ page }) => {
    await page.locator('[data-msg]').fill('Test message for the area.');
    await expect(page.locator('[data-notif-msg]')).toHaveText('Test message for the area.');
    await expect(page.locator('[data-msg-len]')).toHaveText('26 / 360');
  });

  test('Escape and clicking outside cancel without sending', async ({ page, request }) => {
    const before = (await state(request)).alerts.length;
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-modal]')).toBeHidden();
    await page.locator('[data-action="alert"]').click();
    await page.locator('[data-modal]').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('[data-modal]')).toBeHidden();
    expect((await state(request)).alerts.length).toBe(before);
  });

  test('Approve and send stores the alert', async ({ page, request }) => {
    const before = (await state(request)).alerts.length;
    await page.locator('[data-action="send-alert"]').click();
    await expect(page.locator('[data-modal]')).toBeHidden();
    await expect(page.locator('[data-toast]')).toHaveText(/Alert sent to ~[\d,]+ residents/);
    const s = await state(request);
    expect(s.alerts.length).toBe(before + 1);
    expect(s.alerts[0].level).toBe('Prepare to leave');
  });
});

test.describe('Urgent help actions', () => {
  test('Assign responder marks the person as assigned', async ({ page }) => {
    const card = page.locator('.urg', { hasText: 'Caller A7F2' });
    await card.locator('[data-urg-act="assigned"]').click();
    await expect(page.locator('.urg', { hasText: 'Caller A7F2' }).locator('.flag.ok')).toHaveText('Responder assigned');
  });

  test('Mark safe removes them from the queue', async ({ page }) => {
    await page.locator('.urg', { hasText: 'Caller A7F2' }).locator('[data-urg-act="resolved"]').click();
    await expect(page.locator('.urg', { hasText: 'Caller A7F2' })).toHaveCount(0);
  });

  test('Call back is a phone link when a number was given', async ({ page }) => {
    await expect(page.locator('.urg', { hasText: 'Maria L.' }).getByRole('link', { name: 'Call back' })).toHaveAttribute('href', /^tel:/);
  });

  test('people who cannot speak safely get Text back, not a call', async ({ page }) => {
    const card = page.locator('.urg', { hasText: 'J. Okafor' });
    await expect(card.getByRole('link', { name: 'Call back' })).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Text back' })).toBeVisible();
  });
});

test.describe('Live updates', () => {
  test('a resident report appears without reloading', async ({ page, request }) => {
    const before = Number(await page.locator('[data-stat="reports_last_hour"]').textContent());
    await postReport(request, { text: 'Flames near the trail', lat: '34.1192', lng: '-118.2895' });
    await expect(page.locator('[data-stat="reports_last_hour"]')).toHaveText(String(before + 1), { timeout: 5000 });
  });

  test('the incident that got a new report lights up', async ({ page, request }) => {
    await postReport(request, { text: 'Smoke column getting bigger', lat: '34.1180', lng: '-118.2910' });
    await expect(page.locator('.inc.flash').first()).toBeVisible({ timeout: 6000 });
  });

  test('a report far from everything starts a new incident', async ({ page, request }) => {
    const before = await page.locator('.inc').count();
    const id = await postReport(request, { text: 'Fallen tree blocking both lanes', lat: '34.2000', lng: '-118.5000' });
    await waitForTriage(request, id);
    await expect(page.locator('.inc')).toHaveCount(before + 1, { timeout: 5000 });
  });

  test('Replay live demo brings in a new fire, report by report', async ({ page }) => {
    const before = await page.locator('.inc').count();
    await page.locator('[data-action="replay"]').click();
    await expect(page.locator('.inc')).toHaveCount(before + 1, { timeout: 8000 });
    await expect(page.locator('.inc', { hasText: 'Baldwin Hills' }).locator('.inc-meta')).toContainText(/[3-9] reports/, { timeout: 8000 });
  });

  test('Resolve removes the incident from the active list', async ({ page }) => {
    const card = page.locator('.inc', { hasText: 'Road blocked' }).first();
    await card.click();
    await page.locator('[data-action="resolve"]').click();
    await expect(page.locator('[data-detail]')).toBeHidden();
    await expect(page.locator('.inc', { hasText: 'Mulholland' })).toHaveCount(0);
  });
});

test.describe('Theme and layout', () => {
  test('dark theme by default with readable text', async ({ page }) => {
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const [r, g, b] = (await bgColor(page, 'body')).match(/\d+/g).map(Number);
    expect(r + g + b).toBeLessThan(150);
    expect(await contrast(page, '.inc-title', '.inc')).toBeGreaterThan(7);
  });

  test('light theme switch works, is readable, and is remembered', async ({ page }) => {
    await page.locator('[data-action="theme"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const [r, g, b] = (await bgColor(page, 'body')).match(/\d+/g).map(Number);
    expect(r + g + b).toBeGreaterThan(600);
    expect(await contrast(page, '.inc-title', '.inc')).toBeGreaterThan(7);
    expect(await contrast(page, '.inc-place', '.inc')).toBeGreaterThan(4.5);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.locator('[data-action="theme"]').click();
  });

  for (const [w, h] of [[390, 844], [768, 1024], [1280, 800]]) {
    test(`no sideways scrolling at ${w}px`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(200);
      expect(await noHorizontalScroll(page)).toBe(true);
      await expect(page.locator('#map')).toBeVisible();
    });
  }

  test('header stays on one line at laptop width', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const heights = await page.locator('.stat span').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    for (const h of heights) expect(h).toBeLessThan(24);
    const top = await page.locator('.top').boundingBox();
    expect(top.height).toBeLessThan(70);
  });

  test('times in summaries match the dashboard clock', async ({ page }) => {
    await page.locator('.inc', { hasText: 'Wildfire smoke' }).click();
    const first = (await page.locator('.d-meta').nth(1).textContent()).match(/First report ([\d:]+ [AP]M)/)[1];
    const summary = await page.locator('.ai-box p').textContent();
    const m = summary.match(/since (\d+:\d+ [AP]M)/);
    if (m) expect(m[1]).toBe(first);
  });

  test('detail panel fits on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.inc').first().click();
    const box = await page.locator('[data-detail]').boundingBox();
    expect(box.width).toBeLessThanOrEqual(390);
    await expect(page.locator('[data-action="alert"]')).toBeInViewport();
  });
});

test.describe('Speed under load', () => {
  test('stays responsive with 80 new reports arriving', async ({ page, request }) => {
    const sends = [];
    for (let i = 0; i < 80; i++) {
      const lat = (34.0 + (i % 10) * 0.012).toFixed(4);
      const lng = (-118.45 + Math.floor(i / 10) * 0.015).toFixed(4);
      sends.push(postReport(request, { text: i % 2 ? 'Smoke in the area' : 'Power out on my street', lat, lng }));
    }
    await Promise.all(sends);
    await page.waitForTimeout(3000);
    const t0 = Date.now();
    await page.locator('.inc').nth(3).click();
    await expect(page.locator('[data-detail]')).toBeVisible();
    expect(Date.now() - t0).toBeLessThan(1500);
    const long = await page.evaluate(() => window.__longTasks.filter((d) => d > 300));
    expect(long).toEqual([]);
  });

  test('Reset restores the demo', async ({ page, request }) => {
    await page.locator('[data-action="reset"]').click();
    await expect(page.locator('[data-toast]')).toHaveText('Demo reset.');
    await expect.poll(async () => (await state(request)).stats.active).toBe(6);
    await expect(page.locator('.inc')).toHaveCount(6, { timeout: 5000 });
  });
});
