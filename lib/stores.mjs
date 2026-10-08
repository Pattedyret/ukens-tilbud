const coordinate = (value, max) => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= max ? n : null;
};

/** Join dealer stores with national and regional catalogue applicability. */
export function buildStoreIndex({ catalogues, dealerStores, catalogueStores, chainSlugByDealer }) {
  const stores = new Map();
  const add = (store, dealer) => {
    const chain = chainSlugByDealer.get(dealer);
    if (!store?.id || !chain || (store.dealer_id != null && store.dealer_id !== dealer)) return;
    if (!stores.has(store.id)) stores.set(store.id, {
      id: store.id, chain, name: String(store.name ?? ''),
      street: String(store.street ?? ''), zip: String(store.zip_code ?? ''), city: String(store.city ?? ''),
      lat: coordinate(store.latitude, 90), lng: coordinate(store.longitude, 180), catalogues: [],
    });
    return stores.get(store.id);
  };
  for (const [dealer, rows] of dealerStores) for (const row of rows) add(row, dealer);
  // Regional listings may recover stores absent from a failed dealer endpoint.
  for (const cat of catalogues) for (const row of catalogueStores.get(cat.id) ?? []) add(row, cat.dealer_id);
  for (const cat of catalogues) {
    const chain = chainSlugByDealer.get(cat.dealer_id);
    if (!chain) continue;
    const ids = cat.all_stores === true
      ? [...stores.values()].filter(s => s.chain === chain).map(s => s.id)
      : (catalogueStores.get(cat.id) ?? []).filter(s => s.dealer_id == null || s.dealer_id === cat.dealer_id).map(s => s.id);
    for (const id of ids) {
      const store = stores.get(id);
      if (store?.chain === chain && !store.catalogues.includes(cat.id)) store.catalogues.push(cat.id);
    }
  }
  return [...stores.values()].map(s => ({ ...s, catalogues: s.catalogues.sort() })).sort((a, b) => a.id.localeCompare(b.id));
}
