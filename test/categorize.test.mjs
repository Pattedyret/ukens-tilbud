import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as classifier from '../lib/categorize.mjs';

const adversarial = JSON.parse(fs.readFileSync(new URL('./fixtures/categorize-adversarial.json', import.meta.url)));

test('product department excludes equipment, preserves food compounds and guards non-food chains', () => {
  assert.equal(typeof classifier.classifyProduct, 'function', 'classifyProduct must implement the department contract');
  for (const row of adversarial) {
    assert.deepEqual(classifier.classifyProduct(row), {
      category: row.expected_category, department: row.expected_department,
    }, row.name);
  }
});

import { loadAuditData, auditRows, nonGroceryHits } from '../scripts/audit-categories.mjs';

const hasBuiltOffers = fs.existsSync(new URL('../data/offers.json', import.meta.url));

test('all available offers and historical variants keep equipment outside Dagligvarer', { skip: !hasBuiltOffers && 'data/offers.json bygges av scraperen' }, () => {
  const { variants } = loadAuditData();
  const failures = variants.filter(row => nonGroceryHits(row.name).length &&
    classifier.classifyProduct(row).department === 'Dagligvarer');
  assert.deepEqual(failures.map(r => r.name), []);
});

test('all available datasets meet other-category coverage targets', { skip: !hasBuiltOffers && 'data/offers.json bygges av scraperen' }, () => {
  const data = loadAuditData();
  for (const key of ['live', 'history', 'combined']) {
    const audit = auditRows(data[key]);
    assert.ok(audit.other.after.percent <= 20, `${key}: Annet ${audit.other.after.percent}%`);
    assert.ok(audit.pureGroceryOther.after.percent <= 8,
      `${key}: Annet i rene dagligvarekjeder ${audit.pureGroceryOther.after.percent}%`);
  }
});

const gold = JSON.parse(fs.readFileSync(new URL('./fixtures/categorize-gold.json', import.meta.url)));

test('seeded manual gold set stays within 2% category and department disagreement', () => {
  assert.ok(gold.filter(r => r.sample_group === 'grocery').length >= 300);
  assert.ok(gold.filter(r => r.sample_group === 'outside').length >= 150);
  const errors = gold.filter(row => {
    const actual = classifier.classifyProduct(row);
    return actual.category !== row.expected_category || actual.department !== row.expected_department;
  });
  assert.ok(errors.length / gold.length <= 0.02, `${errors.length}/${gold.length}: ${errors.map(r => r.name).join(', ')}`);
});

test('manual grocery sample has at least 98% department precision', () => {
  const groceries = gold.filter(r => classifier.classifyProduct(r).department === 'Dagligvarer');
  assert.ok(groceries.length >= 300, 'manual sample must contain at least 300 final grocery predictions');
  assert.ok(gold.length - groceries.length >= 150, 'manual sample must contain at least 150 final non-grocery predictions');
  const failures = groceries.filter(r => r.expected_department !== 'Dagligvarer');
  assert.ok(failures.length / groceries.length <= 0.02, failures.map(r => r.name).join(', '));
});

test('department guard rejects every grocery category in incapable and unknown sectors', () => {
  const items = ['Kaffe', 'Toalettpapir', 'Sjampo', 'Bleier', 'Hundemat'];
  for (const chainSectors of [[], ['Annet'], [undefined], ['Leker & barn'],
      ['Bygg & jernvare'], ['Elektronikk'], ['Møbler & interiør'], ['Sport & fritid'],
      ['Bygg & jernvare', undefined]]) {
    for (const name of items) {
      assert.deepEqual(classifier.classifyProduct({ name, chainSectors }),
        { category: 'Annet', department: 'Annet' }, `${name}: ${chainSectors}`);
    }
    assert.deepEqual(classifier.classifyProduct({ name: 'Ukens vare', descriptions: 'kaffe og sjampo', chainSectors }),
      { category: 'Annet', department: 'Annet' });
  }
  for (const sector of ['Dagligvarer', 'Lavpris & variert']) {
    for (const name of items) assert.equal(classifier.classifyProduct({name, chainSectors: ['Annet', sector]}).department, 'Dagligvarer');
  }
  assert.equal(classifier.SECTORS['Kids Outlet'], 'Leker & barn');
});

test('health and animal sectors only admit their specific grocery consumables', () => {
  for (const [sector, allowed, rejected] of [
    ['Helse & skjønnhet', ['Sjampo', 'Bleier'], ['Kaffe', 'Hundemat', 'Toalettpapir']],
    ['Hage & dyr', ['Hundemat'], ['Kaffe', 'Sjampo', 'Bleier', 'Toalettpapir']],
  ]) {
    for (const name of allowed) assert.equal(classifier.classifyProduct({name, chainSectors:[sector]}).department, 'Dagligvarer');
    for (const name of rejected) assert.equal(classifier.classifyProduct({name, chainSectors:[sector]}).department, 'Annet');
  }
});

test('Norwegian compounds and product heads survive unrelated marketing descriptions', () => {
  assert.equal(classifier.categorize('Søte klementiner', 'Te og kaffe på tilbud'), 'Frukt & grønt');
  assert.equal(classifier.categorize('Makrell i tomat', 'Naturlig rik på omega-3'), 'Fisk & sjømat');
  assert.equal(classifier.categorize('Vedovn', 'Perfekt til pizza og sjokolade'), 'Oppvarming');
  assert.equal(classifier.extractBrand('Gartner brokkolini'), 'Gartner');
});

test('public category metadata can render all classified fixture products', () => {
  for (const row of [...gold, ...adversarial]) {
    const result = classifier.classifyProduct(row);
    assert.ok(classifier.CATEGORIES.includes(result.category), `${row.name}: category missing from filter metadata`);
    assert.ok(classifier.DEPARTMENTS.includes(result.department), `${row.name}: department missing from filter metadata`);
    assert.equal(classifier.departmentOf(result.category), result.department, row.name);
  }
});

test('audit compares actual chain filtering with product departments using hand-checked records', () => {
  const audit = auditRows([
    { name: 'Vedovn', chains: ['obs'], chainSectors: ['Dagligvarer'], before_category: 'Annet', descriptions: '', source: 'test' },
    { name: 'Kaffe', chains: ['kiwi'], chainSectors: ['Dagligvarer'], before_category: 'Kaffe & te', descriptions: '', source: 'test' },
    { name: 'Ukjent produkt', chains: ['kiwi', 'unknown'], chainSectors: ['Dagligvarer', 'Annet'], before_category: 'Annet', descriptions: '', source: 'test' },
  ]);
  assert.deepEqual(audit.other, {
    before: { count: 2, total: 3, percent: 66.67 }, after: { count: 1, total: 3, percent: 33.33 },
  });
  assert.deepEqual(audit.pureGroceryOther, {
    before: { count: 1, total: 2, percent: 50 }, after: { count: 0, total: 2, percent: 0 },
  });
  assert.equal(audit.nonGroceryInGrocery.before[0].name, 'Vedovn');
  assert.deepEqual(audit.nonGroceryInGrocery.after, []);
  assert.deepEqual(audit.changes, [{
    name: 'Vedovn', chains: ['obs'], before: 'Annet', after: 'Oppvarming', department: 'Bygg, hage & bil',
  }]);
});

test('audit counts guard removals using hand-checked before/after products', () => {
  const audit = auditRows([
    {name:'Toalettpapir', chains:['power'], chainSectors:['Elektronikk'], before_category:'Husholdning'},
    {name:'Vedovn', chains:['obs'], chainSectors:['Dagligvarer'], before_category:'Oppvarming'},
    {name:'Kaffe', chains:['kiwi'], chainSectors:['Dagligvarer'], before_category:'Kaffe & te'},
  ]);
  assert.deepEqual(audit.departmentGuardMovedOut.map(row => row.name), ['Toalettpapir']);
});

const holdout = JSON.parse(fs.readFileSync(new URL('./fixtures/categorize-holdout.json', import.meta.url)));
const holdoutProvenance = JSON.parse(fs.readFileSync(new URL('./fixtures/categorize-holdout-provenance.json', import.meta.url)));

test('held-out sample stays disjoint from tuning gold and independent review', () => {
  assert.equal(holdout.length, 300);
  assert.equal(new Set(holdout.map(row => row.name)).size, 300);
  assert.equal(holdout.filter(row => row.sample_group === 'grocery').length, 200);
  assert.equal(holdout.filter(row => row.sample_group === 'outside').length, 100);
  const excluded = new Set([...gold.map(row => row.name), ...holdoutProvenance.excludedReviewNames]);
  assert.deepEqual(holdout.filter(row => excluded.has(row.name)).map(row => row.name), []);
  for (const row of holdout) {
    assert.ok(classifier.CATEGORIES.includes(row.expected_category), row.name);
    assert.ok(classifier.DEPARTMENTS.includes(row.expected_department), row.name);
  }
});

test('held-out grocery predictions have at least 97% manual department precision', () => {
  const predictedGrocery = holdout.filter(row => classifier.classifyProduct(row).department === 'Dagligvarer');
  assert.ok(predictedGrocery.length > 0, 'empty predictions cannot establish precision');
  const mistakes = predictedGrocery.filter(row => row.expected_department !== 'Dagligvarer');
  assert.ok(mistakes.length / predictedGrocery.length <= 0.03,
    `${mistakes.length}/${predictedGrocery.length}: ${mistakes.map(row => row.name).join(', ')}`);
});

test('held-out precision threshold also holds without adversarial training overlap', () => {
  const trainingNames = new Set(adversarial.map(row => row.name));
  const novel = holdout.filter(row => !trainingNames.has(row.name));
  const predictedGrocery = novel.filter(row => classifier.classifyProduct(row).department === 'Dagligvarer');
  assert.ok(predictedGrocery.length > 0);
  const mistakes = predictedGrocery.filter(row => row.expected_department !== 'Dagligvarer');
  assert.ok(mistakes.length / predictedGrocery.length <= 0.03,
    `${mistakes.length}/${predictedGrocery.length}: ${mistakes.map(row => row.name).join(', ')}`);
});
