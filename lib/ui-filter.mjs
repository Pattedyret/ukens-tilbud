/** Store entries carry chain + catalogues so old data can fall back honestly. */
export function matchingOffers(product, { chains = [], storeCatalogues = [], hideExpired = false, now = new Date() } = {}) {
  const selectedChains = new Set(chains);
  return product.offers.filter(o => {
    if (selectedChains.size && !selectedChains.has(o.chain)) return false;
    if (hideExpired && o.valid_to && new Date(o.valid_to.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')) < now) return false;
    if (!storeCatalogues.length) return true;
    return storeCatalogues.some(store => Array.isArray(o.catalogues)
      ? o.catalogues.some(id => store.catalogues.includes(id))
      : o.chain === store.chain);
  });
}
