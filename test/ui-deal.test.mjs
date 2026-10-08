import test from 'node:test';
import assert from 'node:assert/strict';
import { dealView, dealSize, dealDescription } from '../lib/ui-deal.mjs';
test('pakkedeal deler total og stykkpris, uten duplisert størrelse', () => {
  const o = { price: 100, bundle: { count: 3, total: 100, each: 33.33 }, size_text: '3 x 320 g', description: '3 for 100' };
  assert.equal(dealView(o).priceText, '3 for 100,–');
  assert.equal(dealView(o).perItemText, '33,33 kr/stk');
  assert.equal(dealView(o).badgeText, '3 for 100');
  assert.equal(dealSize(o), '320 g');
  assert.equal(dealDescription(o), '');
});
test('ratio beholder stykkpris og viser effektiv pris separat', () => {
  const v = dealView({ price: 39.9, multibuy: { buy: 3, pay: 2, effective_price: 26.6 } });
  assert.equal(v.priceText, '39,90 kr');
  assert.equal(v.badgeText, '3 for 2');
  assert.equal(v.perItemText, 'Ta 3: 26,60 kr/stk');
  assert.match(v.listText, /3 for 2/);
});
test('vanlig pris og ukjent pris', () => {
  assert.equal(dealView({ price: 20 }).listText, '20,– kr');
  assert.equal(dealView({}).priceText, '–');
});
test('pris-markup kan ikke injisere HTML fra en pakkedeal', () => {
  assert.doesNotMatch(dealView({ bundle: { count: '<img src=x onerror=alert(1)>', total: 100, each: 33.33 } }).priceHtml, /<img/);
});
