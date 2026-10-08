import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDeal, comparablePrice, statedPrePrice, hasDocumentedAdvantage } from '../lib/deals.mjs';

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

// TKT-9199: a before-price the catalogue states in its own text is documented;
// anything else is unknown, never "ordinary price".
test('statedPrePrice reads the lowest before-price the catalogue text states', () => {
  for (const [description, price, expected] of [
    ['175-250 g, 11 varianter! Ord.pris fra 41,90 til 43,90', 25, 41.9],
    ['3 varianter. 240/250 g Pr pk. Førpris 49,90/51,90', 34.9, 49.9],
    ['200–250 g Enh.pris 147,60–184,50 pr. kg Førpris 46,90–49,90', 36.9, 46.9],
    ['UKENS TILBUD 250G/10KAPSLER (159,60/KG/3,99/STK) FØRPRIS 49,90-76,90', 39.9, 49.9],
    ['350 g. Pr stk Før 42,90. Ikke-medlem: se hyllepris', 29.9, 42.9],
    ['Vaskekapsler, 38-pk. Ord.pris 139,- Vaskepulver, 4,42 kg.', 79, 139],
    ['Effektiv og skånsom 200 ml, (Før 259,90)', 181.9, 259.9],
    ['vare nr. 833 82 Normalpris 134,95', 99.95, 134.95],
  ]) assert.equal(statedPrePrice({ description, price }), expected, description);
  for (const description of ['500 g Førpris 99,80/kg', 'Før 159,60 pr. kg', 'Gjelder før 25.10.26', 'Pr kg fra 51,44', '']) {
    assert.equal(statedPrePrice({ description, price: 10 }), null, description);
  }
  assert.equal(statedPrePrice({ description: '2 for 50 Før 35,90', price: 50, bundle: { count: 2, total: 50, each: 25 } }), null);
});

test('documented advantage needs a real markdown, multibuy, bundle or higher stated before-price', () => {
  assert.equal(hasDocumentedAdvantage({ price: 20, pre_price: 40, discount_pct: 50 }), true);
  assert.equal(hasDocumentedAdvantage({ price: 30, multibuy: { buy: 3, pay: 2, unit_price: 30, effective_price: 20 } }), true);
  assert.equal(hasDocumentedAdvantage({ price: 50, bundle: { count: 2, total: 50, each: 25 } }), true);
  assert.equal(hasDocumentedAdvantage({ price: 25, description: 'Ord.pris fra 41,90 til 43,90' }), true);
  // Stated price equal to the offer: no advantage.
  assert.equal(hasDocumentedAdvantage({ price: 19.9, description: 'FAST LAVPRIS! ORD. PRIS 19,90 PR STK' }), false);
  // A truncated or below-price number cannot prove a markdown.
  assert.equal(hasDocumentedAdvantage({ price: 189, description: 'Nå 189,-. Før 2' }), false);
  // A range starting at or below the offer price does not prove every variant is cheaper.
  assert.equal(hasDocumentedAdvantage({ price: 50, description: 'Førpris 49,90–76,90' }), false);
  assert.equal(hasDocumentedAdvantage({ price: 89.95, description: 'Mønster: 90365 pr. stk. 89,95' }), false);
  assert.equal(hasDocumentedAdvantage({ price: null, description: 'Før 20' }), false);
});
