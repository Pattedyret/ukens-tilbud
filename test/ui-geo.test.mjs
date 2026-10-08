import test from 'node:test';
import assert from 'node:assert/strict';
import { haversine, nearbyStores, distanceText } from '../lib/ui-geo.mjs';
test('haversine stemmer med Oslo–Bergen og identisk sted', () => {
  const oslo = { lat: 59.9139, lng: 10.7522 }, bergen = { lat: 60.3913, lng: 5.3221 };
  assert.equal(haversine(oslo, oslo), 0);
  assert.ok(Math.abs(haversine(oslo, bergen) - 305) < 2);
  assert.equal(distanceText(1.2), '1,2 km');
});
test('søk kombineres med avstand, ugyldige koordinater rangeres sist', () => {
  const stores = [{ id: 'far', city: 'Oslo', lat: 60, lng: 11 }, { id: 'near', name: 'KIWI', city: 'Oslo', lat: 59.91, lng: 10.75 }, { id: 'missing', city: 'Oslo', lat: null, lng: null }];
  assert.deepEqual(nearbyStores(stores, { lat: 59.91, lng: 10.75 }, 'Oslo').map(s => s.id), ['near', 'far', 'missing']);
  assert.deepEqual(nearbyStores(stores, null, 'kiwi').map(s => s.id), ['near']);
});
test('bare de 50 nærmeste vises etter avstandssortering', () => {
  const stores = Array.from({ length: 75 }, (_, i) => ({ id: i, lat: 59 + i / 100, lng: 10 }));
  const found = nearbyStores(stores.reverse(), { lat: 59, lng: 10 });
  assert.equal(found.length, 50);
  assert.equal(found[0].id, 0);
  assert.equal(found.at(-1).id, 49);
});
