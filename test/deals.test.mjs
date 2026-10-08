import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDeal, comparablePrice } from '../lib/deals.mjs';

for (const [description, price, count, each] of [
  ['3 FOR 100', 100, 3, 33.33],
  ['PLUKK & MIKS 2 FOR 50 50 g. 1 stk 34,90/36,90', 50, 2, 25],
  ['KRONEMARKED 3 for 100 1 stk 49,90', 100, 3, 33.33],
  ['SPAR 50.- 3 FOR 100.- Stort utvalg! 50,-/stk', 100, 3, 33.33],
  ['2 for 15 1 stk 9,90', 15, 2, 7.5],
  ['2 stk for 79,90', 79.9, 2, 39.95],
  ['2 FOR 50,-', 49.5, 2, 24.75],
  ['20 for 100', 100, 20, 5],
]) test(`bundle: ${description}`, () => {
  assert.deepEqual(parseDeal({ heading: 'Vare', description, price, piecesFrom: count }), {
    bundle: { count, total: price, each }, multibuy: null,
  });
});

test('bundle can be in heading without quantity metadata', () => {
  assert.deepEqual(parseDeal({ heading: '3 FOR 100', description: '', price: 100 }), {
    bundle: { count: 3, total: 100, each: 33.33 }, multibuy: null,
  });
});
for (const text of ['Medlemstilbud 3 for 2', '3=2', 'kjøp 3 betal 2', 'kjøp 3 betal for 2', 'ta 3 betal for 2', '3 for 2-pris']) {
  test(`ratio: ${text}`, () => assert.deepEqual(parseDeal({ heading: text, price: 39.9 }), {
    bundle: null, multibuy: { buy: 3, pay: 2, unit_price: 39.9, effective_price: 26.6 },
  }));
}
test('JYSK explicit 2 for 1 wins even though API describes a two-piece pack', () => {
  assert.deepEqual(parseDeal({ heading: 'BREDBYN håndkle', description: 'Garnfarget 2 for 1 2 stk. 50x100 cm', price: 99, piecesFrom: 2 }), {
    bundle: null, multibuy: { buy: 2, pay: 1, unit_price: 99, effective_price: 49.5 },
  });
});
for (const [text, price, piecesFrom] of [
  ['2 FOR 90', 45, 2], ['Egg 12 stk 39,90', 39.9, 12],
  ['5.10.–10.10.', 10, 1], ['abc3 for 2def', 10, 1],
  ['3 for 2 cm', 10, 1], ['3 for 2,5', 10, 1], ['3 for 2.50', 10, 1],
  ['3 for 20', 20.51, 3], ['21 for 100', 100, 21], ['1 for 20', 20, 1],
  ['3 for 3', 10, 1], ['2 for 0', 10, 1], ['2 for 50ml', 50, 2],
  ['2 for 50', null, 2], ['2 for 50', -50, 2],
]) test(`not a deal: ${text} / ${price}`, () => {
  assert.deepEqual(parseDeal({ heading: text, price, piecesFrom }), { bundle: null, multibuy: null });
});
test('search continues past an unrelated price to the matching deal', () => {
  assert.deepEqual(parseDeal({ description: '2 for 50 eller 3 for 100', price: 100 }), {
    bundle: { count: 3, total: 100, each: 33.33 }, multibuy: null,
  });
});

test('comparablePrice ranks a bundle per item, not by its total', () => {
  const single = { price: 30, bundle: null };
  const bundle = { price: 50, bundle: { count: 2, total: 50, each: 25 } };
  assert.equal(comparablePrice(bundle), 25);
  assert.equal(comparablePrice(single), 30);
  assert.ok(comparablePrice(bundle) < comparablePrice(single));
  assert.equal(comparablePrice({ price: null }), null);
});
