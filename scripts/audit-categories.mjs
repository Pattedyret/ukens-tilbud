#!/usr/bin/env node
// Read-only audit. Stored categories are the baseline; history is never rewritten.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { classifyProduct, DEPARTMENTS, SECTORS } from '../lib/categorize.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
// Independent equipment nouns; food adjectives like «ovnsbakt» are not equipment.
export const NON_GROCERY_CHECKLIST = [
  /(?:ved|peis|panel|varme|mikrobølge|steke|pizza)ovn/i,
  /(?<![a-zæøå])(?:ovn|ovner|peis|ildsted|tv)(?![a-zæøå])/i,
  /varmepumpe|ytterdør|innerdør|dørblad|dørkarm|skotørker|spylervæske|motorolje|is[- ]?skrape/i,
  /sofa|spisestol|kontorstol|madrass|verktøy|vinkelsliper|batteridrill|kaffetrakter|kaffemaskin|ølglass|ostehøvel/i,
  /(?<![a-zæøå])(?:maling|lampe|lamper|komfyr)(?![a-zæøå])|gulvlampe|taklampe/i,
  /kattetre|hundebånd|akvarium|kleshenger|tørkestativ|toalettbørste/i,
  /diskolys|dessertskål|oppvaskkost|rengjøringsbørste|tøyserviett|sminkereisebag|sprayflaske til olje|fonduesett/i,
  /lydplanke|hørselvern|gassgrill|bålpanne|kakeform|kasserolle|grytesett|stekepanne|servise|vannkoker|brødrister|kjøkkenmaskin/i,
  /spisestol|kontorstol|garderobeskap|kommode|skotørker|ryggsekk|koffert|barnesykkel|barnevogn|snekker|gulvteppe/i,
];
export function nonGroceryHits(name) {
  const text = name.replace(/pizzaovn[- ]pizza|pizza for pizzaovn/gi, 'pizza')
    .replace(/peis[- ]kos(?=\s+sjokolade)/gi, 'kos');
  return NON_GROCERY_CHECKLIST.filter(re => re.test(text)).map(re => re.source);
}

export function loadAuditData(root = ROOT, offersFile = path.join(root, 'data/offers.json')) {
  const offersBytes = fs.readFileSync(offersFile);
  const live = JSON.parse(offersBytes.toString('utf8'));
  const sector = new Map(Object.entries(SECTORS).map(([name, sector]) =>
    [name.toLowerCase().replace(/[^a-z0-9æøå]+/g, '-').replace(/^-|-$/g, ''), sector]));
  for (const chain of live.chains) sector.set(chain.slug, SECTORS[chain.name] ?? chain.sector);
  const historyDir = path.join(root, 'data/history');
  const files = fs.readdirSync(historyDir).filter(f => /^\d{4}-w\d{2}\.json$/.test(f)).sort();
  if (!files.length) throw new Error('Ingen historikkfiler; revisjonen ville være ufullstendig');
  const history = new Map();
  const variants = [];
  const decorate = (p, source) => ({
    name: p.name, chains: p.chains, before_category: p.category,
    descriptions: (p.offers ?? []).map(o => o.description).filter(Boolean).join(' '),
    chainSectors: p.chains.map(c => sector.get(c) ?? 'Annet'), source,
  });
  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(historyDir, file), 'utf8'));
    for (const product of data.products) {
      const row = decorate(product, file);
      variants.push(row);
      const previous = history.get(row.name);
      const chains = [...new Set([...(previous?.chains ?? []), ...row.chains])];
      history.set(row.name, { ...row, chains, chainSectors: chains.map(c => sector.get(c) ?? 'Annet') });
    }
  }
  const liveRows = live.products.map(p => decorate(p, 'live'));
  const combined = new Map(history);
  for (const row of liveRows) {
    const chains = [...new Set([...(combined.get(row.name)?.chains ?? []), ...row.chains])];
    combined.set(row.name, { ...row, chains, chainSectors: chains.map(c => sector.get(c) ?? 'Annet') });
  }
  variants.push(...liveRows);
  return { provenance: { offersFile, generatedAt: live.generated_at, sha256: crypto.createHash('sha256').update(offersBytes).digest('hex'),
    baseline: 'Lagrede kategorier i input; før-Dagligvarer er det tidligere kjedesektorfilteret.' },
    live: liveRows, history: [...history.values()], combined: [...combined.values()], variants,
    historyFiles: files, unknownChains: [...new Set(variants.flatMap(r => r.chains).filter(c => !sector.has(c)))].sort() };
}

export function auditRows(rows, beforeClassifier) {
  const classified = rows.map(row => ({ ...row, ...classifyProduct(row) }));
  const pure = classified.filter(r => r.chainSectors.length && r.chainSectors.every(s => s === 'Dagligvarer'));
  const metric = (subset, key) => {
    const count = subset.filter(r => r[key] === 'Annet').length;
    return { count, total: subset.length, percent: subset.length ? +(100 * count / subset.length).toFixed(2) : null };
  };
  // Before: the actual old UI selected by chain sector, not product type.
  const beforeGrocery = classified.filter(r => r.chainSectors.includes('Dagligvarer'));
  const afterGrocery = classified.filter(r => r.department === 'Dagligvarer');
  const hits = subset => subset.filter(r => nonGroceryHits(r.name).length).map(r => ({
    name: r.name, chains: r.chains, category: r.category, source: r.source,
  }));
  return {
    total: classified.length,
    departmentGuardMovedOut: classified.filter(row => row.department !== 'Dagligvarer' &&
      classifyProduct({ ...row, chainSectors: ['Dagligvarer'] }).department === 'Dagligvarer')
      .map(row => ({ name: row.name, chains: row.chains, chainSectors: row.chainSectors, category: row.category })),
    ...(beforeClassifier ? { round2: {
      otherBefore: metric(rows.map(row => ({ ...row, ...beforeClassifier(row) })), 'category'),
      pureGroceryOtherBefore: metric(pure.map(row => ({ ...row, ...beforeClassifier(row) })), 'category'),
      departmentsBefore: Object.fromEntries(DEPARTMENTS.map(d => [d,
        rows.filter(row => beforeClassifier(row).department === d).length])),
      movedOutOfGrocery: rows.filter(row => beforeClassifier(row).department === 'Dagligvarer' &&
        classifyProduct(row).department !== 'Dagligvarer').map(row => ({ name: row.name, chains: row.chains })),
    } } : {}),
    other: { before: metric(classified, 'before_category'), after: metric(classified, 'category') },
    pureGroceryOther: { before: metric(pure, 'before_category'), after: metric(pure, 'category') },
    departments: Object.fromEntries(DEPARTMENTS.map(d => [d, classified.filter(r => r.department === d).length])),
    nonGroceryInGrocery: { before: hits(beforeGrocery), after: hits(afterGrocery) },
    otherProducts: classified.filter(r => r.category === 'Annet').map(r => ({ name: r.name, chains: r.chains })),
    pureGroceryOtherProducts: pure.filter(r => r.category === 'Annet').map(r => ({ name: r.name, chains: r.chains })),
    changes: classified.filter(r => r.category !== r.before_category).map(r => ({
      name: r.name, chains: r.chains, before: r.before_category, after: r.category, department: r.department,
    })),
  };
}

export function auditGold(rows, sampleSeed = 9148, beforeClassifier) {
  const scored = rows.map(row => ({ ...row, actual: classifyProduct(row) }));
  const categoryErrors = scored.filter(r => r.actual.category !== r.expected_category);
  const departmentErrors = scored.filter(r => r.actual.department !== r.expected_department);
  const beforeGrocery = scored.filter(r => beforeClassifier ? beforeClassifier(r).department === 'Dagligvarer' : r.chainSectors.includes('Dagligvarer'));
  const afterGrocery = scored.filter(r => r.actual.department === 'Dagligvarer');
  const precision = subset => ({ correct: subset.filter(r => r.expected_department === 'Dagligvarer').length,
    total: subset.length, percent: +(100 * subset.filter(r => r.expected_department === 'Dagligvarer').length / subset.length).toFixed(2) });
  return { total: rows.length, sampleSeed,
    categoryAccuracy: { beforeCorrect: beforeClassifier ? rows.filter(r => beforeClassifier(r).category === r.expected_category).length
        : rows.every(r => r.before_category != null) ? rows.filter(r => r.before_category === r.expected_category).length : null,
      afterCorrect: rows.length - categoryErrors.length, total: rows.length },
    departmentCorrect: rows.length - departmentErrors.length,
    departmentBeforeCorrect: beforeClassifier ? rows.filter(row => beforeClassifier(row).department === row.expected_department).length : null,
    groceryRecall: { correct: afterGrocery.filter(row => row.expected_department === 'Dagligvarer').length,
      total: scored.filter(row => row.expected_department === 'Dagligvarer').length },
    groceryPrecision: { before: precision(beforeGrocery), after: precision(afterGrocery) },
    finalOutsideCount: scored.length - afterGrocery.length,
    errors: scored.filter(r => r.actual.category !== r.expected_category || r.actual.department !== r.expected_department)
      .map(r => ({ name: r.name, expectedCategory: r.expected_category, actualCategory: r.actual.category,
        expectedDepartment: r.expected_department, actualDepartment: r.actual.department })),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const offersIndex = process.argv.indexOf('--offers');
  if (offersIndex >= 0 && !process.argv[offersIndex + 1]) throw new Error('--offers krever filsti');
  const baselineIndex = process.argv.indexOf('--baseline-classifier');
  if (baselineIndex >= 0 && !process.argv[baselineIndex + 1]) throw new Error('--baseline-classifier krever filsti');
  const beforeClassifier = baselineIndex < 0 ? undefined : (await import(pathToFileURL(path.resolve(process.argv[baselineIndex + 1])))).classifyProduct;
  const data = loadAuditData(ROOT, offersIndex >= 0 ? process.argv[offersIndex + 1] : undefined);
  const result = { provenance: data.provenance, historyFiles: data.historyFiles, unknownChains: data.unknownChains,
    sectorCoverage: { complete: data.unknownChains.length === 0,
      affectedVariants: data.variants.filter(r => r.chains.some(c => data.unknownChains.includes(c))).length },
    ...Object.fromEntries(['live', 'history', 'combined', 'variants'].map(key => [key, auditRows(data[key], beforeClassifier)])) };
  result.manualGold = auditGold(JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/categorize-gold.json'))));
  const holdoutPath = path.join(ROOT, 'test/fixtures/categorize-holdout.json');
  if (fs.existsSync(holdoutPath)) {
    const holdout = JSON.parse(fs.readFileSync(holdoutPath));
    const labelled = holdout.every(row => row.expected_department && row.expected_category);
    result.heldOut = labelled ? auditGold(holdout, 2026, beforeClassifier)
      : { evaluated: false, reason: 'Frosset utvalg er ennå ikke manuelt merket' };
    if (labelled) {
      const trainingNames = new Set(JSON.parse(fs.readFileSync(path.join(ROOT,
        'test/fixtures/categorize-adversarial.json'))).map(row => row.name));
      result.heldOut.trainingOverlap = holdout.filter(row => trainingNames.has(row.name)).map(row => row.name);
      result.heldOutNovel = auditGold(holdout.filter(row => !trainingNames.has(row.name)), 2026, beforeClassifier);
    }
  }
  const jsonIndex = process.argv.indexOf('--json');
  if (jsonIndex >= 0) {
    if (!process.argv[jsonIndex + 1]) throw new Error('--json krever filsti');
    fs.writeFileSync(process.argv[jsonIndex + 1], JSON.stringify(result, null, 2) + '\n');
  }
  for (const key of ['live', 'history', 'combined', 'variants']) {
    const r = result[key];
    console.log(`${key}: ${r.total} produkter/navnevarianter`);
    console.log(JSON.stringify({ Annet: r.other, Annet_i_rene_dagligvarekjeder: r.pureGroceryOther,
      avdelinger: r.departments, flyttet_ut_av_Dagligvarer_av_vakt: r.departmentGuardMovedOut.length,
      ...(r.round2 ? { runde2: { Annet_før: r.round2.otherBefore, Annet_rene_kjeder_før: r.round2.pureGroceryOtherBefore, flyttet_ut: r.round2.movedOutOfGrocery.length } } : {}), ikke_mat_i_Dagligvarer: {
        før: r.nonGroceryInGrocery.before.length, etter: r.nonGroceryInGrocery.after.length,
      } }, null, 2));
    console.log('Ikke-mat i Dagligvarer før:', JSON.stringify(r.nonGroceryInGrocery.before));
    console.log('Ikke-mat i Dagligvarer etter:', JSON.stringify(r.nonGroceryInGrocery.after));
  }
  console.log('Manuell fasit:', JSON.stringify(result.manualGold, null, 2));
  console.log('Held-out:', JSON.stringify(result.heldOut));
  console.log('Held-out uten adversarial-overlapp:', JSON.stringify(result.heldOutNovel));
  console.log('Sektordekning:', JSON.stringify(result.sectorCoverage));
  console.log('Ukjente kjeder (sperres fra Dagligvarer; sektordekning er delvis):', data.unknownChains.join(', '));
  console.log('Annet, samlet:', JSON.stringify(result.combined.otherProducts));
  console.log('Annet i rene dagligvarekjeder, samlet:', JSON.stringify(result.combined.pureGroceryOtherProducts));
  if (result.variants.nonGroceryInGrocery.after.length ||
      ['live', 'history', 'combined'].some(k => result[k].other.after.percent > 20 || result[k].pureGroceryOther.after.percent > 8)) {
    process.exitCode = 1;
  }
}
