# TKT-9148 – Tilbudsvisning, dagligvarekategorier, butikkfilter med kart og handleliste

Helhetsansvarlig: Opus 5.5 (`claude-opus-5-5`), aktør `a-5d07a505d529`. Rot: `t-6f8a41e7186b`.
Worktree: `/home/pattedyr/ukens-tilbud-tkt9148`, gren `tkt-9148-tilbud-butikk-handleliste` (fra `origin/main` 4e7a134).

## Brukerens bestilling (ordrett)

1. Fix 3 for 2, or 2 for x to display properly in the app.
2. Fix the filtering of Dagligvare to actually be proper groceries, run through all the scanned offers and categorise them properly, if i go to dagligvare I dont want ovens and woodfires.
3. I want a per-store filter. I want a map to integrate with ur own current position.
4. I want a shoppinglist feature.

## Viktige fakta (kontrollert 2026-10-08)

- Statisk side (`index.html`, `app.js`, `styles.css`) + `scrape.mjs` mot Tjek API (`squid-api.tjek.com/v2`, offentlig nøkkel). Ingen backend, ingen npm-avhengigheter.
- **Produksjon = GitHub Pages**, deployes av `.github/workflows/update.yml` ved push til `main`. Ingen push til `main`, ingen merge, ingen workflow-kjøring.
- `data/offers.json` er en byggartefakt (gitignored). Live kopi fra Pages (generert 2026-10-05, 4 162 tilbud / 3 761 produkter / 41 kjeder) er lagt i worktree som `data/offers.json` for lokal testing. `data/history/*.json` (8 uker, 14 138 unike produktnavn, bare navn/kategori/kjeder) er committet: **skal ikke endres**.
- Kategorier i dag: 42 % `Annet` (1 570/3 761). «Bransje»-filteret bruker *kjedens* sektor, så Obs/Extra sine ovner, ytterdører og skotørkere havner under Dagligvarer.
- «N for X»-pakkedeal: API-et priser som N-pakning (`price`=totalpris, `quantity.pieces.from`=N). Kortet viser bare «100 kr» + kr/kg. 22 slike i live-data. «3 for 2»-ratio fanges bare fra `description` når `pieces<=1`: 5 treff.
- Tjek: katalog har `all_stores` (bool). `GET /v2/stores?dealer_ids=<id>&limit=100&offset=n` gir butikker med `id,name,street,zip_code,city,latitude,longitude,dealer_id`. `GET /v2/catalogs/<id>/stores?limit=100&offset=n` gir butikkene til en regional katalog.

## Datakontrakt (offers.json, utvidet, bakoverkompatibel)

Per produkt (nye felt):
- `department`: én av `Dagligvarer`, `Hjem & interiør`, `Bygg, hage & bil`, `Elektronikk`, `Fritid, klær & leker`, `Helse & apotek`, `Annet`.

Per tilbud (nye felt):
- `bundle`: `{ count, total, each }` eller `null`. Pakkedeal «N for X», der X er tilbudets `price` (±0,5) og N ≥ 2. `each` = total/N, avrundet til 2 desimaler.
- `multibuy`: som i dag `{ buy, pay, unit_price, effective_price }`. Parses nå fra `heading + description` og flere formuleringer («3 for 2», «3=2», «kjøp 3 betal for 2», «ta 3 betal for 2», «3 for 2-pris»). Et tilbud har aldri både `bundle` og `multibuy`.
- `catalogues`: `[katalog-id]`, alle katalogene der dette (deduperte) tilbudet finnes, også regionale kopier som slås sammen.
- `stats`: `offers_with_bundle`, `stores`, `stores_without_catalogues`, `stores_failed` (antall forespørsler som feilet).
- `data.categories[]` får `department`. `data.departments[]`: `{ name, products }`.

Ny `data/stores.json` (gitignored byggartefakt, deployes med siden):
```json
{ "generated_at": "...", "complete": true, "failed": [],
  "stores": [{ "id": "BTFbt0Jf", "chain": "<kjede-slug som i offers.json>", "name": "KIWI Grünerløkka",
               "street": "...", "zip": "0184", "city": "Oslo", "lat": 59.91, "lng": 10.75,
               "catalogues": ["<katalog-id>", "..."] }] }
```
Butikkens `catalogues` = katalogene fra sweepet som gjelder butikken (`all_stores` for kjeden + regionale aviser som lister den). Butikker uten katalog tas med (`catalogues: []`). UI-et sier da at det mangler tilbudsdata, i stedet for å late som om butikken ikke har tilbud.

## Avdelinger (Opus 5.5-beslutning)

Avdeling utledes **bare** fra produktkategori (`departmentOf(category)`), aldri fra kjede.
- **Dagligvarer** = mat og drikke (Ost, Meieri & egg, Fisk & sjømat, Kjøtt & fjørfe, Pålegg, Brød & bakeri, Frukt & grønt, Snacks & godteri, Is & dessert, Kaffe & te, Drikke, Middag & ferdigmat, Frysevarer, Tørrvarer & baking, Saus & krydder) + forbruksvarer: `Husholdning` (bare forbruk: vask, papir, poser, folie, lys), `Personlig pleie`, `Barn & baby` (mat, bleier, våtservietter), `Dyremat`.
- Ikke-forbruk flyttes ut: bøtter, kurver, kleshengere, tørkestativ, toalettbørster → `Hjem & oppbevaring` (Hjem & interiør). Kattetre, bånd, akvarier → `Dyreutstyr` (Fritid, klær & leker). Spylervæske, motorolje, viskere, bilpleie → ny `Bil & motor` (Bygg, hage & bil). Blomster/planter → Hjem & interiør.
- Forsvar i dybden: en matkategori som bare treffer for produkter der *alle* kjedene er i ikke-mat-sektor (Bygg & jernvare, Elektronikk, Møbler & interiør, Sport & fritid), klassifiseres på nytt uten matregler.

## Kvalitetsmål for kategorisering (målt på all tilgjengelig data: live offers.json + alle 8 historikkuker)

- **Presisjon i Dagligvarer:** 0 treff i Dagligvarer fra en eksplisitt ikke-mat-liste (ovn, vedovn, peis, panelovn, ildsted, varmepumpe, dør, møbel, verktøy, maling, lampe, TV …), sjekket over alle 14 138 historikknavn + live. Manuell gjennomgang av et tilfeldig utvalg på ≥300 Dagligvare-produkter: ≥98 % korrekte. Utvalget lagres som fasit-fixture.
- **Dekning:** `Annet` blant produkter som bare selges i rene dagligvarekjeder: fra 29 % (302/1 038) til ≤8 %. `Annet` totalt: fra 42 % til ≤20 %.
- Rapport per mål med før/etter-tall skrives til `docs/plans/2026-10-08-kategori-revisjon.md`.

## Visning av deals (Opus 5.5-design)

- **Pakkedeal (`bundle`)** på kort, i detaljrad og i handleliste: hovedpris `3 for 100,–` (antallet i liten skrift foran prisen). Under: `33,33 kr/stk`, deretter kr/kg som i dag. Merke i bildehjørnet: `3 for 100`.
- **Ratio (`multibuy`)**: hovedpris = stykkpris (`39,90 kr`). Merke i bildehjørnet: `3 for 2` (egen farge, ikke rabattrød). Linje: `Ta 3: 26,60 kr/stk`. «Størst rabatt»-sortering bruker fortsatt den utledede prosenten.
- Kopier-som-tekst og handleliste viser samme dealtekst.
- Bakoverkompatibelt: data uten `bundle` gir dagens visning. `size_text` som starter med «N x» og beskrivelse med «N for X» skal ikke dupliseres i UI.

## Butikkfilter og kart (Opus 5.5-design)

- «Butikk»-facetten (kjede) beholdes. Ny knapp **«Butikker nær meg»** i toppfeltet og øverst i facettene åpner en `<dialog>` med Leaflet-kart (OSM-fliser, attribusjon, `preferCanvas`) + liste.
- Leaflet lastes lat fra unpkg med fast versjon og SRI-integritet først når dialogen åpnes. Feiler lasting, vises bare listen, med melding.
- Posisjon: hentes **bare** ved klikk på «Bruk min posisjon» (`navigator.geolocation.getCurrentPosition`, timeout 10 s). Tilstander og tekst: henter / nektet («Du har ikke delt posisjon. Søk etter sted, postnummer eller butikk i stedet.») / utilgjengelig / tidsavbrudd / ikke støttet (usikker kontekst). Posisjonen lagres aldri i localStorage.
- Uten posisjon: Norge-oversikt + søkefelt (navn/gate/postnr/sted) som filtrerer listen lokalt. Med posisjon: listen sorteres etter avstand (haversine) og viser «1,2 km», og kartet sentreres med «Du er her»-markør.
- Velg én eller flere butikker (liste eller markør-popup «Vis tilbud her»). Valgte butikker lagres i prefs (`stores: [id]`), vises som chips og filtrerer: et produkt vises bare hvis et tilbud har `catalogues` ∩ butikkens `catalogues`. Kortets pris, kr/kg og deal kommer fra det billigste *matchende* tilbudet. Samme regel gjelder kjedefilteret: kortet viser pris fra valgt kjede.
- Butikk uten katalogdata: tydelig merket i listen («ingen tilbudsdata for denne butikken»). Mangler `catalogues` i offers.json (gammel data), faller filteret tilbake til butikkens kjede og viser et notis.

## Handleliste (Opus 5.5-design)

Utvider eksisterende liste (localStorage `ukens-tilbud:v1`, `list` som `[id, item]`-par, migreres uten tap):
- Legg til fra kort/detalj (som i dag, nå med `deal`-tekst og `valid_to`).
- **Egne varer**: tekstfelt «Legg til vare …» øverst i listen; egne varer har `id: "custom:<tid>"`, gruppe «Egne varer».
- **Avkryssing**: avkrysningsboks per vare, gjennomstreking, avkryssede nederst i gruppen. «Fjern avkryssede» og «Tøm liste» (med bekreftelse).
- Utgåtte tilbud merkes «utgått». Totalsum bare for ikke-avkryssede varer med pris; pakkedeal teller `total`.
- Kopier som tekst tar med egne varer og `[x]` for avkryssede.

## Arbeidsfordeling

| Barn | Provider/modell | Rolle | Eier filer |
|---|---|---|---|
| A: datapipeline (deals, butikker, katalog-id-er, stats, workflow-guard, gitignore) | codex / gpt-6.1-sol | developer | `scrape.mjs`, `lib/deals.mjs`(ny), `lib/stores.mjs`(ny), `test/deals.test.mjs`, `test/stores.test.mjs`, `package.json`, `.gitignore`, `.github/workflows/update.yml`, README «Data» |
| B: kategorirevisjon | codex / gpt-6.1-sol | developer | `lib/categorize.mjs`, `test/categorize.test.mjs`, `test/fixtures/categorize-*.json`, `scripts/audit-categories.mjs`, `docs/plans/2026-10-08-kategori-revisjon.md` |
| C: frontend | codex / gpt-6.1-sol | developer | `app.js`, `index.html`, `styles.css`, `lib/ui-*.mjs`(nye rene moduler), `test/ui-*.test.mjs`, `test/e2e/*` |
| Review | Opus 5.5 (helhetsansvarlig) + uavhengig Claude-review av Sol-kode | reviewer | ingen |
| Frontend-test | Playwright (headless Chromium) i denne økten. Astra med Computer Use bare hvis forelder tilbyr URL-tilgang | tester | ingen |

Avhengigheter: A og B parallelt. C kan starte med en gang mot kontrakten over. Integrasjonstest (ny scrape i /tmp-kopi → UI) etter A+B. Kontrakt mellom A og B: B eksporterer `classifyProduct({ name, descriptions, chainSectors }) → { category, department }`, `departmentOf(category)`, `DEPARTMENTS`, og beholder `categorize`, `extractBrand`, `SECTORS`, `CATEGORIES`.

## Risiko

- Regelbasert klassifisering har aldri 100 % dekning. Presisjon i Dagligvarer prioriteres over dekning (heller `Annet` enn feil avdeling).
- OSM-fliser og unpkg er tredjeparter (gratis, attribusjon kreves). Ingen nye betalte tjenester.
- Butikkdata gir flere API-kall per scrape (estimert +100–200). `SCRAPE_DELAY_MS` gjelder, og feil gir `complete:false` uten å stoppe tilbudsdeployen.
- Geolokasjon krever sikker kontekst (Pages er https; localhost er sikker).

## Verifikasjon

- `node --test` grønt (nye enhetstester for deals, butikkmapping, kategorier, ui-logikk).
- Ekte scrape kjøres i en kopi under `/tmp` (rører ikke `data/history` i repoet). Statistikk før/etter rapporteres.
- Playwright-flyt mot `python3 -m http.server`: deal-visning, Dagligvarer uten ovner, butikkvalg med mocket posisjon og nektet tillatelse, handleliste (legg til, egen vare, kryss av, reload består, fjern).
- Ingen push til `main`, ingen merge, ingen deploy. PR mot `main` opprettes som utkast. Merge = produksjonsdeploy og krever brukerens fullmakt.
