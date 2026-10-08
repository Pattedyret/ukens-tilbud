import { dealView, dealSize } from './ui-deal.mjs';

export const migrateList = pairs => new Map((pairs || []).map(([id, item]) => [id, { ...item, checked: !!item.checked }]));
export function addOffer(list, product, offer) {
  list.set(offer.id, { name: product.name, chain: offer.chain, price: offer.bundle?.total ?? offer.price,
    size: dealSize(offer), deal: dealView(offer).listText, valid_to: offer.valid_to, checked: false });
}
export function addCustom(list, name, time = Date.now()) {
  if (!name.trim()) return;
  let id = `custom:${time}`;
  while (list.has(id)) id = `custom:${++time}`;
  list.set(id, { name: name.trim(), custom: true, checked: false });
}
export function toggleChecked(list, id) { const item = list.get(id); if (item) item.checked = !item.checked; }
export const remove = (list, id) => list.delete(id);
export function clearChecked(list) { for (const [id, item] of list) if (item.checked) list.delete(id); }
export const clear = list => list.clear();
export const total = list => [...list.values()].reduce((sum, item) => sum + (item.checked ? 0 : item.price ?? 0), 0);
export function toText(list, chainName) {
  const groups = new Map();
  for (const item of list.values()) {
    const group = item.custom ? 'Egne varer' : chainName(item.chain);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(item);
  }
  return [...groups].map(([group, items]) => `${group}\n` + items.sort((a, b) => a.checked - b.checked).map(i =>
    `  [${i.checked ? 'x' : ' '}] ${i.name}${i.size ? ` (${i.size})` : ''}${i.custom ? '' : `  ${i.deal || dealView(i).listText}`}`).join('\n')).join('\n\n');
}
