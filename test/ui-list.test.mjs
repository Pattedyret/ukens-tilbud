import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateList, addOffer, addCustom, toggleChecked, remove, clearChecked, clear, total, toText } from '../lib/ui-list.mjs';
test('v1-par migreres uten tap', () => {
  const item = { name: 'Melk', chain: 'kiwi', price: 20, size: '1 l', extra: 'behold' };
  const list = migrateList([['old', item]]);
  assert.deepEqual(list.get('old'), { ...item, checked: false });
});
test('pakkedeal teller total; avkryssede og egne varer har rett sum og tekst', () => {
  const list = new Map();
  addOffer(list, { name: 'Pizza' }, { id: 'pizza', chain: 'obs', price: 100, bundle: { count: 3, total: 100, each: 33.33 }, valid_to: '2026-10-08' });
  addCustom(list, 'Husk poser', 123);
  assert.equal(total(list), 100);
  assert.match(toText(list, s => s), /Pizza.*3 for 100/);
  toggleChecked(list, 'pizza');
  assert.equal(total(list), 0);
  assert.match(toText(list, s => s), /\[x\] Pizza/);
  assert.match(toText(list, s => s), /Egne varer\n.*Husk poser/);
  clearChecked(list);
  assert.equal(list.size, 1);
  remove(list, 'custom:123');
  assert.equal(list.size, 0);
  addCustom(list, 'A', 123); addCustom(list, 'B', 123);
  assert.equal(list.size, 2);
  clear(list); assert.equal(list.size, 0);
});
