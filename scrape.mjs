#!/usr/bin/env node
// Builds data/offers.json — every current Norwegian weekly offer, grouped by product.
//
// SOURCE NOTE
// The obvious candidate, kupp.vg.no, embeds its catalogue data in a `data-paper`
// HTML attribute where each offer hotspot carries a label and a bounding box but
// `price: null` — verified null on 1259/1259 offers across all 17 chains that
// publish annotations. The price exists only as pixels inside the flyer image.
// So this scrapes the Tjek/eTilbudsavis backend that mattilbud.no runs on, which
// serves the same Norwegian catalogues *with* structured pricing, pack quantity
// and pre-cropped offer images. See README.md for the full comparison.

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { categorize, extractBrand, SECTORS } from './lib/categorize.mjs';

const API = 'https://squid-api.tjek.com/v2';
const API_KEY = process.env.TJEK_API_KEY || 'QPq_vh';
const UA = 'deal-weekly-offers/1.0 (personal weekly grocery offer aggregator)';

// Catalogue discovery is geographic, so sweep the country to pick up regional
// chains that never surface in an Oslo-only query.
const CITIES = [
  ['Oslo', 59.9139, 10.7522], ['Bergen', 60.3913, 5.3221],
  ['Trondheim', 63.4305, 10.3951], ['Tromsø', 69.6492, 18.9553],
  ['Stavanger', 58.97, 5.7331], ['Kristiansand', 58.1467, 7.9956],
  ['Bodø', 67.2804, 14.4049], ['Ålesund', 62.4722, 6.1495],
  ['Lillehammer', 61.1153, 10.4662], ['Kirkenes', 69.7269, 30.0455],
];
const RADIUS = 80000;
const DELAY_MS = Number(process.env.SCRAPE_DELAY_MS ?? 120);

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(path, params = {}, tries = 4) {
  const qs = new URLSearchParams({ api_key: API_KEY, ...params });
  const url = `${API}/${path}?${qs}`;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i === tries) throw new Error(`${path}: ${err.message}`);
      await sleep(DELAY_MS * 4 * i);
    }
  }
}

const countryOf = dealer => {
  const c = dealer?.country;
  return typeof c === 'object' ? c?.id : c;
};

// Everything below comes from a third-party API and ends up inside an HTML
// attribute in the client, so it is validated here rather than trusted.

/** Accept only a plain hex colour; anything else is dropped, not escaped. */
function safeColor(value) {
  const hex = String(value ?? '').replace(/^#/, '');
  return /^[0-9a-f]{3,8}$/i.test(hex) ? `#${hex}` : null;
}

/** Accept only http(s) URLs — a javascript: href would run on click. */
function safeUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/** Lowercase, de-accent, strip punctuation — the key products are grouped on. */
function normName(s) {
  return String(s ?? '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9æøå]+/g, ' ')
    .trim();
}

async function discoverCatalogues() {
  const catalogues = new Map();
  for (const [city, lat, lng] of CITIES) {
    let offset = 0;
    for (;;) {
      const batch = await api('catalogs', {
        limit: 100, offset, r_lat: lat, r_lng: lng, r_radius: RADIUS,
      });
      if (!batch?.length) break;
      for (const c of batch) {
        if (countryOf(c.dealer) !== 'NO' || catalogues.has(c.id)) continue;
        catalogues.set(c.id, {
          id: c.id,
          dealer_id: c.dealer?.id ?? null,
          dealer: c.dealer?.name ?? c.branding?.name ?? 'Ukjent',
          color: safeColor(c.branding?.color ?? c.dealer?.color),
          logo: safeUrl(c.branding?.logo ?? c.dealer?.logo),
          run_from: c.run_from, run_till: c.run_till,
          page_count: c.page_count ?? null,
        });
      }
      offset += 100;
      if (batch.length < 100 || offset >= 400) break;
      await sleep(DELAY_MS);
    }
    console.log(`  ${city.padEnd(13)} → ${catalogues.size} catalogues known`);
    await sleep(DELAY_MS);
  }
  return [...catalogues.values()];
}

async function fetchOffers(catalogue) {
  const out = [];
  let offset = 0;
  for (;;) {
    const batch = await api('offers', { catalog_ids: catalogue.id, limit: 100, offset });
    if (!batch?.length) break;
    out.push(...batch);
    offset += 100;
    if (batch.length < 100) break;
    await sleep(DELAY_MS);
  }
  return out;
}

/**
 * Converts pack quantity into a comparable unit price (kr/kg or kr/l).
 * `si.factor` maps the pack unit to its SI base, so 4 x 100 g at 69.90
 * becomes 69.90 / (4 * 100 * 0.001) = 174.75 kr/kg — matching the printed
 * "pr. kg 174,75". Returns null when the pack size is unknown or dimensionless.
 */
function unitPrice(price, quantity) {
  const from = quantity?.size?.from;
  const to = quantity?.size?.to ?? from;
  const factor = quantity?.unit?.si?.factor;
  const symbol = quantity?.unit?.si?.symbol;
  if (!price || !from || !factor || !symbol) return null;
  if (!['kg', 'l'].includes(symbol)) return null;

  const piecesFrom = quantity?.pieces?.from || 1;
  const piecesTo = quantity?.pieces?.to || piecesFrom;

  const round = v => Math.round(v * 100) / 100;
  const at = (size, pieces) => {
    const total = size * pieces * factor;
    if (!total || total <= 0) return null;
    const value = price / total;
    return Number.isFinite(value) && value <= 100000 ? round(value) : null;
  };

  // A pack sold as "100–250 g" has no single kr/kg. Taking size.from alone
  // reported 249 kr/kg for a bag whose own label prints "99,60–249,00" — 2.5x
  // the real floor. Ranges are carried as ranges and marked inexact, so they
  // are shown honestly and kept out of cross-chain "cheapest per kilo" maths.
  const high = at(from, piecesFrom);     // smallest pack -> dearest per kilo
  const low = at(to, piecesTo);          // largest pack  -> cheapest per kilo
  if (low == null || high == null) return null;

  return low === high
    ? { value: low, symbol, exact: true }
    : { value: low, max: high, symbol, exact: false };
}

/** "4 x 100 g" / "1,5 l" / "100–250 g" / "6 stk" — pack size for the card. */
function sizeText(quantity) {
  const from = quantity?.size?.from;
  const to = quantity?.size?.to ?? from;
  const symbol = quantity?.unit?.symbol;
  if (!from || !symbol) return null;
  const pieces = quantity?.pieces?.from || 1;

  // 'pcs' is the API's dimensionless unit. "1 pcs" says nothing, so drop it
  // entirely rather than printing a size that carries no information.
  if (symbol === 'pcs') {
    const total = from * pieces;
    return total > 1 ? `${total} stk` : null;
  }

  const num = v => Number.isInteger(v) ? String(v) : String(v).replace('.', ',');
  // Show the real span rather than silently printing only the lower bound.
  const size = to !== from ? `${num(from)}–${num(to)}` : num(from);
  return pieces > 1 ? `${pieces} x ${size} ${symbol}` : `${size} ${symbol}`;
}

function buildProducts(offers) {
  const groups = new Map();
  for (const o of offers) {
    const key = normName(o.heading);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  }

  const products = [];
  for (const [key, allItems] of groups) {
    // A chain publishes one catalogue per region, so the identical offer comes
    // back several times. Collapse them: three REMA rows at the same price for
    // the same pack is one fact, not three.
    const byIdentity = new Map();
    for (const item of allItems) {
      const identity = `${item.chain}|${item.price}|${item.size_text ?? ''}`;
      const kept = byIdentity.get(identity);
      // Prefer the copy that carries an image so the card is never blank.
      if (!kept || (!kept.image && item.image)) byIdentity.set(identity, item);
    }
    const items = [...byIdentity.values()];
    // Display the most frequent spelling; fall back to the alphabetically first
    // so the name is stable between runs rather than dependent on fetch order.
    const freq = new Map();
    for (const i of items) freq.set(i.heading, (freq.get(i.heading) ?? 0) + 1);
    const name = [...freq.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'nb'))[0][0];

    // Classify on the name first and treat descriptions only as a fallback:
    // pooling every variant's marketing copy lets one incidental phrase hijack
    // the group ("rik på omega-3" once turned tinned mackerel into medicine).
    const descriptions = items.map(i => i.description ?? '').filter(Boolean).join(' ');
    const prices = items.map(i => i.price).filter(p => p != null);
    const exactUnits = items.map(i => i.unit_price).filter(u => u?.exact);
    const chains = [...new Set(items.map(i => i.chain))];

    // A "brand" that just repeats the product name tells the reader nothing.
    const brandRaw = extractBrand(name) ?? extractBrand(items[0]?.description ?? '') ?? null;
    const brand = brandRaw && normName(brandRaw) !== normName(name) ? brandRaw : null;

    products.push({
      id: key.replace(/ /g, '-').slice(0, 64),
      name,
      category: categorize(name, descriptions),
      brand,
      chain_count: chains.length,
      chains,
      offer_count: items.length,
      min_price: prices.length ? Math.min(...prices) : null,
      max_price: prices.length ? Math.max(...prices) : null,
      // Only meaningful when every offer shares one SI unit, otherwise we would
      // be comparing kr/kg against kr/l and calling it a saving. Inexact
      // (ranged) unit prices are excluded so the headline figure is a fact.
      best_unit: exactUnits.length && new Set(exactUnits.map(u => u.symbol)).size === 1
        ? { value: Math.min(...exactUnits.map(u => u.value)), symbol: exactUnits[0].symbol }
        : null,
      offers: items
        .map(({ chain, ...rest }) => ({ chain, ...rest }))
        .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity)),
    });
  }

  products.sort((a, b) =>
    b.chain_count - a.chain_count || a.name.localeCompare(b.name, 'nb'));
  return products;
}

async function main() {
  console.log('Discovering Norwegian catalogues…');
  const catalogues = await discoverCatalogues();
  console.log(`\n${catalogues.length} catalogues across ` +
    `${new Set(catalogues.map(c => c.dealer)).size} chains\n`);

  console.log('Fetching offers…');
  const chains = new Map();
  const rows = [];
  const seen = new Set();
  const failed = [];

  for (const [i, cat] of catalogues.entries()) {
    let offers;
    try {
      offers = await fetchOffers(cat);
    } catch (err) {
      // Never let a dropped catalogue masquerade as "this chain had no offers".
      console.warn(`  ! ${cat.dealer} (${cat.id}): ${err.message}`);
      failed.push({ catalogue: cat.id, dealer: cat.dealer, error: err.message });
      continue;
    }

    const slug = normName(cat.dealer).replace(/ /g, '-') || cat.dealer_id;
    if (!chains.has(slug)) {
      chains.set(slug, {
        slug, name: cat.dealer, id: cat.dealer_id,
        color: cat.color,
        logo: cat.logo, sector: SECTORS[cat.dealer] ?? 'Annet',
        catalogues: 0, offer_count: 0,
      });
    }
    const chain = chains.get(slug);
    chain.catalogues++;

    for (const o of offers) {
      if (seen.has(o.id)) continue;       // same catalogue reachable from many cities
      seen.add(o.id);
      const price = o.pricing?.price ?? null;
      const pre = o.pricing?.pre_price ?? null;
      rows.push({
        id: o.id,
        chain: slug,
        heading: o.heading,
        description: (o.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 300) || null,
        price,
        pre_price: pre != null && price != null && pre > price ? pre : null,
        discount_pct: pre != null && price != null && pre > price
          ? Math.round((1 - price / pre) * 100) : null,
        unit_price: unitPrice(price, o.quantity),
        size_text: sizeText(o.quantity),
        // Only the 300px crop is kept: the transform URL is signed, so a larger
        // width cannot be derived from it, and the UI never shows one.
        image: safeUrl(o.images?.thumb),
        page: o.catalog_page ?? null,
        catalogue_url: safeUrl(o.catalog_url),
        valid_from: o.run_from ?? cat.run_from,
        valid_to: o.run_till ?? cat.run_till,
      });
      chain.offer_count++;
    }

    if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${catalogues.length} → ${rows.length} offers`);
    await sleep(DELAY_MS);
  }

  const products = buildProducts(rows);
  // Every statistic below is computed from the offers that actually survive
  // into the database, not from the raw fetch. Reporting the pre-dedup count
  // would make the header disagree with the grid the reader is looking at.
  const kept = products.flatMap(p => p.offers);
  // buildProducts skips offers whose heading normalises to nothing; counted
  // here so they are reported rather than folded into the dedup figure.
  const droppedNoHeading = rows.filter(r => !normName(r.heading)).length;

  // Per-chain totals were accumulated during the fetch, so restate them from
  // the deduplicated set for the same reason.
  for (const chain of chains.values()) chain.offer_count = 0;
  for (const offer of kept) {
    const chain = chains.get(offer.chain);
    if (chain) chain.offer_count++;
  }

  const now = new Date();
  const live = kept.filter(r => r.valid_to && new Date(r.valid_to) >= now);
  const weekOut = new Date(now.getTime() + 7 * 86400000);
  const expiringSoon = live.filter(r => new Date(r.valid_to) <= weekOut);

  const catCount = new Map();
  for (const p of products) catCount.set(p.category, (catCount.get(p.category) ?? 0) + 1);

  const payload = {
    generated_at: now.toISOString(),
    source: 'squid-api.tjek.com (eTilbudsavis / mattilbud.no)',
    currency: 'NOK',
    // The full span across every catalogue, which runs months wide because a
    // few chains publish long-running papers. It is NOT "this week" — the UI
    // reports live/expiring counts instead of presenting this as a week.
    valid_from: kept.map(r => r.valid_from).filter(Boolean).sort()[0] ?? null,
    valid_to: kept.map(r => r.valid_to).filter(Boolean).sort().at(-1) ?? null,
    stats: {
      // Chains whose catalogue carried no offers are not 'covered', so they
      // are excluded here to match what the Butikk facet actually lists.
      chains: [...chains.values()].filter(c => c.offer_count > 0).length,
      catalogues: catalogues.length,
      offers: kept.length,
      offers_fetched: rows.length,
      // Split so a dropped record never hides inside the dedup number.
      dropped_no_heading: droppedNoHeading,
      duplicates_collapsed: rows.length - droppedNoHeading - kept.length,
      offers_live: live.length,
      offers_expiring_7d: expiringSoon.length,
      products: products.length,
      multi_chain_products: products.filter(p => p.chain_count > 1).length,
      offers_with_price: kept.filter(r => r.price != null).length,
      offers_with_pre_price: kept.filter(r => r.pre_price != null).length,
      offers_with_unit_price: kept.filter(r => r.unit_price?.exact).length,
      offers_with_unit_price_range: kept.filter(r => r.unit_price && !r.unit_price.exact).length,
      uncategorised: products.filter(p => p.category === 'Annet').length,
      failed_catalogues: failed.length,
    },
    failed_catalogues: failed,
    categories: [...catCount.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    chains: [...chains.values()].sort((a, b) =>
      b.offer_count - a.offer_count || a.name.localeCompare(b.name, 'nb')),
    products,
  };

  await mkdir('data', { recursive: true });
  await writeFile('data/offers.json', JSON.stringify(payload));

  // Weekly archive so week-on-week price history accumulates.
  const week = isoWeek(now);
  await mkdir('data/history', { recursive: true });
  const file = `${now.getUTCFullYear()}-w${String(week).padStart(2, '0')}.json`;
  await writeFile(`data/history/${file}`, JSON.stringify({
    generated_at: payload.generated_at, week, stats: payload.stats,
    products: products.map(p => ({
      name: p.name, category: p.category, min_price: p.min_price,
      chains: p.chains, best_unit: p.best_unit,
    })),
  }));
  const idxPath = 'data/history/index.json';
  const idx = existsSync(idxPath) ? JSON.parse(await readFile(idxPath, 'utf8')) : [];
  const year = now.getUTCFullYear();
  // Key the replacement on week+year rather than on the filename: a rename of
  // the file convention would otherwise leave a second, stale row for the same
  // week that never gets superseded.
  const merged = [...idx.filter(e => !(e.week === week && e.year === year)),
    { week, year, file, offers: kept.length, generated_at: payload.generated_at }]
    .sort((a, b) => b.year - a.year || b.week - a.week);
  await writeFile(idxPath, JSON.stringify(merged, null, 1));

  const s = payload.stats;
  console.log(`\n${'='.repeat(64)}`);
  console.log(`chains ${s.chains} | catalogues ${s.catalogues} | offers ${s.offers} (${s.offers_live} live)`);
  console.log(`products ${s.products} | in 2+ chains ${s.multi_chain_products}`);
  console.log(`prices ${s.offers_with_price}/${s.offers} | before-price ${s.offers_with_pre_price} | kr/kg ${s.offers_with_unit_price}`);
  console.log(`uncategorised products ${s.uncategorised} (${(100 * s.uncategorised / s.products).toFixed(1)}%)`);
  if (failed.length) console.log(`FAILED catalogues: ${failed.length}`);
  console.log(`wrote data/offers.json`);
}

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
}

main().catch(err => { console.error(err); process.exit(1); });
