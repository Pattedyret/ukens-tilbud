# TKT-9199 — Dagligvare-feilklassifisering og tilbud først

Helhetsansvarlig: Opus 5.5 (`claude-opus-5-5`), agent-work `t-b2d689df5c78`.
Oppfølging av TKT-9148 (PR #2, merget 444d47c). Fullmakt: lokal implementering + PR. Ingen merge/deploy.

## Brukerbestilling (ordrett)

> Det er et par dagligvarer her som ikke stemmer, helst også fokuser på de med tilbudene først så ordinærtpris littlengre bak for hvis de allerede er den prisen gir ikke det noen fordel å vite at de er i butikkne

Skjermbilder: Sminkesvamp 6-pk (Gigaboks, -50 %), Avène/CeraVe/babyolje/håndkrem (Apotek 1, -30 %),
MUS & REINSDYR (Selfmade 89,95, sydde kosedyr, vist som KJØTT & FJØRFE), Proffs stylingprodukter (Rusta 19,90). Alle under Dagligvarer.

## Rotårsaker (EXECUTED mot live `data/offers.json`, 2026-10-08, 3 921 produkter)

1. `lib/categorize.mjs` `DEPARTMENT_CATEGORIES['Dagligvarer']` = mat + `CONSUMABLE_CATEGORIES`, som inkluderer
   **Personlig pleie** (88 av 998 Dagligvare-produkter). Brukerens Dagligvare-definisjon utelukker personlig pleie.
2. `SECTORS['Selfmade'] = 'Lavpris & variert'`. Selfmade er en stoff-/hobbykjede (symønstre, garn, stoff). Sektoren
   slipper gjennom `groceryCapable`, så ordmatch i mønsternavn blir mat: MUS & REINSDYR→Kjøtt, GRIS→Snacks,
   JULEMUS→Ost, LEKKERT FÔR (fôrstoff)→Husholdning, Skumpensel/Svamp→Husholdning.
3. Samme klasse: `Batteridrevet flekkfjerner 2,0 Ah 18 V` (Jula) → Husholdning/Dagligvarer via `flekkfjerner`.
   Et batteridrevet apparat er aldri en dagligvare.
4. Sortering: standard `relevance` uten søk sorterer på `chain_count`, så varer uten dokumentert prisfordel kommer
   før tilbud. 315 av 998 Dagligvare-produkter har API-dokumentert fordel (`discount_pct`/multibuy/bundle). I tillegg
   oppgir **334 tilbud førpris bare i teksten** (`Førpris 49,90`, `Ord.pris fra 41,90 til 43,90`), uten `pre_price` fra API.

Sveip av Dagligvarer fra kjeder utenfor dagligvaresektoren: Europris/Rusta/Spar Kjøp sin mat og husholdning er
legitim (variert lavpris). Husholdning, Barn & baby og Dyremat blir stående i Dagligvarer (ikke rapportert, selges i dagligvare).

## Omfang

Endres: `lib/categorize.mjs`, `lib/deals.mjs`, `app.js`, tester/fixtures. Utenfor: øvrige ikke-dagligvare-kategorier
for Selfmade (stoff→Sport & fritid er eksisterende og ikke rapportert), kortets badge-design, `Kun nedsatt pris`-filteret,
scraperens datamodell.

## Design (låst)

### A. Kategorier (`lib/categorize.mjs`)
- `DEPARTMENTS`: `'Helse & apotek'` → `'Helse & skjønnhet'`.
  `DEPARTMENT_CATEGORIES`: `Dagligvarer` = `FOOD_CATEGORIES` + `Husholdning` + `Barn & baby`;
  `Helse & skjønnhet` = `Apotek & helse` + `Personlig pleie`.
- Sektorvernet må fortsatt gjelde Personlig pleie: guarden i `match()` og familielogikken i `classifyProduct()` skal
  bruke et eksplisitt sett «butikkvarer» (`FOOD_CATEGORIES ∪ CONSUMABLE_CATEGORIES`), ikke `departmentOf(...) === 'Dagligvarer'`.
  Sjampo hos en byggkjede skal fortsatt bli Annet.
- `SECTORS['Selfmade'] = 'Hobby & tekstil'` (ny sektor, ikke `groceryCapable`).
- Batteridrevne apparater: tekst som matcher `batteridrevet` eller volt+Ah-spesifikasjon (`18 V … 2,0 Ah`) kan ikke
  få en butikkvare-kategori (regelen hoppes over i `match`, neste ikke-dagligvareregel eller Annet vinner).
  `Batteri AA …`/`Batterier` er fortsatt Husholdning.

### B. Dokumentert prisfordel (`lib/deals.mjs`, ren funksjon)
- `statedPrePrice(offer)`: laveste førpris som katalogteksten (heading + description) uttrykkelig oppgir etter
  `Førpris|Før|Ord.pris|Ord. pris|Ordinær pris|Normalpris`, inkludert intervaller (`49,90–76,90`, `fra 41,90 til 43,90`,
  `49,90/51,90`). Ignorer tall med enhetssuffiks (`/kg`, `pr. kg`, `/l`, `/stk`), datoer (`25.10.26`) og tall uten
  pris-form. `null` for bundle-tilbud (per-stk vs. totalpris) og når ingenting finnes.
- `hasDocumentedAdvantage(offer)`: `discount_pct > 0` || `multibuy` || `bundle` || `statedPrePrice(offer) > comparablePrice(offer)`.
  Ingen prosent eller sparebeløp utledes av tekstførpris. Ukjent fordel kalles aldri «ordinær pris».

### C. Rangering (`app.js`)
- `relevance`: `score` (søk) → dokumentert fordel på **synlige** tilbud (`visibleOffers(p)`, dvs. valgt kjede/butikk og
  skjul utløpte) → `chain_count` → `maxDiscount`. Uten søk er alle score 0, så tilbud kommer først.
- Andre eksplisitte sorteringer endres ikke. Visning av «2 for X» og «3 for 2» endres ikke.

## Akseptanse og testplan
1. Unit (`test/categorize.test.mjs`): de konkrete skjermbildevarene med faktisk kjedesektor → ikke Dagligvarer
   (personlig pleie → `Helse & skjønnhet`); Selfmade MUS & REINSDYR/GRIS/JULEMUS/LEKKERT FÔR → ikke Dagligvarer og
   ikke Kjøtt/Snacks/Ost. Moteksempler: Reinsdyrskav hos dagligvarekjede = Kjøtt/Dagligvarer; Toalettpapir/Libero
   = Dagligvarer; Sjampo hos byggkjede = Annet; Flekkfjerner hos dagligvare = Husholdning; Batteri AA = Husholdning;
   Batteridrevet flekkfjerner hos Jula ≠ Dagligvarer. Fixtures oppdateres mekanisk bare for Personlig pleie-avdeling.
2. Unit (`test/deals.test.mjs`): `statedPrePrice`/`hasDocumentedAdvantage` på ekte tekster over + moteksempler
   (`FAST LAVPRIS! ORD. PRIS 19,90` til 19,90 → ingen fordel; `Førpris 99,80/kg` ignoreres; `Gjelder før 25.10.26`
   ignoreres; intervall der laveste førpris ≤ pris → ingen fordel; bundle → null men fordel via bundle).
3. E2E: standardrekkefølge viser varer med fordel før varer uten; kjedevalg som skjuler tilbudet degraderer varen;
   eksplisitt `Navn A–Å` beholder alfabetisk rekkefølge; «2 for X»/«3 for 2» uendret.
4. `npm test` og `npm run test:e2e` grønne. Live-sveip med ny klassifisering mot prod-data: 0 Personlig pleie og 0
   Selfmade i Dagligvarer.

## Underoppgaver
| id | provider/modell | rolle | begrunnelse |
|---|---|---|---|
| impl | codex / gpt-6.1-sol | developer | Avklart logikk- og testimplementering; MODEL_RANKING: Sol 6.1 implementerer, Opus 5.5 reviewer. |
