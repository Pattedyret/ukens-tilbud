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

// "Førpris 49,90", "Ord.pris fra 41,90 til 43,90", "Før 42,90". The number must
// look like a price: not a date ("før 25.10.26") and not a unit price ("/kg").
const PRICE_TEXT = '(\\d{1,5}(?:,\\d{1,2}|,-|\\.-)?)(?![.,]?\\d)';
const STATED_BEFORE = new RegExp(
  `(?<!\\p{L})(?:før(?:pris)?|ord(?:inær|\\.)?\\s*pris|normalpris)\\s*:?\\s*(?:fra\\s+)?${PRICE_TEXT}` +
  `(?:\\s*(?:-|–|til|/)\\s*${PRICE_TEXT})?(?!\\s*(?:/|pr\\.?\\s|per\\s)\\s*(?:kg|hg|l|liter|stk|m)\\b)`, 'giu');
const priceNumber = s => Number(s.replace(/,-|\.-/, '').replace(',', '.'));

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
    .flatMap(m => [m[1], m[2]]).filter(Boolean).map(priceNumber).filter(Number.isFinite);
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
