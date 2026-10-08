import test from 'node:test';
import assert from 'node:assert/strict';
import { matchingOffers } from '../lib/ui-filter.mjs';
const offers = [
  { id: 'a', chain: 'kiwi', price: 10, catalogues: ['national'] },
  { id: 'b', chain: 'obs', price: 25, catalogues: ['oslo'] },
  { id: 'c', chain: 'obs', price: 5, catalogues: ['bergen'], valid_to: '2020-01-01T00:00:00+0000' },
];
test('kjedefilter returnerer bare matchende tilbud', () => {
  assert.deepEqual(matchingOffers({ offers }, { chains: new Set(['obs']), hideExpired: true }).map(o => o.id), ['b']);
});
test('butikkfilter bruker katalogsnitt og kombineres med kjedefilter', () => {
  const storeCatalogues = [{ chain: 'obs', catalogues: ['oslo'] }];
  assert.deepEqual(matchingOffers({ offers }, { storeCatalogues }).map(o => o.id), ['b']);
  assert.equal(matchingOffers({ offers }, { storeCatalogues, chains: ['kiwi'] }).length, 0);
  assert.equal(matchingOffers({ offers }, { storeCatalogues: [{ chain: 'obs', catalogues: [] }] }).length, 0);
});
test('gammel data bruker butikkens kjede; utgåtte kommer bare med når valgt', () => {
  assert.equal(matchingOffers({ offers: [{ chain: 'obs' }, { chain: 'kiwi' }] }, { storeCatalogues: [{ chain: 'obs', catalogues: [] }] }).length, 1);
  assert.equal(matchingOffers({ offers }, { hideExpired: false }).length, 3);
  assert.equal(matchingOffers({ offers: [offers[2]] }, { hideExpired: true }).length, 0);
});
