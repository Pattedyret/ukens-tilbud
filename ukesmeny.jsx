// Ukesmeny — lavkarbo middagsplanlegger med Oda-handlekurv.
//
// Claude.ai-artefakt: én fil, kjører i artefakt-iframen. Ingen build, ingen
// localStorage (window.storage), ingen <form> (onClick/onChange).
//
// Oda nås via mcp_servers på api.anthropic.com/v1/messages. Produkt-API-et
// (oda.com/api/v1/products/{id}/) har ingen CORS-headere, så næringsinnhold og
// tilbud må hentes med web_fetch på API-siden — om det er blokkert for
// artefakter, degraderer appen synlig i stedet for å lyve om at karbogrensen
// er verifisert.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, CalendarDays, Check, ChefHat, ChevronLeft, ChevronRight,
  ExternalLink, Loader2, Lock, Minus, Plus, RefreshCw, Search, Settings as SettingsIcon,
  ShoppingCart, Tag, Timer as TimerIcon, Unlock, X,
} from 'lucide-react';

/* ============================ konstanter ============================ */

const MODEL = 'claude-sonnet-4-6';
const API_URL = 'https://api.anthropic.com/v1/messages';
const ODA_MCP = [{ type: 'url', url: 'https://oda.com/mcp', name: 'oda' }];
const WEB_FETCH_TOOL = { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 14 };
const CART_URL = 'https://oda.com/no/cart/';
const CARB_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ENRICH_BATCH = 10;

const KEYS = {
  settings: 'settings',
  week: 'week:current',
  history: 'week:history',
  cart: 'cart:current',
  carbs: 'carbs:cache',
  cook: 'cook:state',
};

const DEFAULT_SETTINGS = {
  servings: 4,
  dinners: 5,
  budgetNok: 400,
  lowCarbMaxG: 5,
  buyMode: 'as planned',
  constraints: '',
  pantry: ['salt', 'pepper', 'olivenolje', 'smør', 'matolje', 'eddik', 'vann'],
  // Ikke i spec-ens datamodell: husker om web_fetch var tillatt sist, så
  // tilbud-modus ikke blinker inn og ut ved oppstart. Verifiseres på nytt
  // hver gang berikelsen kjører.
  webFetchSupported: null,
};

const BUY_MODES = [
  { id: 'as planned', label: 'Som planlagt', hint: 'Riktig pakkestørrelse og kjent merke' },
  { id: 'cheapest', label: 'Billigst', hint: 'Lavest pris per kilo/liter' },
  { id: 'tilbud', label: 'Tilbud', hint: 'Prioriterer varer på tilbud, inkl. mengderabatt' },
];

/* ============================ lagring ============================ */
// window.storage kan ha to former, kan være asynkron, og kaster på manglende
// nøkkel. Alt går gjennom denne adapteren, som alltid har en Map i bakhånd.

const mem = new Map();
let shape = null;

function detectShape() {
  const s = typeof window !== 'undefined' ? window.storage : null;
  if (!s) return 'mem';
  if (typeof s.set === 'function' && typeof s.get === 'function') return 'kv';
  if (typeof s.setItem === 'function' && typeof s.getItem === 'function') return 'item';
  return 'mem';
}

function unwrap(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    if ('value' in v) return v.value;
    if ('data' in v && Object.keys(v).length <= 2) return v.data;
  }
  return v;
}

async function loadJson(key, fallback) {
  if (!shape) shape = detectShape();
  try {
    let raw;
    if (shape === 'kv') raw = await window.storage.get({ key });
    else if (shape === 'item') raw = await window.storage.getItem(key);
    else raw = mem.get(key);
    raw = unwrap(raw);
    if (raw == null || raw === '') return fallback;
    const val = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return val == null ? fallback : val;
  } catch {
    // Manglende nøkkel kaster på enkelte lagringsflater — det er ikke en feil.
    const cached = mem.get(key);
    if (cached != null) { try { return JSON.parse(cached); } catch { return fallback; } }
    return fallback;
  }
}

async function saveJson(key, value) {
  const str = JSON.stringify(value);
  mem.set(key, str);
  if (!shape) shape = detectShape();
  try {
    if (shape === 'kv') await window.storage.set({ key, value: str, shared: false });
    else if (shape === 'item') await window.storage.setItem(key, str);
  } catch {
    // Minnekopien holder økta i gang; neste åpning starter tomt.
  }
}

/* ============================ formatering ============================ */

const nf2 = new Intl.NumberFormat('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf1 = new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 0 });

const kr = v => (v == null || Number.isNaN(v) ? '–' : `${nf2.format(v)} kr`);
const kr0 = v => (v == null || Number.isNaN(v) ? '–' : `${nf0.format(Math.round(v))} kr`);
const g = v => (v == null || Number.isNaN(v) ? '–' : `${nf1.format(v)} g`);

function fmtAmount(n) {
  if (n == null || Number.isNaN(n)) return '';
  if (n >= 100) return nf0.format(Math.round(n));
  if (Math.abs(n - Math.round(n)) < 0.05) return nf0.format(Math.round(n));
  return nf1.format(n);
}

const uid = () => `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/* ============================ enheter og pakker ============================ */

// Basisenheter: g, ml, stk. Alt annet regnes om hit før noe summeres.
const UNIT_FACTORS = {
  kg: [1000, 'g'], hg: [100, 'g'], g: [1, 'g'], gram: [1, 'g'],
  l: [1000, 'ml'], liter: [1000, 'ml'], dl: [100, 'ml'], cl: [10, 'ml'], ml: [1, 'ml'],
  ss: [15, 'ml'], ts: [5, 'ml'], krm: [1, 'ml'],
  stk: [1, 'stk'], pk: [1, 'stk'], pakke: [1, 'stk'], boks: [1, 'stk'], pose: [1, 'stk'],
  glass: [1, 'stk'], fedd: [1, 'stk'], neve: [1, 'stk'], bunt: [1, 'stk'], porsjon: [1, 'stk'],
};

function toBase(amount, unit) {
  if (amount == null || Number.isNaN(amount)) return null;
  const key = String(unit || '').toLowerCase().trim().replace(/\.$/, '');
  const f = UNIT_FACTORS[key];
  if (!f) return null;
  return { amount: amount * f[0], base: f[1] };
}

const parseNum = s => parseFloat(String(s).replace(',', '.'));

/**
 * Pakkestørrelse ut av fritekst: "Saktevoksende kylling, 950 g", "4 x 125 g",
 * "1,5 l". Regnes, ikke øyemål — qty = ceil(behov / pakke) står og faller på
 * at dette tallet er riktig.
 */
function parsePackSize(text) {
  if (!text) return null;
  const s = String(text).toLowerCase().replace(/ /g, ' ');
  const N = '(\\d+(?:[.,]\\d+)?)';
  const U = '(kg|hg|g|gram|liter|l|dl|cl|ml|stk|pk)';

  const multi = new RegExp(`${N}\\s*[x×]\\s*${N}\\s*${U}(?![a-zæøå])`).exec(s);
  if (multi) {
    const b = toBase(parseNum(multi[2]), multi[3]);
    if (b) return { amount: parseNum(multi[1]) * b.amount, base: b.base, raw: multi[0].trim() };
  }

  const re = new RegExp(`${N}\\s*${U}(?![a-zæøå])`, 'g');
  let m, last = null;
  while ((m = re.exec(s)) !== null) last = m;
  if (last) {
    const b = toBase(parseNum(last[1]), last[2]);
    if (b) return { amount: b.amount, base: b.base, raw: last[0].trim() };
  }
  return null;
}

/** Antall pakker som trengs, og overskuddet det gir. */
function packMath(neededAmount, neededUnit, packText) {
  const pack = parsePackSize(packText);
  const need = toBase(neededAmount, neededUnit);
  if (!pack || !need || pack.base !== need.base || pack.amount <= 0) {
    return { qty: 1, surplus: null, pack, comparable: false };
  }
  const qty = Math.max(1, Math.ceil(need.amount / pack.amount));
  return { qty, surplus: qty * pack.amount - need.amount, base: need.base, pack, comparable: true };
}

const baseLabel = b => (b === 'g' ? 'g' : b === 'ml' ? 'ml' : 'stk');

/* ============================ ferskvare-heuristikk ============================ */
// Oda oppgir ofte ingen næringstabell på fersk frukt/kjøtt/fisk. Da er tomt
// felt ikke det samme som "ukjent karbo" — men bare for ting som faktisk er
// ferskvare. Alt annet får grå «?» og må sjekkes manuelt.

const FRESH_WORDS = [
  'kylling', 'kalkun', 'storfe', 'svin', 'lam', 'biff', 'entrecote', 'indrefilet', 'ytrefilet',
  'kjøttdeig', 'karbonadedeig', 'bacon', 'flesk', 'ribbe', 'koteletter', 'lår', 'bryst', 'vinge',
  'laks', 'ørret', 'torsk', 'sei', 'hyse', 'makrell', 'reker', 'skalldyr', 'fisk', 'filet',
  'egg', 'brokkoli', 'blomkål', 'kål', 'salat', 'spinat', 'ruccola', 'agurk', 'tomat', 'paprika',
  'squash', 'aubergine', 'asparges', 'purre', 'løk', 'hvitløk', 'sopp', 'champignon', 'gulrot',
  'selleri', 'persille', 'basilikum', 'koriander', 'timian', 'rosmarin', 'dill', 'gressløk',
  'sitron', 'lime', 'avokado', 'bønner', 'sukkererter', 'fersk',
];

const RISKY_WORDS = [
  'saus', 'dressing', 'marinade', 'ketchup', 'pålegg', 'ferdigrett', 'ferdigmat', 'panert',
  'pølse', 'kjøttkaker', 'sirup', 'glaze', 'dip', 'chutney', 'syltet', 'krydderblanding',
  'buljong', 'fond', 'suppe', 'gryte', 'wokssaus', 'woksaus', 'smoothie', 'juice', 'yoghurt',
];

const hasWord = (text, words) => {
  const s = String(text || '').toLowerCase();
  return words.some(w => s.includes(w));
};

const looksFresh = text => hasWord(text, FRESH_WORDS) && !hasWord(text, RISKY_WORDS);
const looksRisky = text => hasWord(text, RISKY_WORDS);

/* ============================ JSON ut av modellsvar ============================ */

function extractJson(text) {
  if (!text) return null;
  let s = String(text).trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(s); } catch { /* faller gjennom til skanning */ }

  const start = s.search(/[[{]/);
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

const textBlocks = data =>
  (data?.content || []).filter(b => b.type === 'text').map(b => b.text || '').join('\n');

function mcpResultPayloads(data) {
  const out = [];
  for (const b of data?.content || []) {
    if (b.type !== 'mcp_tool_result') continue;
    const inner = Array.isArray(b.content) ? b.content : [b.content].filter(Boolean);
    for (const c of inner) {
      const parsed = extractJson(typeof c === 'string' ? c : c?.text);
      if (parsed) out.push(parsed);
    }
  }
  return out;
}

/* ============================ API-laget ============================ */

class ApiError extends Error {
  constructor(kind, message, status) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

function classify(status, payload, raw, sentTools) {
  const msg = String(payload?.error?.message || raw || '').toLowerCase();
  if (status === 401 || status === 403) {
    return new ApiError('auth', 'Oda ikke tilkoblet — koble til på nytt i Innstillinger → Koblinger.', status);
  }
  if (status === 429) {
    return new ApiError('rate', 'For mange forespørsler akkurat nå. Vent litt og prøv igjen.', status);
  }
  if (status === 400 && sentTools && (msg.includes('web_fetch') || msg.includes('tool'))) {
    return new ApiError('web_fetch_blocked', 'web_fetch er ikke tillatt herfra.', status);
  }
  if (status === 400 && msg.includes('mcp_servers')) {
    return new ApiError('mcp_blocked', 'Plattformen blokkerer Oda-tilkoblingen fra artefakter (mcp_servers).', status);
  }
  if (status >= 500) {
    return new ApiError('server', 'Serverfeil hos Anthropic. Prøv igjen om litt.', status);
  }
  return new ApiError('other', payload?.error?.message || `Uventet feil (HTTP ${status}).`, status);
}

async function callApi(body) {
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError('network', 'Nettverksfeil — fikk ikke kontakt med API-et.');
  }
  const raw = await res.text();
  let data = null;
  try { data = JSON.parse(raw); } catch { /* ikke-JSON feilside */ }
  if (!res.ok) throw classify(res.status, data, raw, Boolean(body.tools));
  if (data?.stop_reason === 'max_tokens') {
    throw new ApiError('truncated', 'Svaret ble avkuttet — prøv færre middager.');
  }
  return data;
}

/* ============================ prompts ============================ */

const dishShape = `{
  "id": "kort-slug",
  "name": "Rettens navn på norsk",
  "protein": "kylling | storfe | svin | fisk | egg | vegetar",
  "cookMinutes": 30,
  "carbsPerServing": 7.5,
  "estCostNok": 95,
  "servings": 4,
  "ingredients": [
    {"name":"kyllingfilet","amount":600,"unit":"g","pantry":false,"carbsPer100":0}
  ],
  "steps": [
    {"text":"Skjær kyllingen i strimler.","minutes":null,"ingredientRefs":["kyllingfilet"]}
  ],
  "locked": false
}`;

const rules = s => `Regler:
- Alt skal være på norsk (bokmål). Ingen engelske ord i navn, ingredienser eller steg.
- LAVKARBO: hver enkelt ingrediens må ha under ${s.lowCarbMaxG} g karbohydrater per 100 g/ml.
  Ingen poteter, ris, pasta, brød, mel, sukker, mais, belgfrukter eller søte sauser.
  carbsPer100 er ditt beste estimat per ingrediens og er PÅKREVD på alle.
- ${s.servings} porsjoner per rett. Sett "servings": ${s.servings} og oppgi mengder for ${s.servings} porsjoner.
- Enheter: bruk kun g, kg, ml, dl, l, ss, ts, stk, fedd.
- Budsjett: hele uka skal lande under ${s.budgetNok} kr til sammen. estCostNok er kostnaden for hele retten.
- Steg skrives for noen som leser fra mobil midt i matlagingen: ett handlingsverb per steg,
  imperativ, kort. Sett "minutes" når steget innebærer venting (steking, koking, hviling),
  ellers null. ingredientRefs skal inneholde nøyaktig de ingrediensnavnene steget bruker,
  skrevet helt likt som i ingredients-lista.
- Basisvarer brukeren alltid har hjemme (pantry:true): ${s.pantry.join(', ') || 'ingen'}.
${s.constraints ? `- Hensyn/allergier som MÅ respekteres: ${s.constraints}` : ''}
- Innkjøpsmodus: ${s.buyMode}.

Svar med KUN JSON. Ingen forklaring, ingen kodeblokk, ingen tekst før eller etter.`;

function weekPrompt(settings, historyNames, userPrompt) {
  const s = settings;
  return `Du planlegger ${s.dinners} middager for en norsk husholdning.

${rules(s)}

Ekstra krav for hele uka:
- Rettene skal DELE INGREDIENSER for å kutte svinn og pris: minst 3 ikke-pantry
  ingredienser må brukes i to eller flere retter. Del hele pakker (f.eks. samme
  kyllingpakke, samme fløteboks, samme brokkoli) i stedet for å kjøpe smått til hver rett.
- Variasjon i protein og tilberedning på tvers av uka.
${historyNames.length ? `- IKKE gjenta disse rettene fra de siste ukene: ${historyNames.join(', ')}.` : ''}
${userPrompt ? `\nBrukeren ønsker seg: ${userPrompt}` : ''}

Returner et JSON-array med nøyaktig ${s.dinners} objekter på denne formen:
${dishShape}`;
}

function regeneratePrompt(settings, others, dish, userPrompt) {
  const s = settings;
  const pool = [...new Set(others.flatMap(d => d.ingredients.filter(i => !i.pantry).map(i => i.name)))];
  return `Bytt ut én middag i en ukesmeny. Retten som skal erstattes er "${dish.name}".

${rules(s)}

De andre rettene i uka er:
${others.map(d => `- ${d.name} (${d.protein}): ${d.ingredients.map(i => i.name).join(', ')}`).join('\n')}

Krav:
- Den nye retten må være noe annet enn "${dish.name}" og de andre rettene over.
- Gjenbruk så mange som mulig av disse ingrediensene: ${pool.join(', ')}.
  Minst to av dem skal inngå, slik at ingen pakke blir liggende ubrukt.
${userPrompt ? `- Brukeren ønsker seg: ${userPrompt}` : ''}

Returner ETT JSON-objekt (ikke array) på denne formen:
${dishShape}`;
}

const MATCH_SYSTEM = `Du er en innkjøpsassistent for Oda.

Du har KUN lov til å kalle verktøyet product_search. Du skal ikke under noen
omstendighet kalle manipulate_cart, clear_cart, select_delivery_slot eller noe
annet verktøy som endrer handlekurven, lister eller leveringen. Ingen endringer.

Kall product_search med inntil 10 søk (queries) per kall og size 5.
Hopp over produkter der availability.isAvailable er false.
Svar til slutt med KUN JSON — ingen forklaring, ingen kodeblokk.`;

function matchPrompt(items, buyMode) {
  const modeRule = buyMode === 'cheapest'
    ? 'Velg produktet med lavest pris per kilo/liter (unitPrice).'
    : buyMode === 'tilbud'
      ? 'Velg billig per kilo/liter, men ta med alternativer som kan være på tilbud — tilbud sjekkes i neste steg.'
      : 'Velg pakkestørrelsen som ligger nærmest behovet, og et vanlig, gjenkjennelig merke. Unngå unødvendig store pakker.';

  return `Finn varer på Oda til denne handlelista. Behovet er summert for hele uka.

${items.map((it, n) => `${n + 1}. ${it.name} — trenger ${fmtAmount(it.amount)} ${it.unit}${it.note ? ` (${it.note})` : ''}`).join('\n')}

Slik gjør du det:
- Søk opp alle varene med product_search, inntil 10 søk per kall, size 5.
- ${modeRule}
- For hver vare: velg ett hovedprodukt og inntil 2 alternativer.
- Pakkestørrelse står som fritekst i "description", f.eks. "Saktevoksende kylling, 950 g".
  Les tallet og enheten derfra og regn antall = avrundet opp (behov / pakkestørrelse).
  Eksempel: 400 g behov og 950 g pakke gir antall 1. 900 g behov og 400 g pakke gir antall 3.
- Finner du ingenting brukbart, sett productId til null og status "not_found".

Returner KUN et JSON-array, ett objekt per vare, i samme rekkefølge:
[{
  "ingredient": "kyllingfilet",
  "neededAmount": 900, "neededUnit": "g",
  "productId": 12345, "productName": "Kyllingfilet", "packSize": "950 g",
  "qty": 1, "unitPriceNok": 129.9, "totalNok": 129.9,
  "alternatives": [{"productId":222,"productName":"Kyllingfilet økologisk","packSize":"400 g","price":89.9}],
  "productUrl": "https://oda.com/no/products/12345-...",
  "status": "matched"
}]`;
}

function enrichPrompt(needCarbs, offersOnly) {
  const all = [...new Set([...needCarbs, ...offersOnly])];
  // Feltstiene under er lest av faktiske svar fra endepunktet (id 8816, 21466,
  // 66234). Merk: detailed_info.local er et ARRAY av språk, og alle priser er
  // strenger ("41.70"). Begge deler er lette å ta feil av.
  return `Hent produktdata fra Oda sitt offentlige produkt-API.

For hver id under, hent https://oda.com/api/v1/products/{id}/ og les ut:
- carbsPer100: detailed_info.local er en LISTE over språkvarianter. Bruk den med
  language "nb" (ellers den første). I den: nutrition_info_table.rows — finn raden
  der key er "Karbohydrater" og les tallet ut av value ("4.90 g" gir 4.9).
  Mangler detailed_info, local-lista eller nutrition_info_table, returner null.
  Ikke gjett, og ikke bruk "hvorav sukkerarter".
- discounted: discount.is_discounted. Feltet discount er null når varen ikke er
  på tilbud — da er discounted false og alle tilbudsfeltene null.
- price: gross_price. Dette er en STRENG ("120.72") — returner den som tall.
- undiscountedPrice: discount.undiscounted_gross_price, også streng — som tall, ellers null.
- offerText: discount.description_short ("-20%", "Kjøp 3, få 5%"),
  ellers promotions[0].title, ellers null
- offerType: discount.discount_type, ellers null
- maxQty: discount.maximum_quantity, ellers null

Ider som trenger både karbohydrater og tilbud: ${needCarbs.join(', ') || 'ingen'}
Ider der karbohydrater allerede er kjent — sett carbsPer100 til null for disse, men hent tilbudsfeltene: ${offersOnly.join(', ') || 'ingen'}

Returner KUN et JSON-array med ett objekt per id (${all.length} objekter), ingen forklaring:
[{"productId":8816,"carbsPer100":4.9,"discounted":true,"price":39.9,"undiscountedPrice":49.9,"offerText":"-20%","offerType":"percentage","maxQty":null}]`;
}

const CART_SYSTEM = `Du legger varer i brukerens Oda-handlekurv.

Du har KUN lov til å kalle manipulate_cart, og bare for å LEGGE TIL nøyaktig de
product_id-ene og antallene du får oppgitt. Ikke legg til noe annet. Ikke endre
eller fjern eksisterende varer. Kall aldri clear_cart. Book aldri leveringstid.

Svar til slutt med KUN JSON — ingen forklaring, ingen kodeblokk.`;

const cartPrompt = lines => `Legg disse varene i handlekurven på Oda, nøyaktig som oppgitt:

${lines.map(l => `- product_id ${l.productId}, antall ${l.qty} (${l.name})`).join('\n')}

Legg til akkurat disse og ingenting mer. Rør ingen andre varer i kurven.

Returner KUN JSON:
{"added":[{"productId":123,"qty":2}],"failed":[{"productId":456,"reason":"utsolgt"}]}`;

/* ============================ ukeslogikk ============================ */

function normalizeDish(raw, settings) {
  const servings = Number(raw?.servings) > 0 ? Number(raw.servings) : settings.servings;
  const pantrySet = new Set(settings.pantry.map(p => p.toLowerCase().trim()));
  return {
    id: String(raw?.id || uid()),
    name: String(raw?.name || 'Uten navn'),
    protein: String(raw?.protein || 'ukjent'),
    cookMinutes: Number(raw?.cookMinutes) || 0,
    carbsPerServing: Number(raw?.carbsPerServing) || 0,
    estCostNok: Number(raw?.estCostNok) || 0,
    servings,
    locked: Boolean(raw?.locked),
    ingredients: (Array.isArray(raw?.ingredients) ? raw.ingredients : []).map(i => ({
      name: String(i?.name || '').trim(),
      amount: Number(i?.amount) || 0,
      unit: String(i?.unit || 'stk').trim(),
      pantry: Boolean(i?.pantry) || pantrySet.has(String(i?.name || '').toLowerCase().trim()),
      carbsPer100: i?.carbsPer100 == null ? null : Number(i.carbsPer100),
    })).filter(i => i.name),
    steps: (Array.isArray(raw?.steps) ? raw.steps : []).map(s => ({
      text: String(s?.text || '').trim(),
      minutes: s?.minutes == null ? null : Number(s.minutes) || null,
      ingredientRefs: Array.isArray(s?.ingredientRefs) ? s.ingredientRefs.map(String) : [],
    })).filter(s => s.text),
  };
}

/** Skalerer mengder og kostnad i selve retten, slik at Dish-typen forblir sann. */
function rescaleDish(dish, newServings) {
  const factor = newServings / (dish.servings || 1);
  if (!Number.isFinite(factor) || factor <= 0) return dish;
  return {
    ...dish,
    servings: newServings,
    estCostNok: dish.estCostNok * factor,
    ingredients: dish.ingredients.map(i => ({ ...i, amount: i.amount * factor })),
  };
}

/** Ingredienser som går igjen i to eller flere retter (ikke basisvarer). */
function overlapCount(dishes) {
  const counts = new Map();
  for (const d of dishes) {
    const seen = new Set();
    for (const i of d.ingredients) {
      if (i.pantry) continue;
      const k = i.name.toLowerCase().trim();
      if (seen.has(k)) continue;
      seen.add(k);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  return [...counts.values()].filter(n => n >= 2).length;
}

function distinctIngredients(dishes) {
  const s = new Set();
  for (const d of dishes) for (const i of d.ingredients) if (!i.pantry) s.add(i.name.toLowerCase().trim());
  return s.size;
}

/** Slår sammen ukas ingredienser. Basisvarer faller ut, mengder summeres per basisenhet. */
function consolidate(dishes, settings) {
  const pantrySet = new Set(settings.pantry.map(p => p.toLowerCase().trim()));
  const map = new Map();
  for (const d of dishes) {
    for (const i of d.ingredients) {
      const name = i.name.trim();
      const low = name.toLowerCase();
      if (i.pantry || pantrySet.has(low)) continue;
      const b = toBase(i.amount, i.unit);
      const key = `${low}|${b ? b.base : i.unit.toLowerCase()}`;
      const prev = map.get(key);
      if (prev) {
        prev.amount += b ? b.amount : i.amount;
        if (!prev.dishes.includes(d.name)) prev.dishes.push(d.name);
        if (i.carbsPer100 != null) prev.carbsEstimate = Math.max(prev.carbsEstimate ?? 0, i.carbsPer100);
      } else {
        map.set(key, {
          name,
          amount: b ? b.amount : i.amount,
          unit: b ? baseLabel(b.base) : i.unit,
          dishes: [d.name],
          carbsEstimate: i.carbsPer100 == null ? null : i.carbsPer100,
        });
      }
    }
  }
  return [...map.values()]
    .map(x => ({ ...x, amount: Math.round(x.amount * 100) / 100, note: x.dishes.length > 1 ? `til ${x.dishes.length} retter` : '' }))
    .sort((a, b) => a.name.localeCompare(b.name, 'nb'));
}

/* ============================ treff og rangering ============================ */

function normalizeMatch(raw, item) {
  const packText = String(raw?.packSize || '');
  const price = Number(raw?.unitPriceNok ?? raw?.price) || 0;
  const needed = Number(raw?.neededAmount ?? item?.amount) || 0;
  const unit = String(raw?.neededUnit || item?.unit || 'stk');
  const computed = packMath(needed, unit, packText);
  const modelQty = Number(raw?.qty);
  // Modellens antall godtas bare når vi ikke kan regne det selv.
  const qty = computed.comparable ? computed.qty : (modelQty > 0 ? Math.round(modelQty) : 1);
  const productId = raw?.productId == null ? null : Number(raw.productId);
  const status = raw?.status === 'skipped' ? 'skipped' : (productId ? 'matched' : 'not_found');
  return {
    ingredient: String(raw?.ingredient || item?.name || ''),
    neededAmount: needed,
    neededUnit: unit,
    productId: Number.isFinite(productId) ? productId : null,
    productName: String(raw?.productName || ''),
    packSize: packText,
    qty,
    unitPriceNok: price,
    totalNok: Math.round(price * qty * 100) / 100,
    alternatives: (Array.isArray(raw?.alternatives) ? raw.alternatives : []).slice(0, 4).map(a => ({
      productId: a?.productId == null ? null : Number(a.productId),
      productName: String(a?.productName || ''),
      packSize: String(a?.packSize || ''),
      price: Number(a?.price) || 0,
    })).filter(a => a.productId),
    productUrl: raw?.productUrl ? String(raw.productUrl) : (productId ? `https://oda.com/no/products/${productId}/` : null),
    carbsPer100: undefined,
    carbsSource: null,
    discounted: false,
    undiscountedPrice: null,
    offerText: null,
    offerType: null,
    maxQty: null,
    surplus: computed.surplus,
    surplusUnit: computed.base ? baseLabel(computed.base) : null,
    dishes: item?.dishes || [],
    status,
  };
}

/** Berging når modellens JSON er ødelagt: plukk produkter rett ut av verktøysvarene. */
function salvageMatches(data, items) {
  const products = [];
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (node.id != null && typeof node.name === 'string' && (node.price != null || node.unitPrice != null)) {
      products.push(node);
    }
    Object.values(node).forEach(visit);
  };
  mcpResultPayloads(data).forEach(visit);
  if (!products.length) return null;

  const score = (query, name) => {
    const q = query.toLowerCase().split(/\s+/).filter(Boolean);
    const n = String(name).toLowerCase();
    return q.reduce((acc, w) => acc + (n.includes(w) ? w.length : 0), 0);
  };

  return items.map(it => {
    const ranked = products
      .map(p => ({ p, s: score(it.name, p.name) }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s);
    if (!ranked.length) {
      return normalizeMatch({ ingredient: it.name, neededAmount: it.amount, neededUnit: it.unit, status: 'not_found' }, it);
    }
    const best = ranked[0].p;
    return normalizeMatch({
      ingredient: it.name,
      neededAmount: it.amount,
      neededUnit: it.unit,
      productId: best.id,
      productName: best.name,
      packSize: best.description || '',
      unitPriceNok: Number(best.price) || 0,
      productUrl: best.url,
      alternatives: ranked.slice(1, 3).map(x => ({
        productId: x.p.id, productName: x.p.name, packSize: x.p.description || '', price: Number(x.p.price) || 0,
      })),
      status: 'matched',
    }, it);
  });
}

/** Sammenlignbar enhetspris: pris per g/ml/stk når pakken lar seg lese. */
function perUnit(price, packText) {
  const pack = parsePackSize(packText);
  if (!pack || !pack.amount) return null;
  return { value: price / pack.amount, base: pack.base };
}

/**
 * Tilbud-modus. Et tilbud vinner bare når den rabatterte enhetsprisen er innen
 * 15 % av den billigste — ellers vinner billigst, og tilbudet vises som merke.
 */
function rerankForTilbud(match) {
  if (!match.productId) return match;
  const cands = [
    { productId: match.productId, productName: match.productName, packSize: match.packSize, price: match.unitPriceNok, discounted: match.discounted, offerText: match.offerText, offerType: match.offerType, maxQty: match.maxQty, undiscountedPrice: match.undiscountedPrice, carbsPer100: match.carbsPer100, carbsSource: match.carbsSource, productUrl: match.productUrl },
    ...match.alternatives.map(a => ({ ...a, price: a.price, discounted: Boolean(a.discounted), offerText: a.offerText ?? null, offerType: a.offerType ?? null, maxQty: a.maxQty ?? null, undiscountedPrice: a.undiscountedPrice ?? null, carbsPer100: a.carbsPer100, carbsSource: a.carbsSource ?? null, productUrl: a.productUrl ?? null })),
  ];
  const keyed = cands.map(c => {
    const pu = perUnit(c.price, c.packSize);
    return { c, key: pu ? pu.value : c.price, base: pu ? pu.base : null };
  });
  const bases = new Set(keyed.map(k => k.base));
  const comparable = bases.size === 1 && !bases.has(null);
  const cheapest = Math.min(...keyed.map(k => k.key));

  const sorted = [...keyed].sort((a, b) => {
    const aWins = a.c.discounted && (!comparable || a.key <= cheapest * 1.15);
    const bWins = b.c.discounted && (!comparable || b.key <= cheapest * 1.15);
    if (aWins !== bWins) return aWins ? -1 : 1;
    return a.key - b.key;
  });

  const [winner, ...rest] = sorted.map(k => k.c);
  if (!winner || winner.productId === match.productId) return match;
  return applyChoice(match, winner, rest);
}

function applyChoice(match, chosen, others) {
  const computed = packMath(match.neededAmount, match.neededUnit, chosen.packSize);
  const qty = computed.comparable ? computed.qty : match.qty;
  return {
    ...match,
    productId: chosen.productId,
    productName: chosen.productName,
    packSize: chosen.packSize,
    unitPriceNok: chosen.price,
    qty,
    totalNok: Math.round(chosen.price * qty * 100) / 100,
    productUrl: chosen.productUrl || `https://oda.com/no/products/${chosen.productId}/`,
    carbsPer100: chosen.carbsPer100,
    carbsSource: chosen.carbsSource ?? null,
    discounted: Boolean(chosen.discounted),
    undiscountedPrice: chosen.undiscountedPrice ?? null,
    offerText: chosen.offerText ?? null,
    offerType: chosen.offerType ?? null,
    maxQty: chosen.maxQty ?? null,
    surplus: computed.surplus,
    surplusUnit: computed.base ? baseLabel(computed.base) : null,
    alternatives: others.map(o => ({
      productId: o.productId, productName: o.productName, packSize: o.packSize, price: o.price,
      discounted: o.discounted, offerText: o.offerText, offerType: o.offerType,
      maxQty: o.maxQty, undiscountedPrice: o.undiscountedPrice,
      carbsPer100: o.carbsPer100, carbsSource: o.carbsSource, productUrl: o.productUrl,
    })),
    status: 'matched',
  };
}

/** "Kjøp 3, få 5%" — foreslå avrunding når vi er én unna terskelen. */
function multiBuyHint(match) {
  if (!match.offerText) return null;
  const m = /kj[øo]p\s+(\d+)/i.exec(match.offerText);
  if (!m) return null;
  const threshold = parseInt(m[1], 10);
  if (!threshold || match.qty >= threshold) return null;
  const delta = threshold - match.qty;
  if (delta > 1) return null;
  return { threshold, delta, extraCost: Math.round(match.unitPriceNok * delta * 100) / 100 };
}

const carbVerdict = (match, limit) => {
  if (match.carbsPer100 === undefined) return 'unknown';
  if (match.carbsPer100 === null) {
    return looksFresh(`${match.ingredient} ${match.productName}`) ? 'fresh' : 'unknown';
  }
  return match.carbsPer100 <= limit ? 'pass' : 'fail';
};

const isBlocking = (match, limit) => match.status === 'matched' && carbVerdict(match, limit) === 'fail';

/* ============================ små UI-biter ============================ */

function Spinner({ label }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-500">
      <Loader2 className="w-4 h-4 animate-spin" />
      <span>{label}</span>
    </div>
  );
}

function Banner({ error, onClose }) {
  if (!error) return null;
  const tone = error.kind === 'auth' || error.kind === 'mcp_blocked'
    ? 'bg-red-50 border-red-200 text-red-800'
    : 'bg-amber-50 border-amber-200 text-amber-900';
  return (
    <div className={`flex items-start gap-2 border rounded-lg p-3 text-sm ${tone}`}>
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="break-words">{error.message}</p>
        {error.kind === 'mcp_blocked' && (
          <p className="mt-1 text-xs">Dette er en plattformsperre — ingenting du kan fikse i appen.</p>
        )}
      </div>
      {onClose && (
        <button onClick={onClose} className="shrink-0 p-1" aria-label="Lukk">
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

function Stepper({ value, onChange, min = 1, max = 99, label }) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onChange(Math.max(min, value - 1))}
        className="w-9 h-9 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center active:bg-slate-300"
        aria-label={`Færre ${label}`}
      >
        <Minus className="w-4 h-4" />
      </button>
      <span className="w-10 text-center font-semibold tabular-nums">{value}</span>
      <button
        onClick={() => onChange(Math.min(max, value + 1))}
        className="w-9 h-9 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center active:bg-slate-300"
        aria-label={`Flere ${label}`}
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
}

function CarbBadge({ match, limit, webFetchOk }) {
  const verdict = carbVerdict(match, limit);
  if (verdict === 'pass') {
    return <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-xs font-medium">{g(match.carbsPer100)}</span>;
  }
  if (verdict === 'fail') {
    return <span className="px-2 py-0.5 rounded bg-red-100 text-red-800 text-xs font-medium">{g(match.carbsPer100)}</span>;
  }
  if (verdict === 'fresh') {
    return <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 text-xs">fersk, ingen tabell</span>;
  }
  return (
    <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-600 text-xs">
      {webFetchOk === false ? 'estimat' : '?'}
    </span>
  );
}

/* ============================ Uke ============================ */

function DishCard({ dish, onOpen, onToggleLock, onSwap, swapping, limit }) {
  const overLimit = dish.ingredients.some(i => i.carbsPer100 != null && i.carbsPer100 > limit);
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3">
      <button onClick={onOpen} className="w-full text-left">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-slate-900 leading-snug">{dish.name}</h3>
          <ChevronRight className="w-5 h-5 text-slate-400 shrink-0 mt-0.5" />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
          <span className="capitalize">{dish.protein}</span>
          <span>{nf0.format(dish.cookMinutes)} min</span>
          <span className={overLimit ? 'text-red-700 font-medium' : ''}>
            {nf1.format(dish.carbsPerServing)} g karbo/porsjon
          </span>
          <span>{kr0(dish.estCostNok)}</span>
        </div>
        {overLimit && (
          <p className="mt-2 text-xs text-red-700 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> En ingrediens er over karbogrensen
          </p>
        )}
      </button>
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={onToggleLock}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm ${dish.locked ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-700'}`}
        >
          {dish.locked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
          {dish.locked ? 'Låst' : 'Lås'}
        </button>
        <button
          onClick={onSwap}
          disabled={dish.locked || swapping}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm bg-slate-100 text-slate-700 disabled:opacity-40"
        >
          {swapping ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Bytt
        </button>
      </div>
    </div>
  );
}

function WeekTab({ week, settings, onOpenDish, onGenerate, onSwap, onToggleLock, busy, swapId, prompt, setPrompt, error, clearError, realTotal }) {
  const dishes = week?.dishes || [];
  const est = dishes.reduce((a, d) => a + (d.estCostNok || 0), 0);
  const total = realTotal ?? est;
  const over = total > settings.budgetNok;
  const pct = Math.min(100, Math.round((total / Math.max(1, settings.budgetNok)) * 100));

  return (
    <div className="p-3 space-y-3">
      <Banner error={error} onClose={clearError} />

      <div className="bg-white rounded-xl border border-slate-200 p-3">
        <label className="block text-sm font-medium text-slate-700 mb-1">Hva har du lyst på denne uka?</label>
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          rows={2}
          placeholder="Valgfritt — f.eks. «noe asiatisk, og gjerne laks én dag»"
          className="w-full rounded-lg border border-slate-300 p-2 text-sm"
        />
        <button
          onClick={onGenerate}
          disabled={busy}
          className="mt-2 w-full bg-emerald-600 text-white rounded-lg py-3 font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {busy ? 'Lager ukesmeny…' : 'Lag ukesmeny'}
        </button>
        {dishes.some(d => d.locked) && !busy && (
          <p className="mt-2 text-xs text-slate-500">
            {dishes.filter(d => d.locked).length} låste retter beholdes.
          </p>
        )}
      </div>

      {dishes.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-slate-600">
              {realTotal != null ? 'Reell sum fra Oda' : 'Estimert sum'}
            </span>
            <span className={`font-semibold ${over ? 'text-red-700' : 'text-slate-900'}`}>
              {kr0(total)} / {kr0(settings.budgetNok)}
            </span>
          </div>
          <div className="mt-2 h-2 w-full bg-slate-200 rounded-full overflow-hidden">
            <div className={`h-full ${over ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
            <span>{distinctIngredients(dishes)} ulike varer</span>
            <span>{overlapCount(dishes)} går igjen i flere retter</span>
          </div>
          {realTotal == null && (
            <p className="mt-2 text-xs text-slate-500">
              Estimat fra oppskriftene. Handlekurven viser den reelle summen.
            </p>
          )}
        </div>
      )}

      {dishes.map(d => (
        <DishCard
          key={d.id}
          dish={d}
          limit={settings.lowCarbMaxG}
          swapping={swapId === d.id}
          onOpen={() => onOpenDish(d.id)}
          onToggleLock={() => onToggleLock(d.id)}
          onSwap={() => onSwap(d.id)}
        />
      ))}

      {!dishes.length && !busy && (
        <p className="text-center text-sm text-slate-500 py-8">
          Ingen ukesmeny ennå. Trykk «Lag ukesmeny».
        </p>
      )}
    </div>
  );
}

/* ============================ Oppskrift ============================ */

function RecipeView({ dish, settings, onBack, onServings, onCook }) {
  if (!dish) return null;
  return (
    <div className="p-3 space-y-3">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-slate-600">
        <ChevronLeft className="w-4 h-4" /> Tilbake til uka
      </button>

      <div className="bg-white rounded-xl border border-slate-200 p-3">
        <h2 className="text-lg font-bold text-slate-900">{dish.name}</h2>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
          <span className="capitalize">{dish.protein}</span>
          <span>{nf0.format(dish.cookMinutes)} min</span>
          <span>{nf1.format(dish.carbsPerServing)} g karbo/porsjon</span>
          <span>{kr0(dish.estCostNok)}</span>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-sm text-slate-700">Porsjoner</span>
          <Stepper value={dish.servings} onChange={onServings} min={1} max={12} label="porsjoner" />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-3">
        <h3 className="font-semibold text-slate-900 mb-2">Ingredienser</h3>
        <ul className="space-y-1.5">
          {dish.ingredients.map((i, n) => {
            const over = i.carbsPer100 != null && i.carbsPer100 > settings.lowCarbMaxG;
            return (
              <li key={n} className="flex items-baseline justify-between gap-2 text-sm">
                <span className={over ? 'text-red-700' : 'text-slate-800'}>
                  {i.name}
                  {i.pantry && <span className="ml-1 text-xs text-slate-400">(har hjemme)</span>}
                  {over && <span className="ml-1 text-xs">({g(i.carbsPer100)}/100)</span>}
                </span>
                <span className="text-slate-600 tabular-nums shrink-0">
                  {fmtAmount(i.amount)} {i.unit}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-3">
        <h3 className="font-semibold text-slate-900 mb-2">Slik gjør du</h3>
        <ol className="space-y-2">
          {dish.steps.map((s, n) => (
            <li key={n} className="flex gap-2 text-sm text-slate-800">
              <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 text-xs flex items-center justify-center shrink-0">
                {n + 1}
              </span>
              <span>
                {s.text}
                {s.minutes ? <span className="ml-1 text-xs text-slate-500">({s.minutes} min)</span> : null}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <button onClick={onCook} className="w-full bg-emerald-600 text-white rounded-lg py-3 font-semibold">
        Start matlaging
      </button>
    </div>
  );
}

/* ============================ Kokk ============================ */

function StepTimer({ minutes }) {
  const [left, setLeft] = useState(null);
  const ref = useRef(null);

  useEffect(() => () => clearInterval(ref.current), []);
  useEffect(() => { setLeft(null); clearInterval(ref.current); }, [minutes]);

  const start = () => {
    clearInterval(ref.current);
    setLeft(Math.round(minutes * 60));
    ref.current = setInterval(() => {
      setLeft(v => {
        if (v == null) return v;
        if (v <= 1) { clearInterval(ref.current); return 0; }
        return v - 1;
      });
    }, 1000);
  };

  const stop = () => { clearInterval(ref.current); setLeft(null); };

  if (left == null) {
    return (
      <button onClick={start} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 text-white text-base">
        <TimerIcon className="w-5 h-5" /> Timer {minutes} min
      </button>
    );
  }
  const mm = String(Math.floor(left / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');
  return (
    <div className="flex items-center gap-3">
      <span className={`text-2xl font-bold tabular-nums ${left === 0 ? 'text-emerald-600' : 'text-slate-900'}`}>
        {left === 0 ? 'Ferdig!' : `${mm}:${ss}`}
      </span>
      <button onClick={stop} className="px-3 py-2 rounded-lg bg-slate-200 text-slate-700 text-sm">Nullstill</button>
      <span className="text-xs text-slate-500">Går bare mens appen er åpen</span>
    </div>
  );
}

function CookTab({ dish, stepIndex, onStep, onPickDish, dishes }) {
  if (!dish) {
    return (
      <div className="p-3 space-y-3">
        <p className="text-sm text-slate-600">Velg en rett å lage.</p>
        {dishes.map(d => (
          <button
            key={d.id}
            onClick={() => onPickDish(d.id)}
            className="w-full text-left bg-white border border-slate-200 rounded-xl p-3"
          >
            <span className="font-medium text-slate-900">{d.name}</span>
            <span className="block text-xs text-slate-500">{nf0.format(d.cookMinutes)} min</span>
          </button>
        ))}
        {!dishes.length && <p className="text-sm text-slate-500">Lag en ukesmeny først.</p>}
      </div>
    );
  }

  const steps = dish.steps;
  const idx = Math.min(Math.max(0, stepIndex), Math.max(0, steps.length - 1));
  const step = steps[idx];
  if (!step) return <p className="p-3 text-sm text-slate-500">Denne retten har ingen steg.</p>;

  const refs = step.ingredientRefs
    .map(r => dish.ingredients.find(i => i.name.toLowerCase().trim() === String(r).toLowerCase().trim()))
    .filter(Boolean);

  return (
    <div className="flex flex-col min-h-screen">
      <div className="p-3 border-b border-slate-200 bg-white">
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span className="font-medium truncate">{dish.name}</span>
          <span className="shrink-0">Steg {idx + 1} av {steps.length}</span>
        </div>
        <div className="mt-2 h-2 w-full bg-slate-200 rounded-full overflow-hidden">
          <div className="h-full bg-emerald-500" style={{ width: `${((idx + 1) / steps.length) * 100}%` }} />
        </div>
      </div>

      <div className="flex-1 p-4 space-y-5">
        {refs.length > 0 && (
          <div className="bg-slate-100 rounded-xl p-3">
            <p className="text-sm text-slate-500 mb-1">Til dette steget</p>
            <ul className="space-y-1">
              {refs.map((i, n) => (
                <li key={n} className="flex justify-between gap-3 text-xl text-slate-900">
                  <span>{i.name}</span>
                  <span className="tabular-nums shrink-0">{fmtAmount(i.amount)} {i.unit}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-2xl leading-relaxed text-slate-900">{step.text}</p>

        {step.minutes ? <StepTimer minutes={step.minutes} /> : null}
      </div>

      <div className="sticky bottom-16 p-3 bg-white border-t border-slate-200 flex gap-3">
        <button
          onClick={() => onStep(idx - 1)}
          disabled={idx === 0}
          className="flex-1 py-4 rounded-xl bg-slate-200 text-slate-800 text-xl font-semibold disabled:opacity-40"
        >
          Forrige
        </button>
        <button
          onClick={() => onStep(idx + 1)}
          disabled={idx >= steps.length - 1}
          className="flex-1 py-4 rounded-xl bg-emerald-600 text-white text-xl font-semibold disabled:opacity-40"
        >
          Neste
        </button>
      </div>
    </div>
  );
}

/* ============================ Handlekurv ============================ */

function MatchRow({ match, limit, webFetchOk, onQty, onPick, onSkip, onUnskip, onRetry }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const verdict = carbVerdict(match, limit);
  const blocked = verdict === 'fail';
  const hint = multiBuyHint(match);
  const risky = webFetchOk === false && looksRisky(`${match.ingredient} ${match.productName}`);

  if (match.status === 'skipped') {
    return (
      <div className="bg-slate-50 rounded-xl border border-slate-200 p-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-slate-500 line-through truncate">{match.ingredient}</p>
          <p className="text-xs text-slate-500">Har hjemme</p>
        </div>
        <button onClick={onUnskip} className="text-sm text-slate-600 px-3 py-1.5 rounded-lg bg-slate-200 shrink-0">
          Angre
        </button>
      </div>
    );
  }

  return (
    <div className={`bg-white rounded-xl border p-3 ${blocked ? 'border-red-300' : 'border-slate-200'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-slate-900">{match.ingredient}</p>
          <p className="text-xs text-slate-500">
            Trenger {fmtAmount(match.neededAmount)} {match.neededUnit}
            {match.dishes.length > 1 ? ` · ${match.dishes.length} retter` : ''}
          </p>
        </div>
        <button onClick={onSkip} className="text-xs text-slate-500 px-2 py-1 rounded bg-slate-100 shrink-0">
          Har hjemme
        </button>
      </div>

      {match.status === 'not_found' ? (
        <div className="mt-2">
          <p className="text-sm text-amber-700">Ikke funnet</p>
          <div className="mt-2 flex gap-2">
            <input
              value={term}
              onChange={e => setTerm(e.target.value)}
              placeholder="Søk med egne ord"
              className="flex-1 min-w-0 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
            <button
              onClick={() => term.trim() && onRetry(term.trim())}
              className="px-3 py-1.5 rounded-lg bg-slate-800 text-white text-sm flex items-center gap-1 shrink-0"
            >
              <Search className="w-4 h-4" /> Søk
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-2 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm text-slate-800 break-words">{match.productName}</p>
              <p className="text-xs text-slate-500">{match.packSize || 'ukjent pakke'}</p>
            </div>
            <div className="text-right shrink-0">
              {match.discounted && match.undiscountedPrice ? (
                <p className="text-xs text-slate-400 line-through">{kr(match.undiscountedPrice)}</p>
              ) : null}
              <p className="font-semibold text-slate-900">{kr(match.totalNok)}</p>
              <p className="text-xs text-slate-500">{kr(match.unitPriceNok)} × {match.qty}</p>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <CarbBadge match={match} limit={limit} webFetchOk={webFetchOk} />
            {match.offerText && (
              <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 text-xs font-medium flex items-center gap-1">
                <Tag className="w-3 h-3" />{match.offerText}
              </span>
            )}
            {match.surplus != null && match.surplus > 0 && (
              <span className="text-xs text-slate-500">
                overskudd {fmtAmount(match.surplus)} {match.surplusUnit}
              </span>
            )}
            {match.productUrl && (
              <a
                href={match.productUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-slate-500 flex items-center gap-1"
              >
                Oda <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>

          {blocked && (
            <p className="mt-2 text-xs text-red-700">
              Over karbogrensen ({g(match.carbsPer100)}/100). Velg et alternativ eller merk «har hjemme».
            </p>
          )}
          {verdict === 'unknown' && risky && (
            <p className="mt-2 text-xs text-slate-600">Sjekk næringsinnhold i Oda før du handler.</p>
          )}
          {hint && (
            <p className="mt-2 text-xs text-amber-800">
              {hint.threshold} stk utløser tilbudet — {hint.delta} til koster {kr(hint.extraCost)}.
              <button onClick={() => onQty(match.qty + hint.delta)} className="ml-2 underline">Rund opp</button>
            </p>
          )}

          <div className="mt-3 flex items-center justify-between gap-2">
            <Stepper value={match.qty} onChange={onQty} min={1} max={30} label="antall" />
            {match.alternatives.length > 0 && (
              <button onClick={() => setOpen(v => !v)} className="text-sm text-slate-600 px-3 py-1.5 rounded-lg bg-slate-100">
                {open ? 'Skjul' : `Alternativer (${match.alternatives.length})`}
              </button>
            )}
          </div>

          {open && (
            <ul className="mt-2 space-y-1.5">
              {match.alternatives.map((a, n) => (
                <li key={n}>
                  <button
                    onClick={() => { onPick(n); setOpen(false); }}
                    className="w-full text-left flex items-start justify-between gap-2 p-2 rounded-lg bg-slate-50"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm text-slate-800 break-words">{a.productName}</span>
                      <span className="block text-xs text-slate-500">{a.packSize || 'ukjent pakke'}</span>
                    </span>
                    <span className="text-sm text-slate-700 shrink-0">{kr(a.price)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function CartTab({
  cart, settings, week, busy, stageMsg, error, clearError, onFind, onApprove, onSend,
  onQty, onPick, onSkip, onUnskip, onRetry, webFetchOk, cartResult,
}) {
  const matches = cart?.matches || [];
  const active = matches.filter(m => m.status === 'matched');
  const total = active.reduce((a, m) => a + (m.totalNok || 0), 0);
  const blocking = matches.filter(m => isBlocking(m, settings.lowCarbMaxG)).length;
  const approved = cart?.stage === 'approved' || cart?.stage === 'sent';
  const canSend = approved && blocking === 0 && active.length > 0 && !busy;

  return (
    <div className="p-3 space-y-3">
      <Banner error={error} onClose={clearError} />

      {webFetchOk === false && (
        <div className="bg-slate-100 border border-slate-200 rounded-lg p-3 text-xs text-slate-700">
          Karbotall kunne ikke verifiseres mot Oda herfra (web_fetch er blokkert).
          Tallene i ukesmenyen er modellens estimat, ikke kontrollerte verdier.
          Tilbudsmodus er skrudd av av samme grunn.
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-slate-600">{matches.length ? 'Reell sum' : 'Ingen varer ennå'}</span>
          <span className={`font-semibold ${total > settings.budgetNok ? 'text-red-700' : 'text-slate-900'}`}>
            {kr0(total)} / {kr0(settings.budgetNok)}
          </span>
        </div>
        <button
          onClick={onFind}
          disabled={busy || !(week?.dishes || []).length}
          className="mt-3 w-full bg-slate-800 text-white rounded-lg py-3 font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {matches.length ? 'Finn varer på nytt' : 'Finn varer'}
        </button>
        {!(week?.dishes || []).length && (
          <p className="mt-2 text-xs text-slate-500">Lag en ukesmeny først.</p>
        )}
        {busy && stageMsg && <div className="mt-2"><Spinner label={stageMsg} /></div>}
        <p className="mt-2 text-xs text-slate-500">
          Dette steget søker bare opp varer. Ingenting legges i kurven før du godkjenner.
        </p>
      </div>

      {matches.map((m, n) => (
        <MatchRow
          key={`${m.ingredient}-${n}`}
          match={m}
          limit={settings.lowCarbMaxG}
          webFetchOk={webFetchOk}
          onQty={q => onQty(n, q)}
          onPick={ai => onPick(n, ai)}
          onSkip={() => onSkip(n)}
          onUnskip={() => onUnskip(n)}
          onRetry={term => onRetry(n, term)}
        />
      ))}

      {matches.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
          {blocking > 0 && (
            <p className="text-sm text-red-700 flex items-center gap-1">
              <AlertTriangle className="w-4 h-4" />
              {blocking} {blocking === 1 ? 'vare' : 'varer'} over karbogrensen må fikses først.
            </p>
          )}
          <button
            onClick={onApprove}
            disabled={approved || busy}
            className="w-full bg-slate-200 text-slate-800 rounded-lg py-3 font-semibold disabled:opacity-50"
          >
            {approved ? <span className="flex items-center justify-center gap-2"><Check className="w-4 h-4" /> Kurv godkjent</span> : 'Godkjenn kurv'}
          </button>
          <button
            onClick={onSend}
            disabled={!canSend}
            className="w-full bg-emerald-600 text-white rounded-lg py-3 font-semibold flex items-center justify-center gap-2 disabled:opacity-40"
          >
            {busy && approved && <Loader2 className="w-4 h-4 animate-spin" />}
            Legg i Oda-kurv ({active.length})
          </button>
          {!approved && <p className="text-xs text-slate-500">Godkjenn kurven først.</p>}
        </div>
      )}

      {cartResult && (
        <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
          <p className="text-sm font-medium text-slate-900">
            {cartResult.added.length} lagt i kurven
            {cartResult.failed.length ? `, ${cartResult.failed.length} feilet` : ''}
          </p>
          {cartResult.failed.length > 0 && (
            <ul className="text-xs text-red-700 space-y-1">
              {cartResult.failed.map((f, n) => (
                <li key={n}>{f.productName || f.productId}: {f.reason || 'ukjent feil'}</li>
              ))}
            </ul>
          )}
          <a
            href={CART_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm text-emerald-700 font-medium"
          >
            Gå til handlekurven på Oda <ExternalLink className="w-4 h-4" />
          </a>
          <p className="text-xs text-slate-500">Betaling og levering gjøres i Oda, ikke her.</p>
        </div>
      )}
    </div>
  );
}

/* ============================ Innstillinger ============================ */

function SettingsTab({ settings, onChange, webFetchOk }) {
  const [chip, setChip] = useState('');
  const set = patch => onChange({ ...settings, ...patch });

  const addChip = () => {
    const v = chip.trim().toLowerCase();
    if (!v || settings.pantry.includes(v)) { setChip(''); return; }
    set({ pantry: [...settings.pantry, v] });
    setChip('');
  };

  const modes = BUY_MODES.filter(m => m.id !== 'tilbud' || webFetchOk !== false);

  return (
    <div className="p-3 space-y-3">
      <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-800">Porsjoner per middag</p>
            <p className="text-xs text-slate-500">To personer + rester = 4</p>
          </div>
          <Stepper value={settings.servings} onChange={v => set({ servings: v })} min={1} max={12} label="porsjoner" />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-800">Middager per uke</p>
            <p className="text-xs text-slate-500">3–7</p>
          </div>
          <Stepper value={settings.dinners} onChange={v => set({ dinners: v })} min={3} max={7} label="middager" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-800">Ukesbudsjett (kr)</label>
          <input
            type="number"
            value={settings.budgetNok}
            onChange={e => set({ budgetNok: Math.max(0, Number(e.target.value) || 0) })}
            className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-800">Maks karbo per 100 g/ml</label>
          <input
            type="number"
            value={settings.lowCarbMaxG}
            onChange={e => set({ lowCarbMaxG: Math.max(0, Number(e.target.value) || 0) })}
            className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
          />
          <p className="mt-1 text-xs text-slate-500">
            {webFetchOk === false
              ? 'Kan ikke verifiseres mot Oda herfra — grensen brukes bare i prompten.'
              : 'Brukes i prompten og verifiseres mot Odas produktdata i handlekurven.'}
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-3">
        <p className="text-sm font-medium text-slate-800 mb-2">Innkjøpsmodus</p>
        <div className="space-y-2">
          {modes.map(m => (
            <button
              key={m.id}
              onClick={() => set({ buyMode: m.id })}
              className={`w-full text-left p-2 rounded-lg border ${settings.buyMode === m.id ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200'}`}
            >
              <span className="block text-sm font-medium text-slate-800">{m.label}</span>
              <span className="block text-xs text-slate-500">{m.hint}</span>
            </button>
          ))}
        </div>
        {webFetchOk === false && (
          <p className="mt-2 text-xs text-slate-500">
            Tilbudsmodus er skjult: tilbudsdata krever web_fetch, som er blokkert herfra.
          </p>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-3">
        <label className="block text-sm font-medium text-slate-800">Allergier og uvaner</label>
        <textarea
          value={settings.constraints}
          onChange={e => set({ constraints: e.target.value })}
          rows={3}
          placeholder="F.eks. «ingen nøtter, liker ikke kålrot»"
          className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
        />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-3">
        <p className="text-sm font-medium text-slate-800">Har alltid hjemme</p>
        <p className="text-xs text-slate-500 mb-2">Disse holdes utenfor handlelista.</p>
        <div className="flex flex-wrap gap-2">
          {settings.pantry.map(p => (
            <button
              key={p}
              onClick={() => set({ pantry: settings.pantry.filter(x => x !== p) })}
              className="flex items-center gap-1 px-2 py-1 rounded-full bg-slate-100 text-sm text-slate-700"
            >
              {p} <X className="w-3 h-3" />
            </button>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            value={chip}
            onChange={e => setChip(e.target.value)}
            placeholder="Legg til vare"
            className="flex-1 min-w-0 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          />
          <button onClick={addChip} className="px-3 py-1.5 rounded-lg bg-slate-800 text-white text-sm shrink-0">
            Legg til
          </button>
        </div>
      </div>

      <div className="bg-slate-100 rounded-xl p-3 text-xs text-slate-600 space-y-1">
        <p className="font-medium text-slate-700">Verdt å vite</p>
        <p>Estimert kostnad i ukesmenyen er et anslag. Handlekurven viser reelle priser.</p>
        <p>Pakkeavrunding gjør at du ofte kjøper mer enn oppskriften trenger — overskuddet vises per vare.</p>
        <p>Timere varsler ikke; de går bare mens appen er åpen.</p>
        <p>Hver generering er et API-kall. Endringer her slår først inn når du trykker «Lag ukesmeny».</p>
      </div>
    </div>
  );
}

/* ============================ tabbar ============================ */

function TabBar({ tab, onTab }) {
  const items = [
    { id: 'week', label: 'Uke', Icon: CalendarDays },
    { id: 'cook', label: 'Kokk', Icon: ChefHat },
    { id: 'cart', label: 'Handlekurv', Icon: ShoppingCart },
    { id: 'settings', label: 'Innstillinger', Icon: SettingsIcon },
  ];
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex">
      {items.map(({ id, label, Icon }) => (
        <button
          key={id}
          onClick={() => onTab(id)}
          className={`flex-1 py-2 flex flex-col items-center gap-0.5 ${tab === id ? 'text-emerald-600' : 'text-slate-500'}`}
        >
          <Icon className="w-5 h-5" />
          <span className="text-xs">{label}</span>
        </button>
      ))}
    </nav>
  );
}

/* ============================ app ============================ */

export default function Ukesmeny() {
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState('week');
  const [openDishId, setOpenDishId] = useState(null);

  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [week, setWeek] = useState(null);
  const [history, setHistory] = useState([]);
  const [cart, setCart] = useState(null);
  const [carbsCache, setCarbsCache] = useState({});
  const [cook, setCook] = useState({ dishId: null, stepIndex: 0 });

  const [prompt, setPrompt] = useState('');
  const [busyWeek, setBusyWeek] = useState(false);
  const [swapId, setSwapId] = useState(null);
  const [busyCart, setBusyCart] = useState(false);
  const [stageMsg, setStageMsg] = useState('');
  const [weekError, setWeekError] = useState(null);
  const [cartError, setCartError] = useState(null);
  const [cartResult, setCartResult] = useState(null);

  /* ---- oppstart ---- */
  useEffect(() => {
    let alive = true;
    (async () => {
      const [s, w, h, c, cc, ck] = await Promise.all([
        loadJson(KEYS.settings, null),
        loadJson(KEYS.week, null),
        loadJson(KEYS.history, []),
        loadJson(KEYS.cart, null),
        loadJson(KEYS.carbs, {}),
        loadJson(KEYS.cook, null),
      ]);
      if (!alive) return;
      const merged = { ...DEFAULT_SETTINGS, ...(s && typeof s === 'object' ? s : {}) };
      merged.pantry = Array.isArray(merged.pantry) ? merged.pantry : DEFAULT_SETTINGS.pantry;
      setSettings(merged);
      if (w && Array.isArray(w.dishes)) setWeek(w);
      if (Array.isArray(h)) setHistory(h);
      if (c && Array.isArray(c.matches)) setCart(c);
      if (cc && typeof cc === 'object') setCarbsCache(cc);
      if (ck && typeof ck === 'object') setCook({ dishId: ck.dishId ?? null, stepIndex: Number(ck.stepIndex) || 0 });
      if (w?.prompt) setPrompt(w.prompt);
      setLoaded(true);
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => { if (loaded) saveJson(KEYS.settings, settings); }, [settings, loaded]);
  useEffect(() => { if (loaded && week) saveJson(KEYS.week, week); }, [week, loaded]);
  useEffect(() => { if (loaded) saveJson(KEYS.history, history); }, [history, loaded]);
  useEffect(() => { if (loaded && cart) saveJson(KEYS.cart, cart); }, [cart, loaded]);
  useEffect(() => { if (loaded) saveJson(KEYS.carbs, carbsCache); }, [carbsCache, loaded]);
  useEffect(() => { if (loaded) saveJson(KEYS.cook, cook); }, [cook, loaded]);

  const webFetchOk = settings.webFetchSupported;
  const dishes = week?.dishes || [];
  const openDish = dishes.find(d => d.id === openDishId) || null;
  const cookDish = dishes.find(d => d.id === cook.dishId) || null;

  const realTotal = useMemo(() => {
    const ms = cart?.matches || [];
    if (!ms.length) return null;
    return ms.filter(m => m.status === 'matched').reduce((a, m) => a + (m.totalNok || 0), 0);
  }, [cart]);

  const historyNames = useMemo(
    () => history.flat().map(d => d?.name).filter(Boolean).slice(0, 40),
    [history],
  );

  /* ---- generering ---- */

  const generateWeek = useCallback(async () => {
    setBusyWeek(true);
    setWeekError(null);
    try {
      const locked = dishes.filter(d => d.locked);
      const want = Math.max(1, settings.dinners - locked.length);
      const askSettings = { ...settings, dinners: want };
      const extra = locked.length
        ? `\n\nDisse rettene er allerede låst og skal IKKE gjentas, men del gjerne ingredienser med dem: ${locked.map(d => `${d.name} (${d.ingredients.map(i => i.name).join(', ')})`).join('; ')}`
        : '';
      const data = await callApi({
        model: MODEL,
        max_tokens: 4000,
        messages: [{ role: 'user', content: weekPrompt(askSettings, historyNames, prompt.trim()) + extra }],
      });
      const parsed = extractJson(textBlocks(data));
      const arr = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : null);
      if (!arr) throw new ApiError('parse', 'Klarte ikke å lese svaret som JSON. Prøv igjen.');
      const fresh = arr.map(d => normalizeDish(d, settings));
      if (week?.dishes?.length) setHistory(h => [week.dishes, ...h].slice(0, 4));
      setWeek({ generatedAt: new Date().toISOString(), prompt: prompt.trim(), dishes: [...locked, ...fresh] });
      setCart(null);
      setCartResult(null);
    } catch (e) {
      setWeekError(e instanceof ApiError ? e : new ApiError('other', String(e?.message || e)));
    } finally {
      setBusyWeek(false);
    }
  }, [dishes, settings, historyNames, prompt, week]);

  const swapDish = useCallback(async id => {
    const dish = dishes.find(d => d.id === id);
    if (!dish || dish.locked) return;
    setSwapId(id);
    setWeekError(null);
    try {
      const others = dishes.filter(d => d.id !== id);
      const data = await callApi({
        model: MODEL,
        max_tokens: 4000,
        messages: [{ role: 'user', content: regeneratePrompt(settings, others, dish, prompt.trim()) }],
      });
      const parsed = extractJson(textBlocks(data));
      const one = Array.isArray(parsed) ? parsed[0] : parsed;
      if (!one) throw new ApiError('parse', 'Klarte ikke å lese svaret som JSON. Prøv igjen.');
      const nd = normalizeDish(one, settings);
      setWeek(w => ({ ...w, dishes: w.dishes.map(d => (d.id === id ? nd : d)) }));
    } catch (e) {
      setWeekError(e instanceof ApiError ? e : new ApiError('other', String(e?.message || e)));
    } finally {
      setSwapId(null);
    }
  }, [dishes, settings, prompt]);

  const toggleLock = id =>
    setWeek(w => ({ ...w, dishes: w.dishes.map(d => (d.id === id ? { ...d, locked: !d.locked } : d)) }));

  const setServings = (id, n) =>
    setWeek(w => ({ ...w, dishes: w.dishes.map(d => (d.id === id ? rescaleDish(d, n) : d)) }));

  /* ---- berikelse (karbo + tilbud) ---- */

  const enrich = useCallback(async (matches, cacheIn) => {
    const now = Date.now();
    const cache = { ...cacheIn };
    const idsFor = m => [m.productId, ...m.alternatives.map(a => a.productId)].filter(Boolean);
    const allIds = [...new Set(matches.filter(m => m.status === 'matched').flatMap(idsFor))];
    if (!allIds.length) return { matches, cache, ok: webFetchOk };

    const fresh = id => {
      const hit = cache[id];
      return hit && now - new Date(hit.checkedAt).getTime() < CARB_TTL_MS;
    };
    const needCarbs = allIds.filter(id => !fresh(id));
    const offersOnly = allIds.filter(fresh);

    // Cachetreff påføres uansett, også hvis web_fetch skulle være blokkert.
    // seen samler treff på tvers av batchene: uten den ville batch 2 nullstilt
    // tilbudsfeltene til radene batch 1 nettopp fylte.
    const seen = {};
    let out = matches.map(m => applyEnrichment(m, seen, cache));
    let ok = webFetchOk;

    for (let i = 0; i < allIds.length; i += ENRICH_BATCH) {
      const slice = allIds.slice(i, i + ENRICH_BATCH);
      const nc = slice.filter(id => needCarbs.includes(id));
      const oo = slice.filter(id => offersOnly.includes(id));
      setStageMsg(`Henter næringsinnhold og tilbud (${Math.min(i + ENRICH_BATCH, allIds.length)}/${allIds.length})…`);
      let data;
      try {
        data = await callApi({
          model: MODEL,
          max_tokens: 2000,
          tools: [WEB_FETCH_TOOL],
          messages: [{ role: 'user', content: enrichPrompt(nc, oo) }],
        });
      } catch (e) {
        if (e instanceof ApiError && (e.kind === 'web_fetch_blocked' || e.kind === 'mcp_blocked')) {
          ok = false;
          break;
        }
        throw e;
      }
      ok = true;
      const rows = extractJson(textBlocks(data));
      if (!Array.isArray(rows)) continue;
      for (const r of rows) {
        const pid = Number(r?.productId);
        if (!Number.isFinite(pid)) continue;
        seen[pid] = r;
        if (r?.carbsPer100 !== undefined && nc.includes(pid)) {
          cache[pid] = { carbsPer100: r.carbsPer100 == null ? null : Number(r.carbsPer100), checkedAt: new Date().toISOString() };
        }
      }
      out = out.map(m => applyEnrichment(m, seen, cache));
      const progress = out;
      setCart(c => (c ? { ...c, matches: progress } : c));
    }

    if (ok && settings.buyMode === 'tilbud') out = out.map(rerankForTilbud);
    return { matches: out, cache, ok };
  }, [settings.buyMode, webFetchOk]);

  /* ---- handlekurv ---- */

  const findProducts = useCallback(async () => {
    if (!dishes.length) return;
    setBusyCart(true);
    setCartError(null);
    setCartResult(null);
    setStageMsg('Søker opp varer på Oda…');
    try {
      const items = consolidate(dishes, settings);
      if (!items.length) throw new ApiError('empty', 'Ingen varer å handle — alt står som basisvare.');
      const data = await callApi({
        model: MODEL,
        max_tokens: 4000,
        system: MATCH_SYSTEM,
        mcp_servers: ODA_MCP,
        messages: [{ role: 'user', content: matchPrompt(items, settings.buyMode) }],
      });
      const parsed = extractJson(textBlocks(data));
      let matches;
      if (Array.isArray(parsed)) {
        matches = parsed.map((raw, n) => normalizeMatch(raw, items.find(i => i.name.toLowerCase() === String(raw?.ingredient || '').toLowerCase()) || items[n]));
      } else {
        matches = salvageMatches(data, items);
        if (!matches) throw new ApiError('parse', 'Fikk ikke lest varetreffene. Prøv igjen.');
        setCartError(new ApiError('partial', 'Svaret var ufullstendig — viser beste gjetning fra søkeresultatene. Sjekk radene nøye.'));
      }
      setCart({ stage: 'matched', matches, approvedAt: null });

      const { matches: enriched, cache, ok } = await enrich(matches, carbsCache);
      setCarbsCache(cache);
      if (ok !== webFetchOk) setSettings(s => ({ ...s, webFetchSupported: ok, buyMode: ok === false && s.buyMode === 'tilbud' ? 'cheapest' : s.buyMode }));
      setCart({ stage: 'matched', matches: enriched, approvedAt: null });
    } catch (e) {
      setCartError(e instanceof ApiError ? e : new ApiError('other', String(e?.message || e)));
    } finally {
      setStageMsg('');
      setBusyCart(false);
    }
  }, [dishes, settings, carbsCache, enrich, webFetchOk]);

  const retryRow = useCallback(async (index, term) => {
    const row = cart?.matches?.[index];
    if (!row) return;
    setBusyCart(true);
    setCartError(null);
    setStageMsg(`Søker etter «${term}»…`);
    try {
      const item = { name: term, amount: row.neededAmount, unit: row.neededUnit, dishes: row.dishes, note: `erstatter «${row.ingredient}»` };
      const data = await callApi({
        model: MODEL,
        max_tokens: 1500,
        system: MATCH_SYSTEM,
        mcp_servers: ODA_MCP,
        messages: [{ role: 'user', content: matchPrompt([item], settings.buyMode) }],
      });
      const parsed = extractJson(textBlocks(data));
      const raw = Array.isArray(parsed) ? parsed[0] : parsed;
      const salvaged = raw ? null : salvageMatches(data, [item]);
      const next = raw ? normalizeMatch(raw, item) : (salvaged ? salvaged[0] : null);
      if (!next) throw new ApiError('parse', 'Fant ingenting på det søket.');
      next.ingredient = row.ingredient;
      const merged = cart.matches.map((m, n) => (n === index ? next : m));
      setCart({ ...cart, matches: merged });
      const { matches: enriched, cache, ok } = await enrich(merged, carbsCache);
      setCarbsCache(cache);
      if (ok !== webFetchOk) setSettings(s => ({ ...s, webFetchSupported: ok }));
      setCart(c => ({ ...c, matches: enriched }));
    } catch (e) {
      setCartError(e instanceof ApiError ? e : new ApiError('other', String(e?.message || e)));
    } finally {
      setStageMsg('');
      setBusyCart(false);
    }
  }, [cart, settings.buyMode, carbsCache, enrich, webFetchOk]);

  const patchRow = (index, fn) =>
    setCart(c => (c ? { ...c, matches: c.matches.map((m, n) => (n === index ? fn(m) : m)) } : c));

  const setQty = (index, qty) =>
    patchRow(index, m => ({ ...m, qty, totalNok: Math.round(m.unitPriceNok * qty * 100) / 100 }));

  const pickAlternative = (index, altIndex) =>
    patchRow(index, m => {
      const chosen = m.alternatives[altIndex];
      if (!chosen) return m;
      const others = [
        { productId: m.productId, productName: m.productName, packSize: m.packSize, price: m.unitPriceNok, discounted: m.discounted, offerText: m.offerText, offerType: m.offerType, maxQty: m.maxQty, undiscountedPrice: m.undiscountedPrice, carbsPer100: m.carbsPer100, carbsSource: m.carbsSource, productUrl: m.productUrl },
        ...m.alternatives.filter((_, n) => n !== altIndex),
      ];
      return applyChoice(m, chosen, others);
    });

  const skipRow = index => patchRow(index, m => ({ ...m, status: 'skipped' }));
  const unskipRow = index => patchRow(index, m => ({ ...m, status: m.productId ? 'matched' : 'not_found' }));

  const approveCart = () => setCart(c => (c ? { ...c, stage: 'approved', approvedAt: new Date().toISOString() } : c));

  const sendToOda = useCallback(async () => {
    const ms = (cart?.matches || []).filter(m => m.status === 'matched' && m.productId);
    if (!ms.length || ms.some(m => isBlocking(m, settings.lowCarbMaxG))) return;
    setBusyCart(true);
    setCartError(null);
    setStageMsg('Legger varene i Oda-kurven…');
    try {
      const lines = ms.map(m => ({ productId: m.productId, qty: m.qty, name: m.productName }));
      const data = await callApi({
        model: MODEL,
        max_tokens: 1500,
        system: CART_SYSTEM,
        mcp_servers: ODA_MCP,
        messages: [{ role: 'user', content: cartPrompt(lines) }],
      });
      const parsed = extractJson(textBlocks(data)) || {};
      const added = Array.isArray(parsed.added) ? parsed.added : [];
      const failed = (Array.isArray(parsed.failed) ? parsed.failed : []).map(f => ({
        ...f,
        productName: lines.find(l => Number(l.productId) === Number(f?.productId))?.name || null,
      }));
      setCartResult({ added, failed });
      setCart(c => (c ? { ...c, stage: 'sent' } : c));
    } catch (e) {
      setCartError(e instanceof ApiError ? e : new ApiError('other', String(e?.message || e)));
    } finally {
      setStageMsg('');
      setBusyCart(false);
    }
  }, [cart, settings.lowCarbMaxG]);

  /* ---- render ---- */

  if (!loaded) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Spinner label="Laster…" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      <div className="max-w-md mx-auto">
        <header className="px-3 pt-3">
          <h1 className="text-xl font-bold text-slate-900">Ukesmeny</h1>
          <p className="text-xs text-slate-500">Lavkarbo middager og Oda-handleliste</p>
        </header>

        {tab === 'week' && !openDish && (
          <WeekTab
            week={week}
            settings={settings}
            busy={busyWeek}
            swapId={swapId}
            prompt={prompt}
            setPrompt={setPrompt}
            error={weekError}
            clearError={() => setWeekError(null)}
            realTotal={realTotal}
            onGenerate={generateWeek}
            onSwap={swapDish}
            onToggleLock={toggleLock}
            onOpenDish={setOpenDishId}
          />
        )}

        {tab === 'week' && openDish && (
          <RecipeView
            dish={openDish}
            settings={settings}
            onBack={() => setOpenDishId(null)}
            onServings={n => setServings(openDish.id, n)}
            onCook={() => { setCook({ dishId: openDish.id, stepIndex: 0 }); setTab('cook'); }}
          />
        )}

        {tab === 'cook' && (
          <CookTab
            dish={cookDish}
            dishes={dishes}
            stepIndex={cook.stepIndex}
            onStep={i => setCook(c => ({ ...c, stepIndex: Math.max(0, i) }))}
            onPickDish={id => setCook({ dishId: id, stepIndex: 0 })}
          />
        )}

        {tab === 'cart' && (
          <CartTab
            cart={cart}
            week={week}
            settings={settings}
            busy={busyCart}
            stageMsg={stageMsg}
            error={cartError}
            clearError={() => setCartError(null)}
            webFetchOk={webFetchOk}
            cartResult={cartResult}
            onFind={findProducts}
            onApprove={approveCart}
            onSend={sendToOda}
            onQty={setQty}
            onPick={pickAlternative}
            onSkip={skipRow}
            onUnskip={unskipRow}
            onRetry={retryRow}
          />
        )}

        {tab === 'settings' && (
          <SettingsTab settings={settings} onChange={setSettings} webFetchOk={webFetchOk} />
        )}
      </div>

      <TabBar
        tab={tab}
        onTab={t => { setTab(t); if (t === 'week') setOpenDishId(null); }}
      />
    </div>
  );
}

/** Legger tilbuds- og karbofelter på en rad, inkludert alternativene. */
function applyEnrichment(match, byId, cache) {
  const take = (id, current) => {
    const row = byId[id];
    const cached = cache[id];
    const carbs = row && row.carbsPer100 != null ? Number(row.carbsPer100)
      : cached ? cached.carbsPer100
        : (row ? null : current);
    const source = row && row.carbsPer100 != null ? 'oda' : (cached ? 'cache' : null);
    return {
      carbsPer100: carbs,
      carbsSource: source,
      discounted: Boolean(row?.discounted),
      undiscountedPrice: row?.undiscountedPrice == null ? null : Number(row.undiscountedPrice),
      offerText: row?.offerText ?? null,
      offerType: row?.offerType ?? null,
      maxQty: row?.maxQty == null ? null : Number(row.maxQty),
      price: row?.price == null ? null : Number(row.price),
    };
  };

  if (match.status !== 'matched' || !match.productId) return match;
  const main = take(match.productId, match.carbsPer100);
  // Prisen fra /api/v1/ er den som gjelder når den finnes — søke-API-et og
  // produkt-API-et er to ulike kodeveier og kan være uenige.
  const price = main.price != null && main.price > 0 ? main.price : match.unitPriceNok;
  return {
    ...match,
    carbsPer100: main.carbsPer100,
    carbsSource: main.carbsSource,
    discounted: main.discounted,
    undiscountedPrice: main.undiscountedPrice,
    offerText: main.offerText,
    offerType: main.offerType,
    maxQty: main.maxQty,
    unitPriceNok: price,
    totalNok: Math.round(price * match.qty * 100) / 100,
    alternatives: match.alternatives.map(a => {
      const e = take(a.productId, a.carbsPer100);
      return { ...a, ...e, price: e.price != null && e.price > 0 ? e.price : a.price };
    }),
  };
}
