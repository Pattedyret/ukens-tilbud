/** Parse explicit deal text; pack quantity alone never implies a promotion. */
export function parseDeal({ heading = '', description = '', price, piecesFrom } = {}) {
  const empty = { bundle: null, multibuy: null };
  if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) return empty;
  const text = `${heading ?? ''} ${description ?? ''}`;
  const start = '(?<![\\p{L}\\p{N}.,])';
  const end = '(?![\\p{L}\\p{N}]|[.,]\\d)(?!\\s*(?:mm|cm|dm|km|m|ml|cl|dl|l|mg|kg|g|stk)\\b)';
  const patterns = [
    `${start}(\\d{1,2})\\s*(?:for|=)\\s*(\\d{1,2})${end}`,
    `${start}(?:kjøp|ta)\\s+(\\d{1,2})\\s+betal\\s+(?:for\\s+)?(\\d{1,2})${end}`,
  ];
  // An explicit ratio wins over piecesFrom: JYSK's "2 for 1" has pieces=2,
  // but pricing.price is still the single towel's sticker price.
  for (const pattern of patterns) {
    for (const match of text.matchAll(new RegExp(pattern, 'giu'))) {
      const buy = Number(match[1]), pay = Number(match[2]);
      if (buy < 2 || buy > 20 || pay < 1 || pay >= buy) continue;
      return { bundle: null, multibuy: { buy, pay, unit_price: price, effective_price: Math.round(price * pay / buy * 100) / 100 } };
    }
  }
  const bundlePattern = new RegExp(`${start}(\\d{1,2})\\s+(?:stk\\.?\\s+)?for\\s+(\\d+(?:[.,]\\d+)?)${end}`, 'giu');
  for (const match of text.matchAll(bundlePattern)) {
    const count = Number(match[1]), total = Number(match[2].replace(',', '.'));
    if (count < 2 || count > 20 || Math.abs(total - price) > 0.5) continue;
    return { bundle: { count, total: price, each: Math.round(price / count * 100) / 100 }, multibuy: null };
  }
  return empty;
}

/**
 * Price used whenever offers are compared or ranked. A "2 for 50" bundle is
 * priced at its total (50), so comparing that against a single item at 30
 * hides a deal that is really 25 per item. Compare per item instead.
 */
export const comparablePrice = offer => offer?.bundle?.each ?? offer?.price ?? null;

// "Førpris 49,90", "Ord.pris fra 41,90 til 43,90", "før 45.999,-". A number is
// read whole and then judged by what follows it, so regex backtracking can
// never accept "25" out of the date "25.10.26" or "30" out of "-30%".
const STATED_BEFORE = /(?<!\p{L})(?:før(?:pris)?|ord(?:inær|\.)?\s*pris|normalpris)\s*:?\s*(?:fra\s+)?/giu;
const NUMBER = /^(\d{1,2}(?: \d{3})+|\d{1,3}(?:\.\d{3})+|\d+)(,\d{1,2}|,-|\.-)?/;
const RANGE = /^\s*(?:-|–|til|\/)\s*/i;
const UNIT = /^\s*(?:\/|pr\.?\s*|per\s+)\s*(?:kg|hg|l|liter|stk|m)(?![\p{L}])/iu;
const NOT_A_PRICE = /^[./]\d/;

/** Leading price at the start of text: { value, rest } or null. */
function readPrice(text) {
  const m = NUMBER.exec(text);
  if (!m) return null;
  const rest = text.slice(m[0].length);
  // Only a bare integer can be the start of a date; "49,90/51,90" is a range.
  if (/^\s*%/.test(rest) || (!m[2] && NOT_A_PRICE.test(rest))) return { value: null, rest };
  const value = Number(m[1].replace(/[ .]/g, '') + (m[2]?.startsWith(',') && m[2] !== ',-' ? '.' + m[2].slice(1) : ''));
  return { value, rest };
}

/** Prices stated right after one before-price keyword; [] when it is a unit price. */
function pricesAfter(text) {
  const first = readPrice(text);
  if (!first || first.value == null) return [];
  let rest = first.rest;
  const values = [first.value];
  const sep = RANGE.exec(rest);
  if (sep) {
    const second = readPrice(rest.slice(sep[0].length));
    if (second) {
      if (second.value != null) { values.push(second.value); rest = second.rest; }
      // "129,- -30%": the second number is a percentage, not part of the range.
      else if (/^\s*%/.test(second.rest)) rest = '';
    }
  }
  // "49,90–79,90/kg": the whole range is a unit price, not the pack's price.
  return UNIT.test(rest) ? [] : values;
}

/**
 * Lowest before-price the catalogue text itself states, or null. Some chains
 * print "Førpris" only in the copy, so the API's pre_price is missing. No
 * percentage is derived from this: a range cannot say how much was saved.
 * Bundles are skipped because their before-price is per item, not per bundle.
 */
export function statedPrePrice(offer) {
  if (!offer || offer.bundle) return null;
  const text = `${offer.heading ?? ''} ${offer.description ?? ''}`;
  const prices = [...text.matchAll(STATED_BEFORE)]
    .flatMap(m => pricesAfter(text.slice(m.index + m[0].length))).filter(Number.isFinite);
  return prices.length ? Math.min(...prices) : null;
}

/**
 * True only when the offer documents a price advantage: a markdown, a "3 for 2",
 * a "2 for X" bundle, or a stated before-price above what it costs now. Anything
 * else is unknown; it is not proof that the price is ordinary.
 */
export function hasDocumentedAdvantage(offer) {
  if (!offer) return false;
  if (offer.discount_pct > 0 || offer.multibuy || offer.bundle) return true;
  const stated = statedPrePrice(offer), price = comparablePrice(offer);
  return stated != null && price != null && stated > price;
}
