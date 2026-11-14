# Token Radar — pre-token protocols ranked by implied launch value

Entry for make.fun `token-radar-01`: from a sealed DefiLlama snapshot of 758
protocols, rank the ones whose record carries no token by what their launch
would be worth, and show a reader how to farm each one.

## The model (peer-multiple comparables)

```
implied = TVL × category multiple × growth × maturity × breadth
```

- **Category multiple**: the median market-cap-per-dollar-of-TVL of the
  tokenised protocols in the same category. Categories with fewer than four
  priced peers use the global median.
- **Growth**: `1 + 0.35 × clamped 7-day TVL change` (−60% to +120%), so a hot
  week lifts value at most 42%.
- **Maturity**: 0.85 under 90 days tracked, rising to 1.00 at two years;
  unknown listing date scores 0.90.
- **Breadth**: +2% per extra chain past the first, capped at +10%.

Tokenised protocols are never ranked — they are the peer set the multiples
are calibrated on, shown in the dashboard's "Already trading" panel.

## The board

198 rows: all 40 watchlist protocols, plus the 158 other pre-token protocols
that pass the same exclusion the watchlist uses (no bridges, wrapped or
staked products, versioned names or exchange products). Every row carries an implied value
and a 6-step farm plan with concrete costs and time. The dashboard is a
static page (no network): sortable, filterable board, a detail view for
every protocol with the full value breakdown and peer context, and the
category multiples the model is calibrated on.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Requires Node.js 22.18+. Deterministic: the same snapshot always writes the
same bytes. Outputs: `board.json`, `data.js`, `dashboard/`, `screenshots/`,
`dossier.json`.

## Layout

- `main.ts` — the pipeline: snapshot → board → outputs → dossier
- `lib/radar.ts` — the model, the farm plans and the board checks
- `vendor/makefun-board.ts` — the kit's dossier library (unchanged)
- `dashboard/` — the static page (`index.html`, `app.css`, `app.js`)
- `screenshots/` — board, detail and filtered views of the dashboard
