# TKT-9148 B – kategorirevisjon, runde 2

**Dagligvarer-presisjonen i det fryste utvalget steg fra 94,50 % til 98,95 %. Samlet avdelingsnøyaktighet er 90,33 %; to ikke-matvarer slipper fortsatt inn.** Produksjon er ikke rørt. Ingen commit, push eller merge.

## Metode og avgrensning

`classifyProduct` slipper bare Dagligvarer-kategorier gjennom når minst én sektor tillater den aktuelle kategorien. Dagligvarer og Lavpris & variert tillater alle; Helse & skjønnhet bare Personlig pleie/Barn & baby; Hage & dyr bare Dyremat. Resten, inkludert tom/ukjent sektor, sperres. Kategorien prøves på nytt uten sperrede regler, med Annet som fallback. `categorize` beholder tekstbasert bakoverkompatibilitet; pipeline/UI skal bruke `classifyProduct` med kjedesektorer.

Utstyrshoder prioriteres foran matord og markedsføring. Forbruk som maskinoppvasktabletter, syltetøy i glass og pålegg-sett beskyttes. Produktfamilier eier smaksvariantene i komma/«og»-lister; tydelige blandinger av ulike produkter blir Annet. Kids Outlet er registrert som Leker & barn.

Auditen leser 3 920 live-produkter og alle åtte historikkuker (14 138 historikknavn; union 14 362 navn, 36 054 kjedevarianter). Ingen historikkfiler eller offers.json er endret. Eksisterende SECTORS brukes også for historiske slugs som mangler i dagens scrape. Ukjente kjeder blir sperret, ikke gjettet.

Førkolonnen nedenfor bruker klassifikatoren fryst før runde 2, med samme oppdaterte sektormetadata på begge sider. Snapshot: `/tmp/tkt9148-B2/categorize-before.mjs`. Input generert 2026-10-08T08:14:56.468Z; SHA256 `e561b72866723edc18978f9219651d170ae2b4b8ffd3fce3beec0dbc341d860f`.

## Før/etter (EXECUTED)

| Mål | Før runde 2 | Etter runde 2 | Krav |
|---|---:|---:|---:|
| Annet, live | 475/3920 / 12,12 % | 480/3920 / 12,24 % | ≤20 % |
| Annet i rene dagligvarekjeder, live | 19/1012 / 1,88 % | 15/1012 / 1,48 % | ≤8 % |
| Annet, historikk | 2721/14138 / 19,25 % | 2789/14138 / 19,73 % | ≤20 % |
| Annet i rene dagligvarekjeder, historikk | 211/4471 / 4,72 % | 221/4471 / 4,94 % | ≤8 % |
| Annet, union | 2517/14362 / 17,53 % | 2586/14362 / 18,01 % | ≤20 % |
| Annet i rene dagligvarekjeder, union | 187/4507 / 4,15 % | 196/4507 / 4,35 % | ≤8 % |
| Annet, alle kjedevarianter | 6776/36054 / 18,79 % | 6978/36054 / 19,35 % | ≤20 % |
| Annet i rene dagligvarekjeder, alle kjedevarianter | 376/9231 / 4,07 % | 419/9231 / 4,54 % | ≤8 % |
| Eksplisitt ikke-mat-sjekkliste, alle kjedevarianter | 0 | 0 | 0 |
| Fryst utvalg: Dagligvarer-presisjon | 189/200 / 94,50 % | 189/191 / 98,95 % | ≥98 %; test ≥97 % |
| Fryst utvalg: riktig avdeling totalt | 266/300 / 88,67 % | 271/300 / 90,33 % | Rapporteres separat |
| Fryst utvalg: riktig kategori totalt | 243/300 / 81,00 % | 250/300 / 83,33 % | Rapporteres separat |
| Regresjonsfasit: riktig avdeling | – | 470/470 | Ikke uavhengig evaluering |
| Regresjonsfasit: riktig kategori | – | 469/470 | ≥98 % |
| Adversarial | – | 159/159 | 100 % |

Vaktene alene flytter **51 live-produkter, 140 historikknavn, 160 unionnavn og 374 kjedevarianter** ut av Dagligvarer. Effekten måles ved å sammenligne endelig klassifikasjon med samme regler uten sektorsperre. Hele runde 2 flytter henholdsvis 55, 145, 162 og 410 ut, og legger også til korrekte matvarer.

Avdelinger i unionen: Dagligvarer 4358; Hjem & interiør 3131; Bygg, hage & bil 1637; Elektronikk 825; Fritid, klær & leker 1797; Helse & apotek 28; Annet 2586.

## Held-out uten ny tuning

Seed 2026, Mulberry32/Fisher–Yates og navnesortering med localeCompare(nb): 200 daværende Dagligvarer og 100 utenfor fra nyeste scrape, uten overlapp med gold eller Opus-utvalget seed 9148. Navn/kjeder/beskrivelser ble fryst før regelendringene og ikke lest før klassifikatoren var låst. Manuell merking ble gjort uten klassifikasjonssvar; etter evaluering ble verken regler eller merker justert. Sporbarhet ligger i `categorize-holdout-provenance.json`.

Fire navn overlapper adversarial: Varmepumpe, Peisovn, FINDUS WOK SPICY, CLASSIC OG ZESTY INGEFÆR og Kaffetrakter. Uten dem: **188/190 / 98,95 % Dagligvarer-presisjon**, 267/296 / 90,20 % riktig avdeling. Fullt utvalg har 189/195 / 96,92 % gjenfinning av kontraktens Dagligvarer.

97 %-testen gjelder presisjonen blant produkter klassifisert som Dagligvarer, ikke alle avdelinger eller kategorier. Fasiten er agentmerket, ikke menneskevalidert. Enkelte kategorimerker er usikre; `label_note` navngir dem. Tre held-out-forbruksvarer får bevisst Annet etter sektorkontrakten; deres vanlige avdeling er bevart som `expected_without_sector_guard`.

Gold fikk 29 sektor-metadatarettinger fra eksisterende kjedetabell og sju forventningsendringer som følger den nye kontrakten. Tidligere sektorer/ubetingede forventninger er bevart i fixture. Gold har nå 310 Dagligvarer og 160 utenfor. Gold-presisjonen er en regresjonsmåling brukt under tuning.

## Gjenstående feil og neste handling

**To falske Dagligvarer-treff:** Oppvaskbørste-hode 1 stk og Utskjæringssett til gresskar. De er beholdt som feil i evalueringen. Sjekklisten dekker ikke alle utstyrshoder; null sjekklistetreff beviser derfor ikke null feil.

Alle 29 avdelingsavvik i held-out:

| Produkt | Manuelt merket avdeling | Klassifisert avdeling |
|---|---|---|
| Franke kjøkkenkum MRG 610-72 TL onyx | Bygg, hage & bil | Annet |
| Oppvaskbørste-hode 1 stk | Hjem & interiør | Dagligvarer |
| SUPERSETT VEGG OG TAK | Bygg, hage & bil | Annet |
| Dash Cam Live | Elektronikk | Annet |
| ingear Frontlykt LED 550 lumen | Hjem & interiør | Annet |
| Utskjæringssett til gresskar | Hjem & interiør | Dagligvarer |
| PROTEINBOWL TACO & KJØTTDEIG OG KYLLING & PASTA | Dagligvarer | Annet |
| RUSTICA PEPPEPPERONI | Dagligvarer | Annet |
| Neglefiler i krukke 20 stk | Dagligvarer | Hjem & interiør |
| MILL GLASS SMART WIFI 400 W GEN. 4 PANELOVN | Bygg, hage & bil | Elektronikk |
| optimize Mikrofiberhanske | Hjem & interiør | Fritid, klær & leker |
| FIT 5 PRO | Elektronikk | Fritid, klær & leker |
| Craft Technology Instant print fotokamera | Fritid, klær & leker | Annet |
| Rock lyskilde sotet LED 4W | Hjem & interiør | Annet |
| SPINDELVEV | Fritid, klær & leker | Annet |
| MINI-OMELETT OST & SKINKE, BACON,LØK & OST OG PAPRIKA & SALATOST | Dagligvarer | Annet |
| GLOW DREAM REGULERBAR | Hjem & interiør | Fritid, klær & leker |
| Alt brannsikkerhet | Elektronikk | Annet |
| Nålefilt kit DIY nisse 6x12cm | Fritid, klær & leker | Annet |
| MONTERINGSSETT TIL DEKORFOLIE | Bygg, hage & bil | Hjem & interiør |
| Toleriane Sensitive Riche dagkrem | Dagligvarer | Annet |
| Deko-stoff pepperkakemann 54x45cm 5stk | Fritid, klær & leker | Annet |
| HALLOWEEN BØTTE | Fritid, klær & leker | Hjem & interiør |
| Overtrekk til hjulholder | Bygg, hage & bil | Hjem & interiør |
| LABELLO | Dagligvarer | Annet |
| LED-panel 60x60 cm 3300 lm 30 W | Hjem & interiør | Annet |
| Thule Sykkelstativ VeloCompact | Bygg, hage & bil | Fritid, klær & leker |
| HELLE jerseystretchlaken | Hjem & interiør | Fritid, klær & leker |
| Strykeark alfabet/tall gullfrg. glitter | Fritid, klær & leker | Annet |

Totalt er 50 kategorimerker og 29 avdelingsmerker ulike i held-out. Gold har fortsatt kategoriavviket Nugget Chicken Spicy Flavor/ Tom Yum Kung Flavour 90 g. Alle avvik med forventet/faktisk kategori finnes i audit-JSON.

Sektordekningen er delvis: byggern og modena mangler kjent sektor, fordelt over 1 000 historikkvarianter. Ukjente modellnavn og produktlister som ikke kan skilles fra variantlister forblir Annet. Ingen varer med bare ukjent sektor blir Dagligvarer.

**Mottaker/eier for neste vurdering: Opus 5.5, a-5d07a505d529.** De resterende feilene krever en ny runde med nytt urørt evalueringsutvalg. Hodeord-vetoet lukker ikke klassen av hittil ukjente utstyrshoder; en varetype fra datakilden eller en bredere semantisk modell må vurderes før klassen kan regnes som stengt. Ingen slik arkitekturendring er gjort her.

## Verifikasjon

- `node --test test/*.test.mjs`: 67/67 bestått, 0 hoppet over (uten e2e).
- `node scripts/audit-categories.mjs --baseline-classifier /tmp/tkt9148-B2/categorize-before.mjs --json /tmp/tkt9148-B2/audit-final.json`: exit 0; tall og komplette feillister.
- `node scripts/audit-categories.mjs`: kan kjøres uten baseline-snapshot; lagrede input-kategorier brukes da som førkolonne, med tydelig proveniens.
- Holdout-navn og alle opprinnelige inputfelt er identiske med fryst utvalg. Klassifikator-SHA256 etter tuning/før merking og ved sluttkontroll: `4b5eec4997a1232568497790546d9e0249cb8834987b7d923630d05e8bf2d905`.
- Red/green, slutt-testlogg, før/etter-audit og input-snapshots: `/tmp/tkt9148-B2/`.
