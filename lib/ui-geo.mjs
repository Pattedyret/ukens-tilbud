const coordinates = p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng);
export function haversine(a, b) {
  if (!coordinates(a) || !coordinates(b)) return Infinity;
  const rad = n => n * Math.PI / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
export const distanceText = km => Number.isFinite(km)
  ? `${new Intl.NumberFormat('nb-NO', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(km)} km` : '';
export function nearbyStores(stores, position, query = '') {
  const terms = query.toLocaleLowerCase('nb').trim().split(/\s+/).filter(Boolean);
  const found = stores.filter(s => {
    const hay = [s.name, s.street, s.zip, s.city].join(' ').toLocaleLowerCase('nb');
    return terms.every(t => hay.includes(t));
  }).map(s => ({ ...s, distance: position ? haversine(position, s) : null }));
  if (position) found.sort((a, b) => a.distance - b.distance);
  return position ? found.slice(0, 50) : found;
}
