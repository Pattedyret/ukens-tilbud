# Ukens tilbud

Every current Norwegian weekly offer, from every chain, in one searchable page —
grouped so the same product across different stores sits under one entry, with
prices, comparable kr/kg, categories and a shopping list.

Static site + a scraper that runs twice a week in GitHub Actions. No backend.

```bash
node scrape.mjs        # writes data/offers.json
python3 -m http.server # then open http://localhost:8000
```

## Why this does not scrape kupp.vg.no

kupp.vg.no was the obvious starting point, and it is genuinely well structured —
each catalogue page embeds a `data-paper` attribute whose `pages[].offers[]`
array gives, per offer, a product label, a canonical product id, and an `x/y/
width/height` bounding box locating that offer on the flyer image.

It has no prices. Not "sometimes missing" — the `price` field was **null on
1259 of 1259 offers**, across all 17 chains that publish hotspot annotations.
The price exists only as pixels inside the scanned flyer:

> `{"id":579690,"price":null,"label":"Coca-Cola Zero 6 x 1,5 liter","x":0.371,…}`

Cropping that box out of the page JPEG shows `79,00 + pant … pr. l 8,78`. So the
number is *visible* but not *available*, and the only ways to get it would be OCR
over stylised price graphics, or a different source.

This project uses a different source: the **Tjek / eTilbudsavis** backend that
`mattilbud.no` runs on. It carries the same Norwegian catalogues — the very same
Kiwi week-34 paper, same offers — but as structured records with real pricing:

```json
{ "heading": "LAKSEFILET",
  "pricing": { "price": 69.9, "pre_price": 82.9, "currency": "NOK" },
  "quantity": { "unit": { "symbol": "g", "si": { "symbol": "kg", "factor": 0.001 } },
                "size": { "from": 100 }, "pieces": { "from": 4 } },
  "run_from": "2026-08-16T22:00:00+0000", "run_till": "2026-09-06T21:59:59+0000" }
```

Measured coverage: **7 838 offers, 100% with a price**, 39% with a
pre-discount price, across 44 chains.

## How it works

**Discovery is geographic.** The API returns catalogues near a coordinate, so
`scrape.mjs` sweeps ten cities from Kristiansand to Kirkenes and unions the
results. An Oslo-only query misses regional chains — the sweep finds ~97
catalogues where Oslo alone finds 60.

**Grouping.** Offers are grouped into products by normalised heading
(lowercased, de-accented, punctuation stripped). About 7% of products appear in
more than one chain, and those are the interesting ones: *leverpostei* shows up
in 7 chains between 10 and 30 kr. Sort by "Flest butikker" to see only those.

**kr/kg is computed, not parsed.** `quantity.unit.si.factor` converts the pack
unit to its SI base, so 4 × 100 g at 69,90 becomes 69,90 / 0,4 = **174,75 kr/kg**
— which matches the printed "pr. kg 174,75" on the flyer. Comparing a 100 g jar
against a 400 g jar on sticker price alone is meaningless; this is the honest
comparison. A product only gets an aggregate unit price when all its offers
share one SI unit, so kr/kg is never silently compared against kr/l.

**Categories are rule-based.** `lib/categorize.mjs` holds an ordered list of
`[category, regex]`; first match wins, so narrow rules (baby food, pet food) sit
above broad ones (dairy, meat). Norwegian forms closed compounds, so most stems
are matched as infixes — `lampe` has to match `VEGGLAMPE`, and `\blampe\b`
does not. Anything unmatched stays in `Annet` rather than being forced into a
category it does not belong to.

## Data

`data/offers.json` is the whole database, rebuilt on each run:

| Field | Meaning |
|---|---|
| `stats` | counts, price coverage, uncategorised share, failed catalogues |
| `chains[]` | slug, display name, brand colour, sector, offer count |
| `categories[]` | category name + product count |
| `products[]` | grouped product: name, category, brand, chains, min/max price, `best_unit` |
| `products[].offers[]` | per-chain offer: price, `pre_price`, `discount_pct`, `unit_price`, `size_text`, image, catalogue page, validity |

`data/history/` keeps a slimmed snapshot per ISO week, so week-on-week price
history accumulates from the first run onward.

## Automation

`.github/workflows/update.yml` runs Monday and Thursday at 05:00 UTC, commits
refreshed data, and deploys to GitHub Pages. The build **fails loudly** if the
scrape returns under 500 offers, under 10 chains, or if price coverage drops
below 90% — a silent empty deploy would read as "no offers this week" rather
than as a broken scraper.

Failed catalogues are recorded in `stats.failed_catalogues` and listed in
`failed_catalogues[]` rather than being dropped, so a chain that fails to fetch
is never indistinguishable from a chain with nothing on sale.

## Notes on politeness

Requests are serialised with a delay between them (`SCRAPE_DELAY_MS`, default
120 ms), retried with backoff, and identify themselves in the User-Agent. The
whole run is a few hundred requests, twice a week.

The API key in `scrape.mjs` is the public client key that mattilbud.no ships in
its own front-end. Override it with the `TJEK_API_KEY` environment variable.
