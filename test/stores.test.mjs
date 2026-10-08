import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStoreIndex } from '../lib/stores.mjs';

const oslo = { id: 'oslo', dealer_id: 'dealer', name: 'KIWI Grünerløkka', street: 'Gate 1', zip_code: '0184', city: 'Oslo', latitude: 59.91, longitude: 10.75 };
const bergen = { ...oslo, id: 'bergen', city: 'Bergen', latitude: '60.39', longitude: '5.32' };
const catalogues = [
  { id: 'national', dealer_id: 'dealer', all_stores: true },
  { id: 'regional', dealer_id: 'dealer', all_stores: false },
  { id: 'unknown', dealer_id: 'dealer' },
  { id: 'other', dealer_id: 'other', all_stores: true },
];
test('national plus regional catalogue union belongs only to the actual store', () => {
  const stores = buildStoreIndex({ catalogues, dealerStores: new Map([['dealer', [oslo, bergen]]]), catalogueStores: new Map([['regional', [oslo, oslo]]]), chainSlugByDealer: new Map([['dealer', 'kiwi']]) });
  assert.deepEqual(stores.find(s => s.id === 'oslo'), { id: 'oslo', chain: 'kiwi', name: 'KIWI Grünerløkka', street: 'Gate 1', zip: '0184', city: 'Oslo', lat: 59.91, lng: 10.75, catalogues: ['national', 'regional'] });
  assert.deepEqual(stores.find(s => s.id === 'bergen').catalogues, ['national']);
  assert.equal(stores.length, 2);
});
test('store without known catalogues stays visible and coordinates are not invented', () => {
  const stores = buildStoreIndex({ catalogues: [], dealerStores: new Map([['dealer', [{ ...oslo, latitude: null, longitude: '' }]]]), catalogueStores: new Map(), chainSlugByDealer: new Map([['dealer', 'kiwi']]) });
  assert.deepEqual(stores[0].catalogues, []);
  assert.equal(stores[0].lat, null);
  assert.equal(stores[0].lng, null);
});
test('regional endpoint can recover stores when dealer listing failed', () => {
  const stores = buildStoreIndex({ catalogues, dealerStores: new Map(), catalogueStores: new Map([['regional', [oslo]]]), chainSlugByDealer: new Map([['dealer', 'kiwi']]) });
  assert.deepEqual(stores[0].catalogues, ['national', 'regional']);
});
test('foreign dealer and unknown chains cannot receive regional offers', () => {
  const stores = buildStoreIndex({ catalogues, dealerStores: new Map([['dealer', [oslo]], ['other', [{ ...oslo, id: 'foreign', dealer_id: 'other' }]]]), catalogueStores: new Map([['regional', [{ ...oslo, id: 'foreign', dealer_id: 'other' }]]]), chainSlugByDealer: new Map([['dealer', 'kiwi']]) });
  assert.deepEqual(stores.map(s => s.id), ['oslo']);
});

// Exercise the real scraper in a disposable directory, replacing only HTTP.
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
for (const mode of ['ok', 'stores-fail', 'regional-fail', 'empty-chain']) test(`scraper integration: ${mode}`, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tkt9148-A-test-'));
  try {
    await mkdir(join(dir, 'lib'));
    for (const file of ['scrape.mjs', 'lib/deals.mjs', 'lib/stores.mjs', 'lib/categorize.mjs']) await copyFile(fileURLToPath(new URL(`../${file}`, import.meta.url)), join(dir, file));
    await writeFile(join(dir, 'http-fixture.mjs'), `
      const mode = ${JSON.stringify(mode)};
      const store = { id: 'oslo', dealer_id: 'dealer', name: 'KIWI Oslo', city: 'Oslo', latitude: 59.91, longitude: 10.75 };
      const offer = { id: 'offer', heading: 'Boller', description: '3 FOR 100', pricing: { price: 100 }, quantity: { pieces: { from: 3 } }, run_till: '2099-01-01' };
      globalThis.fetch = async input => {
        const u = new URL(input), path = u.pathname, offset = Number(u.searchParams.get('offset'));
        let body;
        if (path.endsWith('/catalogs')) {
          body = ['national', 'regional'].map(id => ({ id, dealer: { id: 'dealer', name: 'KIWI', country: 'NO' }, all_stores: id === 'national' }));
          if (mode === 'empty-chain') body.push({ id: 'empty-cat', dealer: { id: 'empty-dealer', name: 'Elon', country: 'NO' }, all_stores: true });
        }
        else if (path.endsWith('/offers')) body = u.searchParams.get('catalog_ids') === 'empty-cat' ? [] : u.searchParams.get('catalog_ids') === 'national' ? [offer] : [{ ...offer, images: { thumb: 'https://example.com/bread.jpg' } }, { ...offer, id: 'regional-copy', run_from: '2026-10-01' }];
        else if (path.endsWith('/catalogs/regional/stores')) {
          if (mode === 'stores-fail' || mode === 'regional-fail') return { ok: false, status: 503 };
          body = [store];
        } else if (path.endsWith('/stores')) {
          if (mode === 'stores-fail') return { ok: false, status: 503 };
          // Exactly 100 records forces another page; Oslo exists only there.
          body = u.searchParams.get('dealer_ids') === 'empty-dealer' ? [{ ...store, id: 'empty-store', dealer_id: 'empty-dealer', name: 'Elon Oslo' }] : offset === 0 ? Array.from({ length: 100 }, (_, i) => ({ ...store, id: 'bergen-' + i, city: 'Bergen' })) : [store];
        } else throw new Error('Unexpected endpoint ' + path);
        return { ok: true, json: async () => body };
      };
    `);
    await exec(process.execPath, ['--import', './http-fixture.mjs', 'scrape.mjs'], { cwd: dir, env: { ...process.env, SCRAPE_DELAY_MS: '0' }, timeout: 10000 });
    const offers = JSON.parse(await readFile(join(dir, 'data/offers.json')));
    const stores = JSON.parse(await readFile(join(dir, 'data/stores.json')));
    assert.equal(offers.stats.offers, 1);
    const row = offers.products[0].offers[0];
    assert.deepEqual(row.catalogues, ['national', 'regional']);
    assert.equal(row.image, 'https://example.com/bread.jpg');
    assert.deepEqual(row.bundle, { count: 3, total: 100, each: 33.33 });
    assert.equal(offers.stats.offers_with_bundle, 1);
    const success = mode === 'ok' || mode === 'empty-chain';
    assert.equal(stores.complete, success);
    assert.equal(stores.failed.length, success ? 0 : mode === 'stores-fail' ? 2 : 1);
    assert.equal(offers.stats.stores_failed, stores.failed.length);
    if (mode === 'stores-fail') assert.deepEqual(stores.stores, []);
    else {
      assert.equal(stores.stores.length, mode === 'empty-chain' ? 102 : 101);
      if (mode === 'empty-chain') {
        assert.equal(stores.stores.find(s => s.id === 'empty-store').chain, 'elon');
        assert.deepEqual(stores.stores.find(s => s.id === 'empty-store').catalogues, ['empty-cat']);
      }
      assert.deepEqual(stores.stores.find(s => s.id === 'oslo').catalogues, success ? ['national', 'regional'] : ['national']);
      assert.deepEqual(stores.stores.find(s => s.id === 'bergen-0').catalogues, ['national']);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('malformed coordinates never become a fabricated map location', () => {
  for (const [latitude, longitude] of [[true, false], [' ', '\t'], [91, 181], ['north', 'east']]) {
    const stores = buildStoreIndex({ catalogues: [], dealerStores: new Map([['dealer', [{ ...oslo, latitude, longitude }]]]), catalogueStores: new Map(), chainSlugByDealer: new Map([['dealer', 'kiwi']]) });
    assert.equal(stores[0].lat, null);
    assert.equal(stores[0].lng, null);
  }
});
