import { test as base, expect } from '@playwright/test';

// Outside services the sandbox and venue Wi-Fi may block. The app must work without them.
const EXTERNAL = /(server\.arcgisonline\.com|tile\.openstreetmap\.org|api\.weather\.gov|basemaps\.cartocdn\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|open-meteo\.com|nominatim\.openstreetmap\.org)/;

export const test = base.extend({
  // Every test fails if the page throws or logs an error.
  errors: async ({}, use) => {
    const errors = [];
    await use(errors);
    expect(errors, `Console or page errors:\n${errors.join('\n')}`).toEqual([]);
  },
  context: async ({ context }, use) => {
    await context.route(EXTERNAL, (route) => route.abort());
    await context.addInitScript(() => {
      // Collect long tasks so tests can check the page never freezes.
      window.__longTasks = [];
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) window.__longTasks.push(e.duration);
        }).observe({ type: 'longtask', buffered: true });
      } catch {}
    });
    await use(context);
  },
  page: async ({ page, errors }, use) => {
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const text = m.text();
      // Blocked outside services and deliberate offline tests are expected.
      if (/ERR_FAILED|ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(text)) return;
      errors.push(`console: ${text}`);
    });
    page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'Engine 12' : undefined));
    await use(page);
  },
});

export { expect };

export async function resetDemo(request) {
  const res = await request.post('/api/demo/reset', { data: {} });
  expect(res.ok()).toBeTruthy();
}

export async function postReport(request, fields) {
  const res = await request.post('/api/reports', { multipart: { kind: 'text', lat: '34.1187', lng: '-118.2902', ...fields } });
  expect(res.status()).toBe(201);
  return (await res.json()).id;
}

export async function waitForTriage(request, id) {
  await expect
    .poll(async () => (await (await request.get(`/api/reports/${id}`)).json()).report.status, { timeout: 8000 })
    .toBe('triaged');
  return (await request.get(`/api/reports/${id}`)).json();
}

export async function bgColor(page, selector = 'body') {
  return page.locator(selector).first().evaluate((el) => getComputedStyle(el).backgroundColor);
}

// WCAG relative luminance contrast between two computed CSS colors.
export async function contrast(page, fgSelector, bgSelector) {
  return page.evaluate(([f, b]) => {
    const parse = (sel, prop) => {
      const c = document.createElement('canvas').getContext('2d');
      c.fillStyle = getComputedStyle(document.querySelector(sel))[prop];
      c.fillRect(0, 0, 1, 1);
      const [r, g, bl] = c.getImageData(0, 0, 1, 1).data;
      return [r, g, bl];
    };
    const lum = ([r, g, b]) => {
      const ch = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
    };
    const a = lum(parse(f, 'color'));
    const z = lum(parse(b, 'backgroundColor'));
    return (Math.max(a, z) + 0.05) / (Math.min(a, z) + 0.05);
  }, [fgSelector, bgSelector]);
}

export async function noHorizontalScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
}
