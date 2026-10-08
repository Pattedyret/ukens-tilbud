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
