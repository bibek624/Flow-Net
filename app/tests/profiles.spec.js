// Dual-use: the same app runs as a city, a seaport, or a base. Plus the live
// impact numbers and the situation strip on the resident home screen.
import { test, expect, resetDemo, postReport, waitForTriage } from './fixtures.js';

const setProfile = async (request, key) => {
  const res = await request.post('/api/profile', { data: { key } });
  expect(res.ok()).toBeTruthy();
  return res.json();
};

test.describe.configure({ mode: 'serial' });

test.afterAll(async ({ request }) => {
  await setProfile(request, 'city');
});

test.describe('Profiles (API)', () => {
  test('config lists three deployments and starts as City', async ({ request }) => {
    await setProfile(request, 'city');
    const c = await (await request.get('/api/config')).json();
    expect(c.profiles.map((p) => p.key)).toEqual(['city', 'port', 'base']);
    expect(c.profile.key).toBe('city');
    expect(c.profile.categories.map((x) => x.key)).toContain('flood');
  });

  test('switching to Port reloads a port scenario with port categories', async ({ request }) => {
    const c = await setProfile(request, 'port');
    expect(c.profile.org).toContain('Port of Los Angeles');
    const keys = c.profile.categories.map((x) => x.key);
    expect(keys).toEqual(expect.arrayContaining(['vessel', 'drone', 'hazmat', 'crane']));
    const s = await (await request.get('/api/state')).json();
    expect(s.incidents.map((i) => i.title)).toEqual(expect.arrayContaining(['Container stack fire', 'Drone over terminal', 'Vessel adrift']));
    expect(s.urgent.length).toBe(2);
  });

  test('a port report is sorted with port words', async ({ request }) => {
    const id = await postReport(request, { text: 'Barge adrift near the pilings, no tug in sight', lat: '33.7210', lng: '-118.2712' });
    const r = await waitForTriage(request, id);
    expect(r.report.category).toBe('vessel');
    expect(r.incident.title).toBe('Vessel adrift');
  });

  test('alert wording follows the category family', async ({ request }) => {
    const s = await (await request.get('/api/state')).json();
    const drone = s.incidents.find((i) => i.category === 'drone');
    const d = await (await request.get(`/api/incidents/${drone.id}`)).json();
    expect(d.alert_templates.map((t) => t[0])).toEqual(['Advisory', 'Shelter in place', 'Avoid area']);
    expect(d.alert_templates[0][2]).toContain('Berth 100');
  });

  test('switching to Base gives security categories and a base scenario', async ({ request }) => {
    const c = await setProfile(request, 'base');
    expect(c.profile.org).toContain('Los Alamitos');
    expect(c.profile.categories[0].key).toBe('security');
    const s = await (await request.get('/api/state')).json();
    expect(s.incidents.some((i) => i.title === 'Perimeter breach' && i.confidence === 'Confirmed')).toBe(true);
    expect(s.incidents.some((i) => i.counts.photo > 0)).toBe(true);
  });

  test('unknown profile is refused', async ({ request }) => {
    const res = await request.post('/api/profile', { data: { key: 'moon' } });
    expect(res.status()).toBe(400);
  });
});

test.describe('Impact numbers', () => {
  test.beforeAll(async ({ request }) => {
    await setProfile(request, 'city');
  });

  test('reports fold into far fewer incidents', async ({ request }) => {
    const m = await (await request.get('/api/impact')).json();
    expect(m.reports_total).toBeGreaterThan(40);
    expect(m.incidents_total).toBe(6);
    expect(m.dedup_pct).toBeGreaterThanOrEqual(80);
    expect(m.duplicates_folded).toBe(m.reports_total - m.incidents_total - 3); // three help requests are not duplicates
    expect(m.per_minute).toHaveLength(60);
  });

  test('median human review time comes from confirmed incidents', async ({ request }) => {
    const m = await (await request.get('/api/impact')).json();
    expect(m.median_review_min).toBeGreaterThan(0);
    expect(m.reviewed_pct).toBeGreaterThan(0);
  });

  test('alert precision is measured against the whole population', async ({ request }) => {
    const box = [[34.11, -118.30], [34.11, -118.28], [34.13, -118.28], [34.13, -118.30]];
    await request.post('/api/alerts', { data: { level: 'Advisory', title: 'Test', message: 'Test', polygon: box, residents_est: 2300 } });
    const m = await (await request.get('/api/impact')).json();
    expect(m.last_alert.residents_est).toBe(2300);
    expect(m.population).toBe(10_000_000);
  });

  test('assigning a responder records how long the person waited', async ({ request }) => {
    const s = await (await request.get('/api/state')).json();
    const u = s.urgent[0];
    await request.post(`/api/help/${u.id}/status`, { data: { status: 'assigned' } });
    const m = await (await request.get('/api/impact')).json();
    expect(m.median_help_assign_min).toBeGreaterThan(0);
  });

  test('weather context endpoint answers even when the weather service is unreachable', async ({ request }) => {
    const c = await (await request.get('/api/context?lat=34.1&lng=-118.3')).json();
    expect(Array.isArray(c.nws)).toBe(true);
  });
});

test.describe('Dashboard shows profiles and impact', () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  test.beforeEach(async ({ request }) => {
    await resetDemo(request);
  });

  test('impact strip shows the fold and the sparkline', async ({ page }) => {
    await page.goto('/responder');
    await expect(page.locator('[data-kpi="fold"]')).toHaveText(/\d+ → 6/);
    await expect(page.locator('[data-kpi="fold-sub"]')).toContainText('fewer items to triage');
    await expect(page.locator('[data-kpi="dups"]')).toHaveText(/\d+/);
    await expect(page.locator('[data-kpi="review"]')).toHaveText(/\d+ min/);
    await expect(page.locator('[data-spark] polyline')).toHaveCount(1);
  });

  test('profile select switches the whole dashboard to the Port', async ({ page }) => {
    await page.goto('/responder');
    await expect(page.locator('.inc').first()).toBeVisible();
    await page.locator('[data-profile-select]').selectOption('port');
    await expect(page.locator('[data-toast]')).toHaveText(/Port of Los Angeles/);
    await expect(page.locator('.inc', { hasText: 'Container stack fire' })).toBeVisible();
    await expect(page.locator('[data-legend]')).toContainText('Vessel incident');
    await expect(page.locator('[data-type-filter] option')).toContainText(['Drone sighting']);
    await expect(page.locator('.cluster')).toHaveCount(5);
    const center = await page.evaluate(() => { const c = document.querySelector('#map')._leaflet_map?.getCenter?.(); return c && c.lat; });
    if (center) expect(center).toBeLessThan(33.9);
    await page.locator('[data-profile-select]').selectOption('city');
    await expect(page.locator('.inc', { hasText: 'Wildfire smoke' })).toBeVisible();
  });

  test('header stays on one line at laptop width', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/responder');
    await expect(page.locator('.inc').first()).toBeVisible();
    const top = await page.locator('.top').boundingBox();
    expect(top.height).toBeLessThan(70);
  });
});

test.describe('Resident situation strip', () => {
  test.use({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    permissions: ['geolocation'], geolocation: { latitude: 34.1187, longitude: -118.2902, accuracy: 12 },
  });

  test.beforeAll(async ({ request }) => {
    await resetDemo(request);
  });

  test('inside an incident area the strip turns red and the page tints', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-strip]')).toHaveAttribute('data-level', 'danger');
    await expect(page.locator('[data-strip-title]')).toContainText(/Wildfire smoke/);
    await expect(page.locator('#app')).toHaveAttribute('data-threat', 'danger');
    await expect(page.locator('[data-minimap]')).toBeVisible();
  });

  test('a few miles away it is a watch, far away it is calm', async ({ browser, baseURL }) => {
    const mk = async (lat, lng) => {
      const ctx = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, permissions: ['geolocation'], geolocation: { latitude: lat, longitude: lng } });
      await ctx.route(/(cartocdn|googleapis|gstatic|open-meteo|nominatim)/, (r) => r.abort());
      const page = await ctx.newPage();
      await page.goto('/');
      await expect(page.locator('[data-loc-pill]')).toHaveText('Location on');
      await expect(page.locator('[data-strip]')).not.toHaveAttribute('data-level', 'none');
      const level = await page.locator('[data-strip]').getAttribute('data-level');
      await ctx.close();
      return level;
    };
    expect(await mk(34.06, -118.30)).toBe('watch');
    expect(await mk(32.7157, -117.1611)).toBe('calm');
  });

  test('chips come from the active profile', async ({ page, request }) => {
    await setProfile(request, 'port');
    await page.goto('/');
    await page.locator('[data-screen="home"] [data-go="text"]').click();
    await expect(page.locator('.chip', { hasText: 'Vessel incident' })).toBeVisible();
    await expect(page.locator('.chip', { hasText: 'Gas smell' })).toHaveCount(0);
    await setProfile(request, 'city');
  });

  test('the organization name shows in the top bar', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-org]')).toHaveText(/Los Angeles/);
  });
});
