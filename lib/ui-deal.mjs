const nf = new Intl.NumberFormat('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = n => n == null ? '–' : nf.format(n).replace(',00', ',–');

/** All price surfaces share these labels; only priceHtml contains markup. */
export function dealView(offer) {
  const b = offer.bundle, m = offer.multibuy;
  if (b) return {
    priceHtml: `<span class="bundle-count">${Number(b.count)} for</span> ${money(b.total)}`,
    priceText: `${b.count} for ${money(b.total)}`,
    perItemText: `${money(b.each)} kr/stk`,
    badgeText: `${b.count} for ${money(b.total).replace(',–', '')}`,
    listText: `${b.count} for ${money(b.total)} (${money(b.each)} kr/stk)`,
  };
  const priceText = offer.price == null ? '–' : `${money(offer.price)} kr`;
  return {
    priceHtml: `${money(offer.price)}${offer.price == null ? '' : '<span class="kr">kr</span>'}`,
    priceText,
    perItemText: m ? `Ta ${m.buy}: ${money(m.effective_price)} kr/stk` : '',
    badgeText: m ? `${m.buy} for ${m.pay}` : '',
    listText: m ? `${priceText} · ${m.buy} for ${m.pay} (Ta ${m.buy}: ${money(m.effective_price)} kr/stk)` : priceText,
  };
}

export function dealSize(offer) {
  const size = offer.size_text || '';
  return offer.bundle ? size.replace(/^\s*\d+\s*[x×]\s*/i, '') : size;
}

export function dealDescription(offer) {
  const description = offer.description || offer.heading || '';
  return offer.bundle ? description.replace(/\b\d+\s+for\s+\d+(?:[,.]\d+)?(?:\s*(?:kr|,–|,-))?/gi, '').trim() : description;
}
