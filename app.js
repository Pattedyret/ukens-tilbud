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
  sectors: new Set(),
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
    if (Array.isArray(raw.list)) state.list = new Map(raw.list);
    if (typeof raw.hideExpired === 'boolean') state.hideExpired = raw.hideExpired;
  } catch { /* first visit, or corrupted storage — defaults are fine */ }
}

function savePrefs() {
  localStorage.setItem(STORE_KEY, JSON.stringify({
    theme: document.documentElement.dataset.theme,
    chains: [...state.chains],
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
    (o.price ?? Infinity) < (best.price ?? Infinity) ? o : best, offers[0]);
}

function visibleOffers(product) {
  if (!state.hideExpired) return product.offers;
  const live = product.offers.filter(isLive);
  // A product whose offers have all lapsed still shows its last known prices
  // rather than rendering an empty card.
  return live.length ? live : product.offers;
}

const maxDiscount = p =>
  Math.max(0, ...p.offers.map(o => o.discount_pct ?? 0));

/* ---------------- filtering ---------------- */

function applyFilters() {
  const q = state.query.trim().toLowerCase();
  const terms = q ? q.split(/\s+/).filter(Boolean) : [];
  const now = new Date();

  const out = [];
  for (let i = 0; i < state.products.length; i++) {
    const p = state.products[i];

    if (state.categories.size && !state.categories.has(p.category)) continue;
    if (state.chains.size && !p.chains.some(c => state.chains.has(c))) continue;
    if (state.sectors.size && !p.chains.some(c => state.sectors.has(sectorOf(c)))) continue;
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
    'price-asc': (a, b) => (a.p.min_price ?? Infinity) - (b.p.min_price ?? Infinity),
    'price-desc': (a, b) => (b.p.min_price ?? -Infinity) - (a.p.min_price ?? -Infinity),
    'discount': (a, b) => maxDiscount(b.p) - maxDiscount(a.p),
    'unit': (a, b) => (a.p.best_unit?.value ?? Infinity) - (b.p.best_unit?.value ?? Infinity),
    'chains': (a, b) => b.p.chain_count - a.p.chain_count || maxDiscount(b.p) - maxDiscount(a.p),
    'name': (a, b) => a.p.name.localeCompare(b.p.name, 'nb'),
    'relevance': (a, b) => b.score - a.score
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
}

const sectorOf = slug => state.data.chains.find(c => c.slug === slug)?.sector ?? 'Annet';

/* ---------------- rendering ---------------- */

function cardHTML(p) {
  const best = headline(p);
  const disc = maxDiscount(p);
  const img = best?.image;
  // The kr/kg must belong to the offer whose price is on the card. Using the
  // product-wide best_unit paired "10 kr" (a 100 g jar) with "99,50 kr/kg"
  // (a 200 g jar at another chain) — two true numbers making a false claim.
  const unit = best?.unit_price;
  const chains = p.chains.slice(0, 2);
  const extra = p.chains.length - chains.length;
  const inList = p.offers.some(o => state.list.has(o.id));

  return `
    <article class="card" data-id="${esc(p.id)}">
      <div class="card-media">
        ${img
          ? `<img src="${esc(img)}" alt="${esc(p.name)}" loading="lazy" decoding="async">`
          : `<div class="placeholder">Uten bilde</div>`}
        ${disc > 0 ? `<span class="badge-save num">−${disc}%</span>` : ''}
        ${p.chain_count > 1 ? `<span class="badge-chains num">${p.chain_count} butikker</span>` : ''}
      </div>
      <div class="card-body">
        <div class="card-cat">${esc(p.category)}</div>
        <div class="card-name">${esc(p.name)}</div>
        <div class="card-price">
          <span class="price num">${kr(best?.price)}<span class="kr">kr</span></span>
          ${best?.pre_price ? `<span class="price-was num">${kr(best.pre_price)}</span>` : ''}
        </div>
        ${unit ? `<div class="card-unit num">${unitText(unit)}</div>`
               : best?.size_text ? `<div class="card-unit">${esc(best.size_text)}</div>` : ''}
        <div class="card-foot">
          ${chains.map(c => `<span class="store-tag"><i class="dot" style="background:${esc(chainColor(c) || 'var(--line-strong)')}"></i>${esc(chainName(c))}</span>`).join('')}
          ${extra > 0 ? `<span class="store-tag">+${extra}</span>` : ''}
          <button class="add-btn" data-add="${esc(p.id)}" data-in="${inList ? 1 : 0}"
            aria-label="Legg i handleliste">${inList ? '✓' : '+'}</button>
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
  const offers = state.filtered.reduce((s, p) => s + p.offer_count, 0);
  $('#results-count').innerHTML =
    `<b class="num">${nf0.format(n)}</b> produkter · <span class="num">${nf0.format(offers)}</span> tilbud`;
}

function renderChips() {
  const chips = [];
  for (const c of state.categories) chips.push(['cat', c, c]);
  for (const c of state.chains) chips.push(['chain', c, chainName(c)]);
  for (const s of state.sectors) chips.push(['sector', s, s]);
  if (state.onlyDiscount) chips.push(['flag', 'discount', 'Kun nedsatt']);
  if (state.onlyMultiChain) chips.push(['flag', 'multi', 'Flere butikker']);
  $('#active-chips').innerHTML = chips.map(([kind, val, label]) =>
    `<span class="chip">${esc(label)}<button data-chip="${kind}" data-val="${esc(val)}" aria-label="Fjern">✕</button></span>`
  ).join('');
}

function facetCounts(key) {
  // Counts reflect the current result set so the sidebar shows what is
  // reachable from here, not the size of the whole catalogue.
  const counts = new Map();
  for (const p of state.filtered) {
    if (key === 'category') counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
    else if (key === 'chain') for (const c of new Set(p.chains)) counts.set(c, (counts.get(c) ?? 0) + 1);
    else if (key === 'sector') for (const s of new Set(p.chains.map(sectorOf))) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return counts;
}

function renderFacets() {
  const catCounts = facetCounts('category');
  const chainCounts = facetCounts('chain');
  const secCounts = facetCounts('sector');

  const cats = state.data.categories
    .map(c => c.name)
    .filter(n => catCounts.has(n) || state.categories.has(n))
    .sort((a, b) => (catCounts.get(b) ?? 0) - (catCounts.get(a) ?? 0));

  const sectors = [...new Set(state.data.chains.map(c => c.sector))]
    .filter(s => secCounts.has(s) || state.sectors.has(s))
    .sort((a, b) => (secCounts.get(b) ?? 0) - (secCounts.get(a) ?? 0));

  const chains = state.data.chains
    .filter(c => chainCounts.has(c.slug) || state.chains.has(c.slug))
    .sort((a, b) => (chainCounts.get(b.slug) ?? 0) - (chainCounts.get(a.slug) ?? 0));

  $('#facets').innerHTML = `
    <div class="facet">
      <h3>Vis</h3>
      <label class="switch"><input type="checkbox" id="f-discount" ${state.onlyDiscount ? 'checked' : ''}> Kun nedsatt pris</label>
      <label class="switch"><input type="checkbox" id="f-multi" ${state.onlyMultiChain ? 'checked' : ''}> Finnes i flere butikker</label>
      <label class="switch"><input type="checkbox" id="f-expired" ${state.hideExpired ? 'checked' : ''}> Skjul utgåtte</label>
    </div>

    <div class="facet">
      <h3>Bransje</h3>
      <div class="facet-list">
        ${sectors.map(s => `
          <button class="facet-item" data-sector="${esc(s)}" aria-pressed="${state.sectors.has(s)}">
            ${esc(s)}<span class="n num">${nf0.format(secCounts.get(s) ?? 0)}</span>
          </button>`).join('')}
      </div>
    </div>

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
  const offers = [...p.offers].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  // Flag only the single cheapest row. On a price tie every row would otherwise
  // claim to be the cheapest, which reads as a bug rather than as a tie.
  const cheapestId = p.chain_count > 1 ? offers[0]?.id : null;

  $('#d-name').textContent = p.name;
  $('#d-sub').innerHTML = [
    esc(p.category),
    p.brand ? esc(p.brand) : null,
    `${p.chain_count} ${p.chain_count === 1 ? 'butikk' : 'butikker'}`,
    p.best_unit ? `fra <span class="num">${kr(p.best_unit.value)} kr/${esc(p.best_unit.symbol)}</span>` : null,
  ].filter(Boolean).join(' · ');

  $('#d-body').innerHTML = offers.map(o => {
    const expired = o.valid_to && !isLive(o);
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
            ${esc(o.description || o.heading || '')}
            ${o.size_text ? ` · ${esc(o.size_text)}` : ''}
            ${o.valid_to ? ` · ${expired ? 'utgått' : 'til ' + df.format(parseDate(o.valid_to))}` : ''}
            ${o.catalogue_url ? ` · <a href="${esc(o.catalogue_url)}" target="_blank" rel="noopener">kundeavis s. ${o.page ?? '?'}</a>` : ''}
          </div>
        </div>
        <div class="offer-price">
          <div class="price num">${kr(o.price)}<span class="kr">kr</span></div>
          ${o.pre_price ? `<div class="price-was num">${kr(o.pre_price)}</div>` : ''}
          ${o.unit_price ? `<div class="card-unit num">${unitText(o.unit_price)}</div>` : ''}
          <button class="add-btn" style="margin-top:5px" data-add-offer="${esc(o.id)}"
            data-in="${state.list.has(o.id) ? 1 : 0}">${state.list.has(o.id) ? '✓' : '+'}</button>
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
      if (o) { state.list.set(offerId, { name: p.name, chain: o.chain, price: o.price, size: o.size_text }); break; }
    }
  }
  savePrefs();
  syncListUI();
}

/** The card's + button adds that product's cheapest offer. */
function addCheapest(productId) {
  const p = state.products.find(x => x.id === productId);
  if (!p) return;
  const existing = p.offers.find(o => state.list.has(o.id));
  if (existing) { state.list.delete(existing.id); savePrefs(); syncListUI(); return; }
  const best = headline(p);
  if (best) toggleOffer(best.id);
}

function syncListUI() {
  $('#list-count').textContent = state.list.size;
  for (const btn of document.querySelectorAll('[data-add]')) {
    const p = state.products.find(x => x.id === btn.dataset.add);
    const inList = p?.offers.some(o => state.list.has(o.id));
    btn.dataset.in = inList ? 1 : 0;
    btn.textContent = inList ? '✓' : '+';
  }
  for (const btn of document.querySelectorAll('[data-add-offer]')) {
    const inList = state.list.has(btn.dataset.addOffer);
    btn.dataset.in = inList ? 1 : 0;
    btn.textContent = inList ? '✓' : '+';
  }
}

function openList() {
  const byChain = new Map();
  for (const [id, item] of state.list) {
    if (!byChain.has(item.chain)) byChain.set(item.chain, []);
    byChain.get(item.chain).push({ id, ...item });
  }

  const total = [...state.list.values()].reduce((s, i) => s + (i.price ?? 0), 0);
  $('#l-sub').innerHTML = state.list.size
    ? `${state.list.size} ${state.list.size === 1 ? 'vare' : 'varer'} i ${byChain.size} ` +
      `${byChain.size === 1 ? 'butikk' : 'butikker'} · totalt <span class="num">${kr(total)} kr</span>`
    : 'Tom';

  $('#l-body').innerHTML = state.list.size
    ? [...byChain.entries()]
      .sort((a, b) => chainName(a[0]).localeCompare(chainName(b[0]), 'nb'))
      .map(([chain, items]) => `
        <div class="list-group">
          <h4><i class="dot" style="background:${esc(chainColor(chain) || 'var(--line-strong)')}"></i>
            ${esc(chainName(chain))}
            <span class="sum num">${kr(items.reduce((s, i) => s + (i.price ?? 0), 0))} kr</span></h4>
          ${items.map(i => `
            <div class="list-item">
              <span>${esc(i.name)}${i.size ? ` <span style="color:var(--faint)">${esc(i.size)}</span>` : ''}</span>
              <span class="num" style="margin-left:auto">${kr(i.price)}</span>
              <button class="rm" data-rm="${esc(i.id)}" aria-label="Fjern">✕</button>
            </div>`).join('')}
        </div>`).join('') +
      `<button class="icon-btn" id="copy-list" style="margin-top:6px">Kopier som tekst</button>`
    : `<div class="empty"><h3>Handlelisten er tom</h3>
         <p>Trykk <b>+</b> på et tilbud for å legge det til.</p></div>`;

  $('#listdlg').showModal();
}

function listAsText() {
  const byChain = new Map();
  for (const item of state.list.values()) {
    if (!byChain.has(item.chain)) byChain.set(item.chain, []);
    byChain.get(item.chain).push(item);
  }
  return [...byChain.entries()].map(([chain, items]) =>
    `${chainName(chain)}\n` + items.map(i =>
      `  - ${i.name}${i.size ? ` (${i.size})` : ''}  ${kr(i.price)} kr`).join('\n')
  ).join('\n\n');
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

  // Facet clicks, chip removals and card actions all bubble to one handler.
  document.addEventListener('click', e => {
    const facet = e.target.closest('[data-cat],[data-chain],[data-sector]');
    if (facet) {
      const { cat, chain, sector } = facet.dataset;
      const set = cat ? state.categories : chain ? state.chains : state.sectors;
      const val = cat ?? chain ?? sector;
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
      if (kind === 'sector') state.sectors.delete(val);
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
    if (rm) { state.list.delete(rm.dataset.rm); savePrefs(); syncListUI(); openList(); return; }

    if (e.target.closest('#copy-list')) {
      navigator.clipboard?.writeText(listAsText());
      e.target.closest('#copy-list').textContent = 'Kopiert ✓';
      return;
    }

    if (e.target.closest('[data-close]')) {
      e.target.closest('dialog').close();
      return;
    }

    const card = e.target.closest('.card');
    if (card) openDetail(card.dataset.id);
  });

  document.addEventListener('change', e => {
    if (e.target.id === 'f-discount') { state.onlyDiscount = e.target.checked; applyFilters(); }
    if (e.target.id === 'f-multi') { state.onlyMultiChain = e.target.checked; applyFilters(); }
    if (e.target.id === 'f-expired') { state.hideExpired = e.target.checked; savePrefs(); applyFilters(); }
  });

  document.addEventListener('keydown', e => {
    if (e.key === '/' && document.activeElement !== $('#q')) { e.preventDefault(); $('#q').focus(); }
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
  applyFilters();
  syncListUI();
}

boot();
