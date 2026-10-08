import { comparablePrice, hasDocumentedAdvantage } from './lib/deals.mjs';
import { dealView, dealSize, dealDescription } from './lib/ui-deal.mjs';
import { matchingOffers } from './lib/ui-filter.mjs';
import { nearbyStores, distanceText } from './lib/ui-geo.mjs';
import * as shopping from './lib/ui-list.mjs';

// Ukens tilbud — client-side browser over data/offers.json.
// The whole dataset is loaded once and filtered in memory; cards render
// progressively because the full set is several thousand products.

const $ = sel => document.querySelector(sel);
const PAGE_SIZE = 60;

const state = {
  data: null,
  products: [],
  haystack: [],       // parallel to data.products — prebuilt lowercase search text
  filtered: [],
  rendered: 0,
  query: '',
  categories: new Set(),
  chains: new Set(),
  departments: new Set(),
  stores: new Set(),
  storeData: null,
  position: null,
  onlyDiscount: false,
  onlyMultiChain: false,
  hideExpired: true,
  sort: 'relevance',
  list: new Map(),    // offer id -> { product, chain, price, name }
};

const nf = new Intl.NumberFormat('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('nb-NO');
const df = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short' });

const kr = v => v == null ? '–' : nf.format(v).replace(',00', ',–');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** "99,50 kr/kg", or "99,60–249,– kr/kg" when the pack size is a range. */
const unitText = u => u.exact === false && u.max != null
  ? `${kr(u.value)}–${kr(u.max)} kr/${esc(u.symbol)}`
  : `${kr(u.value)} kr/${esc(u.symbol)}`;

/**
 * The API returns offsets as "+0000" (no colon), which is outside the date
 * format ES guarantees engines will parse. V8 accepts it; not every engine
 * does, and a silent Invalid Date would make "hide expired" drop every offer
 * and blank the page. Normalising costs nothing and removes the whole class.
 */
const parseDate = s => new Date(String(s ?? '').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
const isLive = o => !o.valid_to || parseDate(o.valid_to) >= new Date();

/* ---------------- persistence ---------------- */

const STORE_KEY = 'ukens-tilbud:v1';

function loadPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    if (raw.theme) document.documentElement.dataset.theme = raw.theme;
    if (Array.isArray(raw.chains)) state.chains = new Set(raw.chains);
    if (Array.isArray(raw.list)) state.list = shopping.migrateList(raw.list);
    if (Array.isArray(raw.stores)) state.stores = new Set(raw.stores);
    if (typeof raw.hideExpired === 'boolean') state.hideExpired = raw.hideExpired;
  } catch { /* first visit, or corrupted storage — defaults are fine */ }
}

function savePrefs() {
  localStorage.setItem(STORE_KEY, JSON.stringify({
    theme: document.documentElement.dataset.theme,
    chains: [...state.chains],
    stores: [...state.stores],
    list: [...state.list],
    hideExpired: state.hideExpired,
  }));
}

/* ---------------- data helpers ---------------- */

const chainName = slug => state.data.chains.find(c => c.slug === slug)?.name ?? slug;
const chainColor = slug => state.data.chains.find(c => c.slug === slug)?.color ?? null;

/** Best (lowest) live price across a product's offers, plus its discount. */
function headline(product) {
  const offers = visibleOffers(product);
  if (!offers.length) return null;
  return offers.reduce((best, o) =>
    (comparablePrice(o) ?? Infinity) < (comparablePrice(best) ?? Infinity) ? o : best, offers[0]);
}

function visibleOffers(product) {
  // Unknown saved stores stay restrictive until their catalogue data is loaded.
  const storeCatalogues = [...state.stores].map(id => state.storeData?.stores.find(s => s.id === id)
    ?? { chain: null, catalogues: [] });
  return matchingOffers(product, { chains: state.chains, storeCatalogues, hideExpired: state.hideExpired });
}

// "3 for 2" has no discount_pct from the scraper (the API never discounts
// `price` for it) — derive an equivalent percentage from the multibuy's
// effective price so it sorts and filters alongside a normal markdown.
const offerDiscountPct = o => o.discount_pct
  ?? (o.multibuy ? Math.round((1 - o.multibuy.effective_price / o.multibuy.unit_price) * 100) : 0);

const maxDiscount = p =>
  Math.max(0, ...visibleOffers(p).map(offerDiscountPct));

// Only offers the user can see count: a deal at an unselected chain or store
// must not lift the product above ones that are discounted where they shop.
const hasAdvantage = p => visibleOffers(p).some(hasDocumentedAdvantage);

/* ---------------- filtering ---------------- */

function applyFilters() {
  const q = state.query.trim().toLowerCase();
  const terms = q ? q.split(/\s+/).filter(Boolean) : [];

  const out = [];
  for (let i = 0; i < state.products.length; i++) {
    const p = state.products[i];

    if (state.categories.size && !state.categories.has(p.category)) continue;
    if (state.departments.size && !state.departments.has(p.department)) continue;
    if (!visibleOffers(p).length) continue;
    if (state.onlyMultiChain && p.chain_count < 2) continue;
    if (state.onlyDiscount && maxDiscount(p) <= 0) continue;
    if (state.hideExpired && !p.offers.some(isLive)) continue;

    let score = 0;
    if (terms.length) {
      const hay = state.haystack[i];
      let ok = true;
      for (const t of terms) {
        const at = hay.indexOf(t);
        if (at === -1) { ok = false; break; }
        // Prefix matches on the product name rank above matches buried in a
        // description, so "kaffe" surfaces coffee before coffee-flavoured cake.
        score += at === 0 ? 100 : 20 - Math.min(19, at / 10);
      }
      if (!ok) continue;
    }
    out.push({ p, score });
  }

  const dir = {
    'price-asc': (a, b) => (comparablePrice(headline(a.p)) ?? Infinity) - (comparablePrice(headline(b.p)) ?? Infinity),
    'price-desc': (a, b) => (comparablePrice(headline(b.p)) ?? -Infinity) - (comparablePrice(headline(a.p)) ?? -Infinity),
    'discount': (a, b) => maxDiscount(b.p) - maxDiscount(a.p),
    'unit': (a, b) => (headline(a.p)?.unit_price?.value ?? Infinity) - (headline(b.p)?.unit_price?.value ?? Infinity),
    'chains': (a, b) => b.p.chain_count - a.p.chain_count || maxDiscount(b.p) - maxDiscount(a.p),
    'name': (a, b) => a.p.name.localeCompare(b.p.name, 'nb'),
    // Without a search every score is 0, so documented deals lead and offers
    // without a known advantage follow; a text match still outranks a deal.
    'relevance': (a, b) => b.score - a.score
      || hasAdvantage(b.p) - hasAdvantage(a.p)
      || b.p.chain_count - a.p.chain_count
      || maxDiscount(b.p) - maxDiscount(a.p),
  }[state.sort];

  out.sort(dir);
  state.filtered = out.map(o => o.p);
  state.rendered = 0;
  $('#grid').innerHTML = '';
  renderMore();
  renderCount();
  renderChips();
  renderFacets();
  renderStoreNotice();
}

/* ---------------- rendering ---------------- */

function cardHTML(p) {
  const best = headline(p);
  const disc = maxDiscount(p);
  const img = best?.image;
  const deal = dealView(best || {});
  // The kr/kg must belong to the offer whose price is on the card. Using the
  // product-wide best_unit paired "10 kr" (a 100 g jar) with "99,50 kr/kg"
  // (a 200 g jar at another chain) — two true numbers making a false claim.
  const unit = best?.unit_price;
  const matchingChains = [...new Set(visibleOffers(p).map(o => o.chain))];
  const chains = matchingChains.slice(0, 2);
  const extra = matchingChains.length - chains.length;
  const inList = !!best && state.list.has(best.id);

  return `
    <article class="card" data-id="${esc(p.id)}">
      <div class="card-media">
        ${img
          ? `<img src="${esc(img)}" alt="${esc(p.name)}" loading="lazy" decoding="async">`
          : `<div class="placeholder">Uten bilde</div>`}
        ${deal.badgeText ? `<span class="badge-deal num">${esc(deal.badgeText)}</span>` : disc > 0 ? `<span class="badge-save num">−${disc}%</span>` : ''}
        ${p.chain_count > 1 ? `<span class="badge-chains num">${p.chain_count} butikker</span>` : ''}
      </div>
      <div class="card-body">
        <div class="card-cat">${esc(p.category)}</div>
        <button class="card-name" data-detail="${esc(p.id)}" aria-label="Vis tilbud for ${esc(p.name)}">${esc(p.name)}</button>
        <div class="card-price">
          <span class="price num">${deal.priceHtml}</span>
          ${best?.pre_price ? `<span class="price-was num">${kr(best.pre_price)}</span>` : ''}
        </div>
        ${deal.perItemText ? `<div class="card-deal num">${esc(deal.perItemText)}</div>` : ''}
        ${unit ? `<div class="card-unit num">${unitText(unit)}</div>`
               : dealSize(best || {}) ? `<div class="card-unit">${esc(dealSize(best))}</div>` : ''}
        <div class="card-foot">
          ${chains.map(c => `<span class="store-tag"><i class="dot" style="background:${esc(chainColor(c) || 'var(--line-strong)')}"></i>${esc(chainName(c))}</span>`).join('')}
          ${extra > 0 ? `<span class="store-tag">+${extra}</span>` : ''}
          <button class="add-btn" data-add="${esc(p.id)}" data-in="${inList ? 1 : 0}"
            aria-label="${inList ? 'Fjern fra' : 'Legg i'} handleliste">${inList ? '✓' : '+'}</button>
        </div>
      </div>
    </article>`;
}

function isInView(el, margin = 600) {
  const rect = el.getBoundingClientRect();
  return rect.top <= (window.innerHeight || 0) + margin;
}

function renderMore() {
  const slice = state.filtered.slice(state.rendered, state.rendered + PAGE_SIZE);
  if (!slice.length) {
    if (!state.filtered.length) {
      $('#grid').innerHTML = `<div class="empty" style="grid-column:1/-1">
        <h3>Ingen treff</h3><p>Prøv et annet søk eller fjern noen filtre.</p></div>`;
    }
    return;
  }
  $('#grid').insertAdjacentHTML('beforeend', slice.map(cardHTML).join(''));
  state.rendered += slice.length;
}

function renderCount() {
  const n = state.filtered.length;
  const offers = state.filtered.reduce((s, p) => s + visibleOffers(p).length, 0);
  $('#results-count').innerHTML =
    `<b class="num">${nf0.format(n)}</b> produkter · <span class="num">${nf0.format(offers)}</span> tilbud`;
}

function renderChips() {
  const chips = [];
  for (const c of state.categories) chips.push(['cat', c, c]);
  for (const c of state.chains) chips.push(['chain', c, chainName(c)]);
  for (const s of state.departments) chips.push(['department', s, s]);
  for (const id of state.stores) chips.push(['store', id, `📍 ${state.storeData?.stores.find(s => s.id === id)?.name || 'Valgt butikk'}`]);
  if (state.onlyDiscount) chips.push(['flag', 'discount', 'Kun nedsatt']);
  if (state.onlyMultiChain) chips.push(['flag', 'multi', 'Flere butikker']);
  $('#active-chips').innerHTML = chips.map(([kind, val, label]) =>
    `<span class="chip">${esc(label)}<button data-chip="${kind}" data-val="${esc(val)}" aria-label="Fjern ${esc(label)}">✕</button></span>`
  ).join('');
}

function facetCounts(key) {
  // Counts reflect the current result set so the sidebar shows what is
  // reachable from here, not the size of the whole catalogue.
  const counts = new Map();
  for (const p of state.filtered) {
    if (key === 'category') counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
    else if (key === 'chain') for (const c of new Set(p.chains)) counts.set(c, (counts.get(c) ?? 0) + 1);
    else if (key === 'department' && p.department) counts.set(p.department, (counts.get(p.department) ?? 0) + 1);
  }
  return counts;
}

function renderFacets() {
  const catCounts = facetCounts('category');
  const chainCounts = facetCounts('chain');
  const depCounts = facetCounts('department');

  const cats = state.data.categories
    .map(c => c.name)
    .filter(n => catCounts.has(n) || state.categories.has(n))
    .sort((a, b) => (catCounts.get(b) ?? 0) - (catCounts.get(a) ?? 0));

  const departments = state.products.some(p => p.department)
    ? (state.data.departments?.map(d => d.name) ?? [...new Set(state.products.map(p => p.department).filter(Boolean))])
    : [];

  const chains = state.data.chains
    .filter(c => chainCounts.has(c.slug) || state.chains.has(c.slug))
    .sort((a, b) => (chainCounts.get(b.slug) ?? 0) - (chainCounts.get(a.slug) ?? 0));

  $('#facets').innerHTML = `
    <button class="icon-btn stores-facet" data-open-stores>📍 Butikker nær meg</button>
    <div class="facet">
      <h3>Vis</h3>
      <label class="switch"><input type="checkbox" id="f-discount" ${state.onlyDiscount ? 'checked' : ''}> Kun nedsatt pris</label>
      <label class="switch"><input type="checkbox" id="f-multi" ${state.onlyMultiChain ? 'checked' : ''}> Finnes i flere butikker</label>
      <label class="switch"><input type="checkbox" id="f-expired" ${state.hideExpired ? 'checked' : ''}> Skjul utgåtte</label>
    </div>

    ${departments.length ? `<div class="facet">
      <h3>Avdeling</h3>
      <div class="facet-list">
        ${departments.map(d => `
          <button class="facet-item" data-department="${esc(d)}" aria-pressed="${state.departments.has(d)}">
            ${esc(d)}<span class="n num">${nf0.format(depCounts.get(d) ?? 0)}</span>
          </button>`).join('')}
      </div>
    </div>` : ''}

    <div class="facet">
      <h3>Kategori</h3>
      <div class="facet-list">
        ${cats.map(c => `
          <button class="facet-item" data-cat="${esc(c)}" aria-pressed="${state.categories.has(c)}">
            ${esc(c)}<span class="n num">${nf0.format(catCounts.get(c) ?? 0)}</span>
          </button>`).join('')}
      </div>
    </div>

    <div class="facet">
      <h3>Butikk</h3>
      <div class="facet-list">
        ${chains.map(c => `
          <button class="facet-item" data-chain="${esc(c.slug)}" aria-pressed="${state.chains.has(c.slug)}">
            <i class="dot" style="background:${esc(c.color || 'var(--line-strong)')}"></i>
            ${esc(c.name)}<span class="n num">${nf0.format(chainCounts.get(c.slug) ?? 0)}</span>
          </button>`).join('')}
      </div>
    </div>`;
}

function renderStrip() {
  const s = state.data.stats;
  const updated = parseDate(state.data.generated_at);
  // Deliberately no overall date range: catalogues run anywhere from days to
  // months, so a min–max span reads as "this week" while meaning nothing.
  $('#strip').innerHTML = `
    <span><b class="num">${nf0.format(s.offers_live ?? s.offers)}</b> tilbud gyldige nå</span>
    <span><b class="num">${nf0.format(s.products)}</b> produkter</span>
    <span><b class="num">${s.chains}</b> kjeder</span>
    <span><b class="num">${nf0.format(s.multi_chain_products)}</b> i flere butikker</span>
    ${s.offers_expiring_7d != null
      ? `<span><b class="num">${nf0.format(s.offers_expiring_7d)}</b> utløper innen 7 dager</span>` : ''}
    <span>Oppdatert <b>${df.format(updated)}</b></span>`;
}

/* ---------------- product detail ---------------- */

function openDetail(id) {
  const p = state.products.find(x => x.id === id);
  if (!p) return;
  const offers = [...visibleOffers(p)].sort((a, b) => (comparablePrice(a) ?? Infinity) - (comparablePrice(b) ?? Infinity));
  // Flag only the single cheapest row. On a price tie every row would otherwise
  // claim to be the cheapest, which reads as a bug rather than as a tie.
  const cheapestId = p.chain_count > 1 ? offers[0]?.id : null;

  $('#d-name').textContent = p.name;
  $('#d-sub').innerHTML = [
    esc(p.category),
    p.brand ? esc(p.brand) : null,
    `${p.chain_count} ${p.chain_count === 1 ? 'butikk' : 'butikker'}`,
    headline(p)?.unit_price ? `fra <span class="num">${unitText(headline(p).unit_price)}</span>` : null,
  ].filter(Boolean).join(' · ');

  $('#d-body').innerHTML = offers.map(o => {
    const expired = o.valid_to && !isLive(o);
    const deal = dealView(o);
    return `
      <div class="offer-row">
        ${o.image ? `<img src="${esc(o.image)}" alt="" loading="lazy">`
                  : `<div style="width:66px;height:56px"></div>`}
        <div>
          <div class="offer-chain">
            <i class="dot" style="background:${esc(chainColor(o.chain) || 'var(--line-strong)')}"></i>
            ${esc(chainName(o.chain))}
            ${o.id === cheapestId ? '<span class="cheapest-flag">Billigst</span>' : ''}
          </div>
          <div class="offer-desc">
            ${esc(dealDescription(o))}
            ${dealSize(o) ? ` · ${esc(dealSize(o))}` : ''}
            ${o.valid_to ? ` · ${expired ? 'utgått' : 'til ' + df.format(parseDate(o.valid_to))}` : ''}
            ${o.catalogue_url ? ` · <a href="${esc(o.catalogue_url)}" target="_blank" rel="noopener">kundeavis s. ${o.page ?? '?'}</a>` : ''}
          </div>
        </div>
        <div class="offer-price">
          <div class="price num">${deal.priceHtml}</div>
          ${o.pre_price ? `<div class="price-was num">${kr(o.pre_price)}</div>` : ''}
          ${o.unit_price ? `<div class="card-unit num">${unitText(o.unit_price)}</div>` : ''}
          ${o.multibuy ? `<div class="card-deal">${esc(deal.badgeText)}</div>` : ''}
          ${deal.perItemText ? `<div class="card-deal num">${esc(deal.perItemText)}</div>` : ''}
          <button class="add-btn" style="margin-top:5px" data-add-offer="${esc(o.id)}"
            aria-label="${state.list.has(o.id) ? 'Fjern fra' : 'Legg i'} handleliste" data-in="${state.list.has(o.id) ? 1 : 0}">${state.list.has(o.id) ? '✓' : '+'}</button>
        </div>
      </div>`;
  }).join('');

  $('#detail').showModal();
}

/* ---------------- shopping list ---------------- */

function toggleOffer(offerId) {
  if (state.list.has(offerId)) state.list.delete(offerId);
  else {
    for (const p of state.products) {
      const o = p.offers.find(x => x.id === offerId);
      if (o) { shopping.addOffer(state.list, p, o); break; }
    }
  }
  savePrefs();
  syncListUI();
}

/** The card's + button adds that product's cheapest offer. */
function addCheapest(productId) {
  const p = state.products.find(x => x.id === productId);
  if (!p) return;
  const existing = visibleOffers(p).find(o => o.id === headline(p)?.id && state.list.has(o.id));
  if (existing) { state.list.delete(existing.id); savePrefs(); syncListUI(); return; }
  const best = headline(p);
  if (best) toggleOffer(best.id);
}

function syncListUI() {
  $('#list-count').textContent = [...state.list.values()].filter(i => !i.checked).length;
  for (const btn of document.querySelectorAll('[data-add]')) {
    const p = state.products.find(x => x.id === btn.dataset.add);
    const inList = p && state.list.has(headline(p)?.id);
    btn.dataset.in = inList ? 1 : 0;
    btn.textContent = inList ? '✓' : '+';
    btn.setAttribute('aria-label', `${inList ? 'Fjern fra' : 'Legg i'} handleliste`);
  }
  for (const btn of document.querySelectorAll('[data-add-offer]')) {
    const inList = state.list.has(btn.dataset.addOffer);
    btn.dataset.in = inList ? 1 : 0;
    btn.textContent = inList ? '✓' : '+';
    btn.setAttribute('aria-label', `${inList ? 'Fjern fra' : 'Legg i'} handleliste`);
  }
}

function renderList() {
  const byChain = new Map();
  for (const [id, item] of state.list) {
    const group = item.custom ? 'custom' : item.chain;
    if (!byChain.has(group)) byChain.set(group, []);
    byChain.get(group).push({ id, ...item });
  }
  const count = [...state.list.values()].filter(i => !i.checked).length;
  $('#l-sub').innerHTML = `${count} ${count === 1 ? 'vare' : 'varer'} igjen · totalt <span class="num">${kr(shopping.total(state.list))} kr</span>`;
  $('#l-body').innerHTML = state.list.size ? [...byChain.entries()]
    .sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'nb'))
    .map(([chain, items]) => `
      <div class="list-group">
        <h4>${chain === 'custom' ? 'Egne varer' : `<i class="dot" style="background:${esc(chainColor(chain) || 'var(--line-strong)')}"></i>${esc(chainName(chain))}`}
          ${chain !== 'custom' ? `<span class="sum num">${kr(shopping.total(new Map(items.map(i => [i.id, i]))))} kr</span>` : ''}</h4>
        ${items.sort((a, b) => a.checked - b.checked).map(i => `
          <div class="list-item ${i.checked ? 'checked' : ''}">
            <input type="checkbox" data-check="${esc(i.id)}" ${i.checked ? 'checked' : ''} aria-label="Kryss av ${esc(i.name)}">
            <div class="list-description"><span class="list-name">${esc(i.name)}${i.size ? ` <span class="list-size">${esc(i.size)}</span>` : ''}</span>
              ${i.valid_to && !isLive(i) ? '<span class="expired-label">utgått</span>' : ''}
              ${!i.custom ? `<div class="card-unit num">${esc(i.deal || dealView(i).listText)}</div>` : ''}</div>
            <button class="rm" data-rm="${esc(i.id)}" aria-label="Fjern ${esc(i.name)}">✕</button>
          </div>`).join('')}
      </div>`).join('') : `<div class="empty"><h3>Handlelisten er tom</h3><p>Trykk <b>+</b> på et tilbud, eller legg til en egen vare.</p></div>`;
  $('#clear-checked').disabled = ![...state.list.values()].some(i => i.checked);
  $('#clear-list').disabled = !state.list.size;
}

function openList() {
  renderList();
  if (!$('#listdlg').open) $('#listdlg').showModal();
  $('#custom-item').focus();
}

function listAsText() { return shopping.toText(state.list, chainName); }

/* ---------------- nearby stores ---------------- */

let storesRequest = null;
let leafletRequest = null;
let storeMap = null;
let storeMarkers = null;
let positionMarker = null;

async function loadStores() {
  if (state.storeData) return state.storeData;
  if (!storesRequest) storesRequest = (async () => {
    const res = await fetch('data/stores.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.stores)) throw new Error('Ugyldige butikkdata');
    state.storeData = data;
    return data;
  })().catch(err => { storesRequest = null; throw err; });
  return storesRequest;
}

function loadLeaflet() {
  if (window.L && storeMap) return Promise.resolve(window.L);
  if (!leafletRequest) {
    // Hashes verified against these exact 1.9.4 assets from unpkg.
    const asset = (tag, url, integrity) => new Promise((resolve, reject) => {
      const el = document.createElement(tag);
      if (tag === 'link') { el.rel = 'stylesheet'; el.href = url; }
      else el.src = url;
      el.integrity = integrity;
      el.crossOrigin = 'anonymous';
      const timer = setTimeout(() => { el.remove(); reject(new Error('Tidsavbrudd')); }, 10000);
      el.onload = () => { clearTimeout(timer); resolve(); };
      el.onerror = () => { clearTimeout(timer); el.remove(); reject(new Error('Lasting feilet')); };
      document.head.append(el);
    });
    leafletRequest = Promise.all([
      asset('link', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY='),
      asset('script', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo='),
    ]).then(() => window.L).catch(err => { leafletRequest = null; throw err; });
  }
  return leafletRequest;
}

async function openStores() {
  if (!$('#storedlg').open) $('#storedlg').showModal();
  $('#store-search').focus();
  $('#stores-status').textContent = 'Laster butikker …';
  $('#map-status').textContent = '';
  const mapLoading = loadLeaflet().then(() => {
    if (!storeMap) {
      storeMap = window.L.map('store-map', { preferCanvas: true }).setView([64.5, 12], 4);
      window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(storeMap);
      storeMarkers = window.L.layerGroup().addTo(storeMap);
    }
    $('#store-map').hidden = false;
    storeMap.invalidateSize();
    renderStores();
    if (state.position) storeMap.setView([state.position.lat, state.position.lng], 12);
  }).catch(() => {
    $('#store-map').hidden = true;
    $('#map-status').textContent = 'Kartet kunne ikke lastes. Du kan velge butikker i listen.';
  });
  try {
    await loadStores();
    $('#stores-status').textContent = state.storeData.complete === false
      ? 'Noen butikker mangler i oversikten fordi butikkdata ikke kunne hentes.' : '';
    renderStores();
    applyFilters();
  } catch {
    $('#stores-status').innerHTML = 'Kunne ikke laste butikkene. <button class="icon-btn" data-open-stores>Prøv igjen</button>';
  }
  await mapLoading;
}

function renderStoreNotice() {
  const notice = $('#store-notice');
  const unknown = [...state.stores].some(id => !state.storeData?.stores.some(s => s.id === id));
  const legacy = state.stores.size && state.products.some(p => p.offers.some(o => !Array.isArray(o.catalogues)));
  notice.textContent = unknown ? 'Kunne ikke finne alle valgte butikker. Åpne Butikker nær meg for å endre valget.'
    : legacy ? 'Noen tilbud mangler butikkdata. For disse viser vi tilbud fra kjeden til valgt butikk.' : '';
  notice.hidden = !notice.textContent;
}

function selectStore(id, selected) {
  if (selected) state.stores.add(id);
  else state.stores.delete(id);
  savePrefs();
  applyFilters();
  renderStores();
}

function renderStores() {
  if (!state.storeData) return;
  const stores = nearbyStores(state.storeData.stores, state.position, $('#store-search').value);
  $('#store-results').innerHTML = stores.length ? stores.map(s => `
    <label class="store-option">
      <input type="checkbox" data-store="${esc(s.id)}" ${state.stores.has(s.id) ? 'checked' : ''}>
      <span><strong><i class="dot" style="background:${esc(chainColor(s.chain) || 'var(--line-strong)')}"></i>${esc(s.name)}</strong>
        <span class="store-address">${esc([s.street, s.zip, s.city].filter(Boolean).join(', '))}</span>
        ${!s.catalogues.length ? '<span class="store-warning">ingen tilbudsdata for denne butikken</span>' : ''}</span>
      ${distanceText(s.distance) ? `<span class="store-distance num">${distanceText(s.distance)}</span>` : ''}
    </label>`).join('') : '<p class="store-empty">Ingen butikker passer søket.</p>';
  if (!storeMap) return;
  storeMarkers.clearLayers();
  for (const s of stores) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) continue;
    const popup = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = s.name;
    const button = document.createElement('button'); button.className = 'icon-btn';
    button.textContent = state.stores.has(s.id) ? 'Fjern butikkfilter' : 'Vis tilbud her';
    button.addEventListener('click', () => selectStore(s.id, !state.stores.has(s.id)));
    popup.append(title, document.createElement('br'), button);
    if (!s.catalogues.length) { const note = document.createElement('p'); note.textContent = 'ingen tilbudsdata for denne butikken'; popup.append(note); }
    window.L.circleMarker([s.lat, s.lng], { radius: state.stores.has(s.id) ? 9 : 6,
      color: chainColor(s.chain) || '#6f6858', fillOpacity: state.stores.has(s.id) ? 1 : 0.6, weight: 2,
    }).bindPopup(popup).addTo(storeMarkers);
  }
  if (state.position) {
    if (positionMarker) positionMarker.remove();
    positionMarker = window.L.circleMarker([state.position.lat, state.position.lng], { radius: 8, color: '#1976d2', fillOpacity: 1 }).bindPopup('Du er her').addTo(storeMap);
  }
}

function usePosition() {
  const status = $('#position-status');
  if (!window.isSecureContext || !navigator.geolocation) {
    status.textContent = 'Posisjon er ikke støttet her. Bruk en sikker tilkobling eller søk etter sted, postnummer eller butikk.';
    return;
  }
  status.textContent = 'Henter posisjon …';
  $('#use-position').disabled = true;
  navigator.geolocation.getCurrentPosition(position => {
    state.position = { lat: position.coords.latitude, lng: position.coords.longitude };
    status.textContent = 'Posisjonen er hentet. Viser de 50 nærmeste butikkene som passer søket.';
    $('#use-position').disabled = false;
    renderStores();
    storeMap?.setView([state.position.lat, state.position.lng], 12);
  }, error => {
    const messages = {
      1: 'Du har ikke delt posisjon. Søk etter sted, postnummer eller butikk i stedet.',
      2: 'Posisjonen er utilgjengelig. Søk etter sted, postnummer eller butikk i stedet.',
      3: 'Det tok for lang tid å hente posisjonen. Prøv igjen eller søk etter sted, postnummer eller butikk.',
    };
    status.textContent = messages[error.code] || messages[2];
    $('#use-position').disabled = false;
  }, { timeout: 10000, maximumAge: 0 });
}

/* ---------------- events ---------------- */

function wire() {
  $('#q').addEventListener('input', e => {
    state.query = e.target.value;
    $('#clear-q').hidden = !state.query;
    if (state.query && state.sort !== 'relevance') state.sort = 'relevance', ($('#sort').value = 'relevance');
    applyFilters();
  });

  $('#clear-q').addEventListener('click', () => {
    state.query = ''; $('#q').value = ''; $('#clear-q').hidden = true; applyFilters();
  });

  $('#sort').addEventListener('change', e => { state.sort = e.target.value; applyFilters(); });

  $('#toggle-theme').addEventListener('click', () => {
    const el = document.documentElement;
    el.dataset.theme = el.dataset.theme === 'dark' ? 'light' : 'dark';
    savePrefs();
  });

  $('#toggle-facets').addEventListener('click', () => $('#facets').classList.toggle('open'));
  $('#open-list').addEventListener('click', openList);
  $('#open-stores').addEventListener('click', openStores);
  $('#use-position').addEventListener('click', usePosition);
  $('#store-search').addEventListener('input', renderStores);
  $('#custom-form').addEventListener('submit', e => {
    e.preventDefault();
    shopping.addCustom(state.list, $('#custom-item').value);
    $('#custom-item').value = '';
    savePrefs(); syncListUI(); renderList();
  });
  $('#clear-checked').addEventListener('click', () => { shopping.clearChecked(state.list); savePrefs(); syncListUI(); renderList(); });
  $('#clear-list').addEventListener('click', () => {
    if (confirm('Vil du tømme hele handlelisten?')) { shopping.clear(state.list); savePrefs(); syncListUI(); renderList(); }
  });

  // Facet clicks, chip removals and card actions all bubble to one handler.
  document.addEventListener('click', e => {
    if (e.target.closest('[data-open-stores]')) { openStores(); return; }
    const facet = e.target.closest('[data-cat],[data-chain],[data-department]');
    if (facet) {
      const { cat, chain, department } = facet.dataset;
      const set = cat ? state.categories : chain ? state.chains : state.departments;
      const val = cat ?? chain ?? department;
      set.has(val) ? set.delete(val) : set.add(val);
      savePrefs();
      applyFilters();
      return;
    }

    const chip = e.target.closest('[data-chip]');
    if (chip) {
      const { chip: kind, val } = chip.dataset;
      if (kind === 'cat') state.categories.delete(val);
      if (kind === 'chain') state.chains.delete(val);
      if (kind === 'department') state.departments.delete(val);
      if (kind === 'store') { state.stores.delete(val); renderStores(); }
      if (kind === 'flag' && val === 'discount') state.onlyDiscount = false;
      if (kind === 'flag' && val === 'multi') state.onlyMultiChain = false;
      savePrefs();
      applyFilters();
      return;
    }

    const add = e.target.closest('[data-add]');
    if (add) { e.stopPropagation(); addCheapest(add.dataset.add); return; }

    const addOffer = e.target.closest('[data-add-offer]');
    if (addOffer) { toggleOffer(addOffer.dataset.addOffer); return; }

    const rm = e.target.closest('[data-rm]');
    if (rm) { state.list.delete(rm.dataset.rm); savePrefs(); syncListUI(); renderList(); return; }

    if (e.target.closest('#copy-list')) {
      const button = e.target.closest('#copy-list');
      if (!navigator.clipboard) { button.textContent = 'Kopiering er ikke støttet'; return; }
      navigator.clipboard.writeText(listAsText()).then(() => { button.textContent = 'Kopiert ✓'; }, () => { button.textContent = 'Kunne ikke kopiere'; });
      return;
    }

    if (e.target.closest('[data-close]')) {
      e.target.closest('dialog').close();
      return;
    }

    const detailButton = e.target.closest('[data-detail]');
    if (detailButton) { openDetail(detailButton.dataset.detail); return; }
    const card = e.target.closest('.card');
    if (card) openDetail(card.dataset.id);
  });

  document.addEventListener('change', e => {
    if (e.target.matches('[data-check]')) {
      const id = e.target.dataset.check;
      shopping.toggleChecked(state.list, id); savePrefs(); syncListUI(); renderList();
      document.querySelector(`[data-check="${CSS.escape(id)}"]`)?.focus();
    }
    if (e.target.matches('[data-store]')) {
      const id = e.target.dataset.store;
      selectStore(id, e.target.checked);
      document.querySelector(`[data-store="${CSS.escape(id)}"]`)?.focus();
    }
    if (e.target.id === 'f-discount') { state.onlyDiscount = e.target.checked; applyFilters(); }
    if (e.target.id === 'f-multi') { state.onlyMultiChain = e.target.checked; applyFilters(); }
    if (e.target.id === 'f-expired') { state.hideExpired = e.target.checked; savePrefs(); applyFilters(); }
  });

  document.addEventListener('keydown', e => {
    if (e.key === '/' && !document.activeElement.matches('input, textarea, select') && !document.querySelector('dialog[open]')) { e.preventDefault(); $('#q').focus(); }
  });

  // IntersectionObserver only fires on a *crossing*. If a page of cards is
  // shorter than the viewport plus the margin, the sentinel never leaves the
  // root and no second callback arrives — pagination stalls with the user
  // staring at 60 of 4000 products. Keep filling while it remains in view.
  const io = new IntersectionObserver(entries => {
    if (!entries[0].isIntersecting) return;
    let guard = 0;
    do {
      const before = state.rendered;
      renderMore();
      if (state.rendered === before) break;      // nothing left to add
    } while (++guard < 40 && isInView($('#sentinel')));
  }, { rootMargin: '600px' });
  io.observe($('#sentinel'));
}

/* ---------------- boot ---------------- */

async function boot() {
  loadPrefs();
  try {
    const res = await fetch('data/offers.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();
  } catch (err) {
    $('#loading').innerHTML =
      `<h3>Fikk ikke lastet tilbudene</h3><p>${esc(err.message)}</p>
       <p style="font-size:13px">Kjør <code>node scrape.mjs</code> for å bygge <code>data/offers.json</code>.</p>`;
    return;
  }

  state.products = state.data.products;
  state.haystack = state.products.map(p => [
    p.name, p.brand ?? '', p.category,
    ...p.chains.map(chainName),
    ...p.offers.map(o => o.description ?? ''),
  ].join(' ').toLowerCase());

  $('#loading').remove();
  renderStrip();
  wire();
  if (state.stores.size) { try { await loadStores(); } catch { $('#store-notice').textContent = 'Kunne ikke laste valgte butikker. Åpne Butikker nær meg for å prøve igjen.'; } }
  applyFilters();
  syncListUI();
}

boot();
