import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const base = 'http://127.0.0.1:8174';
let server, browser;
const leaflet = {};
before(async () => {
  await mkdir('/tmp/tkt9148', { recursive: true });
  for (const [ext, hash] of [['js', '20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo='], ['css', 'p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=']]) {
    const res = await fetch(`https://unpkg.com/leaflet@1.9.4/dist/leaflet.${ext}`);
    assert.equal(res.ok, true);
    leaflet[ext] = Buffer.from(await res.arrayBuffer());
    assert.equal(createHash('sha256').update(leaflet[ext]).digest('base64'), hash);
  }
  server = spawn('python3', ['-m', 'http.server', '8174', '--bind', '127.0.0.1'], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(base); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); server?.kill(); });
async function setup({ denied = false, old = false, mapFail = false, prefs = null, mobile = false } = {}) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 } });
  await context.grantPermissions(denied ? [] : ['geolocation'], { origin: base });
  await context.setGeolocation({ latitude: 59.9139, longitude: 10.7522 });
  const page = await context.newPage();
  await page.route('**/data/offers.json', async route => {
    const data = JSON.parse(await readFile(new URL('./fixtures/offers.json', import.meta.url)));
    if (old) for (const p of data.products) { delete p.department; for (const o of p.offers) delete o.catalogues; }
    await route.fulfill({ json: data });
  });
  await page.route('**/data/stores.json', route => route.fulfill({ path: new URL('./fixtures/stores.json', import.meta.url).pathname }));
  await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFZkAAAAASUVORK5CYII=', 'base64') }));
  if (mapFail) await page.route('https://unpkg.com/leaflet@1.9.4/**', route => route.abort());
  else {
    await page.route('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', route => route.fulfill({ body: leaflet.js, contentType: 'text/javascript' }));
    await page.route('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', route => route.fulfill({ body: leaflet.css, contentType: 'text/css' }));
  }
  await context.addInitScript(() => {
    window.positionRequests = 0;
    const getPosition = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    navigator.geolocation.getCurrentPosition = (...args) => { window.positionRequests++; return getPosition(...args); };
  });
  if (prefs) await context.addInitScript(p => { if (!localStorage.getItem('ukens-tilbud:v1')) localStorage.setItem('ukens-tilbud:v1', JSON.stringify(p)); }, prefs);
  await page.goto(base); await page.locator('.card').first().waitFor();
  return { page, context };
}
async function text(page, selector, expected) { await page.waitForFunction(({ selector, expected }) => document.querySelector(selector)?.textContent.includes(expected), { selector, expected }); }

test('deals, avdeling, kjedefilter og butikkens pris', async () => {
  const { page, context } = await setup();
  assert.match(await page.locator('[data-id="pizza"] .card-price').innerText(), /3 for\s+100,–/);
  assert.match(await page.locator('[data-id="pizza"]').innerText(), /33,33 kr\/stk/);
  assert.equal(await page.locator('[data-id="ost"] .badge-deal').innerText(), '3 for 2');
  assert.match(await page.locator('#results-count').innerText(), /30 produkter · 32 tilbud/);
  await page.locator('[data-department="Dagligvarer"]').click();
  assert.equal(await page.locator('[data-id="ovn"]').count(), 0);
  await page.locator('[data-chain="obs"]').click();
  assert.match(await page.locator('[data-id="pizza"] .card-price').innerText(), /120,–/);
  assert.match(await page.locator('#results-count').innerText(), /3 produkter · 3 tilbud/);
  await page.locator('[data-chain="obs"]').click();
  assert.equal(await page.evaluate(() => window.positionRequests), 0);
  assert.equal(await page.locator('script[src*="leaflet"]').count(), 0);
  await page.locator('#open-stores').click();
  assert.equal(await page.evaluate(() => window.positionRequests), 0);
  await page.waitForFunction(() => !!window.L && !!document.querySelector('.leaflet-container'));
  assert.match(await page.locator('.leaflet-control-attribution').innerText(), /OpenStreetMap/);
  await page.locator('#use-position').click();
  await text(page, '#position-status', 'Posisjonen er hentet');
  assert.equal(await page.locator('[data-store]').first().getAttribute('data-store'), 'kiwi-oslo');
  assert.match(await page.locator('.store-distance').first().innerText(), /0,0 km/);
  assert.match(await page.locator('#store-results').innerText(), /ingen tilbudsdata for denne butikken/);
  await page.locator('[data-store="obs-oslo"]').check();
  await page.screenshot({ path: '/tmp/tkt9148/e2e-deals-stores.png' });
  assert.equal(await page.evaluate(() => /lat|lng|latitude|longitude/.test(localStorage.getItem('ukens-tilbud:v1'))), false);
  await page.locator('#storedlg [data-close]').click();
  assert.match(await page.locator('[data-id="pizza"] .card-price').innerText(), /120,–/);
  assert.match(await page.locator('[data-id="melk"] .card-price').innerText(), /25,–/);
  await page.locator('[data-id="melk"] [data-add]').click();
  await page.locator('#open-list').click();
  assert.match(await page.locator('#l-body').innerText(), /25,– kr/);
  await page.locator('#listdlg [data-close]').click();
  await page.reload();
  await text(page, '#active-chips', 'Obs Alnabru');
  assert.match(await page.locator('[data-id="pizza"] .card-price').innerText(), /120,–/);
  await context.close();
});

test('nektet posisjon, lokalt søk og kartfallback', async () => {
  const { page, context } = await setup({ denied: true, mapFail: true });
  await page.locator('#open-stores').click();
  await page.locator('#use-position').click();
  await text(page, '#position-status', 'Du har ikke delt posisjon');
  await text(page, '#map-status', 'Kartet kunne ikke lastes');
  await page.locator('#store-search').fill('Bergen');
  assert.equal(await page.locator('[data-store]').count(), 2);
  await page.locator('[data-store="kiwi-bergen"]').check();
  await page.locator('#storedlg [data-close]').click();
  assert.equal(await page.locator('.card').count(), 1);
  assert.match(await page.locator('[data-id="melk"] .card-price').innerText(), /15,–/);
  await context.close();
});

test('handleliste består etter reload og migrerer v1; egne varer og avkryssing', async () => {
  const { page, context } = await setup({ prefs: { list: [['old', { name: 'Gammel vare', chain: 'kiwi', price: 20, size: '1 l', valid_to: '2020-01-01' }]] }, mobile: true });
  await page.locator('[data-id="pizza"] [data-add]').click();
  await page.locator('#open-list').click();
  await page.locator('#custom-item').fill('Husk poser');
  await page.locator('#custom-item').press('Enter');
  await page.locator('[data-check="pizza-kiwi"]').focus();
  await page.locator('[data-check="pizza-kiwi"]').press('Space');
  assert.equal(await page.locator('[data-check="pizza-kiwi"]').evaluate(el => document.activeElement === el), true);
  assert.match(await page.locator('#l-sub').innerText(), /20,– kr/);
  assert.match(await page.locator('#l-body').innerText(), /utgått/);
  await page.reload(); await page.locator('#open-list').click();
  assert.equal(await page.locator('[data-check="pizza-kiwi"]').isChecked(), true);
  assert.match(await page.locator('#l-body').innerText(), /Husk poser/);
  await page.locator('#clear-checked').click();
  assert.equal(await page.locator('[data-check="pizza-kiwi"]').count(), 0);
  assert.equal(await page.locator('#list-count').innerText(), '2');
  await page.screenshot({ path: '/tmp/tkt9148/e2e-list-mobile.png' });
  page.on('dialog', d => d.accept());
  await page.locator('#clear-list').click();
  assert.equal(await page.locator('#list-count').innerText(), '0');
  await context.close();
});

test('gammel data skjuler avdeling og bruker kjedefallback med notis', async () => {
  const { page, context } = await setup({ old: true });
  assert.equal(await page.locator('[data-department]').count(), 0);
  await page.locator('#open-stores').click();
  await page.locator('[data-store="obs-oslo"]').check();
  await page.locator('#storedlg [data-close]').click();
  await text(page, '#store-notice', 'kjeden');
  assert.match(await page.locator('[data-id="pizza"] .card-price').innerText(), /120,–/);
  await context.close();
});

test('detaljrad og kopiert liste deler dealtekst', async () => {
  const { page, context } = await setup();
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  await page.locator('[data-detail="pizza"]').press('Enter');
  assert.match(await page.locator('#d-body .offer-price').first().innerText(), /3 for\s+100,–/);
  assert.doesNotMatch(await page.locator('#d-body .offer-desc').first().innerText(), /3 x|3 for 100/);
  assert.equal((await page.locator('#d-body .offer-price').first().innerText()).match(/3 for\s+100/g).length, 1);
  await page.locator('[data-add-offer="pizza-kiwi"]').click();
  await page.locator('#detail [data-close]').click();
  await page.locator('[data-detail="ost"]').click();
  assert.match(await page.locator('#d-body').innerText(), /Ta 3: 26,60 kr\/stk/);
  await page.locator('[data-add-offer="ost-obs"]').click();
  await page.locator('#detail [data-close]').click();
  await page.locator('#open-list').click();
  assert.match(await page.locator('#l-sub').innerText(), /139,90 kr/);
  await page.locator('#copy-list').click();
  await text(page, '#copy-list', 'Kopiert');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(copied, /3 for 100,–.*33,33 kr\/stk/);
  assert.match(copied, /3 for 2.*26,60 kr\/stk/);
  await context.close();
});

test('butikkmarkør kan velge butikk og søk på postnummer fungerer', async () => {
  const { page, context } = await setup();
  await page.locator('#open-stores').click();
  await page.waitForFunction(() => !!document.querySelector('.leaflet-container'));
  await page.locator('#use-position').click();
  await text(page, '#position-status', 'Posisjonen er hentet');
  const point = await page.evaluate(() => {
    const center = L.CRS.EPSG3857.latLngToPoint(L.latLng(59.9139, 10.7522), 12);
    const marker = L.CRS.EPSG3857.latLngToPoint(L.latLng(59.93, 10.715), 12);
    const map = document.querySelector('#store-map');
    return { x: map.clientWidth / 2 + marker.x - center.x, y: map.clientHeight / 2 + marker.y - center.y };
  });
  await page.locator('#store-map').click({ position: point });
  await text(page, '.leaflet-popup-content', 'KIWI Majorstuen');
  await page.getByRole('button', { name: 'Vis tilbud her' }).click();
  assert.equal(await page.locator('[data-store="kiwi-majorstuen"]').isChecked(), true);
  await page.locator('#store-search').fill('5003');
  assert.equal(await page.locator('[data-store]').count(), 1);
  assert.equal(await page.locator('[data-store]').getAttribute('data-store'), 'kiwi-bergen');
  await context.close();
});

for (const [code, expected] of [[2, 'Posisjonen er utilgjengelig'], [3, 'Det tok for lang tid']]) {
  test(`posisjonsfeil ${code} gir melding og lar brukeren prøve igjen`, async () => {
    const { page, context } = await setup();
    await page.evaluate(code => { navigator.geolocation.getCurrentPosition = (_, fail) => fail({ code }); }, code);
    await page.locator('#open-stores').click();
    await page.locator('#use-position').click();
    await text(page, '#position-status', expected);
    assert.equal(await page.locator('#use-position').isEnabled(), true);
    await context.close();
  });
}

test('uten støtte for posisjon fungerer søket fremdeles', async () => {
  const { page, context } = await setup();
  await page.evaluate(() => Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true }));
  await page.locator('#open-stores').click();
  await page.locator('#use-position').click();
  await text(page, '#position-status', 'Posisjon er ikke støttet');
  await page.locator('#store-search').fill('Storgata');
  assert.equal(await page.locator('[data-store]').count(), 1);
  await context.close();
});

test('butikk uten kataloger gir tomt resultat og valget består', async () => {
  const { page, context } = await setup();
  await page.locator('#open-stores').click();
  await page.locator('[data-store="empty"]').check();
  await page.locator('#storedlg [data-close]').click();
  assert.equal(await page.locator('.card').count(), 0);
  assert.match(await page.locator('#results-count').innerText(), /0 produkter · 0 tilbud/);
  await page.reload();
  await text(page, '#results-count', '0 produkter');
  await page.locator('#open-stores').click();
  assert.equal(await page.locator('[data-store="empty"]').isChecked(), true);
  await page.locator('[data-store="empty"]').uncheck();
  await page.locator('#storedlg [data-close]').click();
  assert.equal(await page.locator('.card').count(), 30);
  await context.close();
});
