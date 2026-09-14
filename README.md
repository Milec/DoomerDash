# DoomerDash

**Live: https://doomerdash.mikie-mcconaghy3.workers.dev**

Systemic risk indicators across five failure modes, normalized so they can be
compared to each other.

Every indicator is displayed as a **z-score against its own trailing ten-year
distribution**, direction-normalized so that **positive always means worse**.
Raw values are secondary. The dashboard answers one question per panel: *is this
getting worse relative to its own history?*

**Phase 1 is FRED-only** — twelve indicators plus three counter-indicators, end
to end, deployed. Phase 2 sources are stubbed at the connector interface and
nothing else.

---

## Architecture

| Piece | What it is |
|---|---|
| Frontend | Vite + React + TypeScript + Tailwind, Recharts sparklines. Built to `dist/`. |
| Hosting | One Cloudflare Worker serving both the SPA (Static Assets) and `/api/*`. No Pages Functions. |
| Database | Supabase Postgres. Schema, normalization views, and seed in `migrations/`. |
| Ingestion | Cron Trigger at 09:00 UTC, plus a bearer-guarded `POST /api/ingest?source=X`. |

**The browser talks only to `/api/*`.** It never holds a Supabase key, never
learns the project URL, and never calls an upstream API. `npm run check:bundle`
greps the built assets for key material and fails the build if any is present.

The Worker holds two database clients with different privileges:

- **read path** — publishable/anon key, granted `SELECT` on seven curated views
  and nothing else. Base tables are revoked and RLS-enabled.
- **write path** — service-role key, used by ingest only, never reachable from
  an unauthenticated route.

---

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # then fill it in, see Secrets below
npm run build                    # SPA -> dist/
npx wrangler dev                 # Worker + assets on :8787
```

`npm run dev` runs Vite alone with `/api` proxied to `wrangler dev` on 8787, so
the SPA still has no second origin and no key. Run both when iterating on the UI.

```bash
npm test              # normalization tests (needs a database, see Tests)
npm run check:bundle  # fails if a credential reached dist/
npm run deploy        # build + wrangler deploy
```

---

## Secrets

Nothing sensitive lives in the repo. `wrangler.toml` carries one plain var —
`SUPABASE_URL`, which is not a credential — and everything else is a Worker
secret:

```bash
wrangler secret put SUPABASE_PUBLISHABLE_KEY   # read path
wrangler secret put SUPABASE_SERVICE_KEY       # write path, ingest only
wrangler secret put FRED_API_KEY               # fred.stlouisfed.org/docs/api/api_key.html
wrangler secret put INGEST_TOKEN               # bearer guarding POST /api/ingest
```

For local work put the same four in `.dev.vars` (gitignored; `.dev.vars.example`
is the template). Node scripts and tests read `.dev.vars` too, so there is one
place to set them.

Trigger ingest by hand:

```bash
curl -X POST -H "Authorization: Bearer $INGEST_TOKEN" \
  "https://<worker>/api/ingest?source=fred"
```

---

## Adding an indicator

If the source already has a connector, **insert a row and write nothing else.**

```sql
insert into indicators (
  slug, name, failure_mode, source, source_series_id, unit, cadence,
  higher_is_worse, transform, is_counter, stale_after_days, notes, source_url, license
) values (
  'move_index', 'MOVE Index', 'credit_plumbing', 'fred', 'VIXCLS', 'index', 'daily',
  true, 'level', false, 5, 'Rate volatility.', 'https://fred.stlouisfed.org/series/VIXCLS',
  'U.S. Government public domain via FRED.'
);
```

Then run the ingest (below). The connector reads `source_series_id` and
`transform` and derives the rest.

- `transform = 'level'` — store the series as published.
- `transform = 'yoy_pct'` — percent change against the observation exactly one
  year earlier. Points with no exact-dated counterpart are dropped.
- `transform = 'diff'` — period-over-period first difference.
- `transform = 'ratio'` — `source_series_id` is `"NUMERATOR/DENOMINATOR"`. An
  exact date match wins; otherwise the denominator is averaged over the
  numerator's period (that is how annual CO2 is divided by quarterly real GDP).

`higher_is_worse = false` flips the sign so positive z still means worse.
`is_counter = true` puts the row in the counter-indicator strip and excludes it
from every composite. `cadence = 'manual'` is supported from day one for series
with no feed.

### Backfilling history

There is no separate backfill path. Ingestion always requests full history from
`OBSERVATION_START` (2005-01-01) and upserts on `(indicator_slug, obs_date)`, so
running it *is* the backfill — and re-running it picks up upstream revisions,
later values winning.

```bash
npm run backfill -- fred
```

Or hit `POST /api/ingest?source=fred` against the deployed Worker. Either way a
row lands in `ingest_runs`, and the z-score snapshot is rebuilt afterwards.

---

## Normalization

This is the part that matters. It lives in Postgres (`zscores()` in
`migrations/0005`), not in the client.

- Rolling stats over a **trailing 10-year window ending at the observation
  date**, expanding when less history exists.
- **No z-score at all** until the window holds at least **24 observations**.
- **Winsorized at the 1st/99th percentile before the mean and sd are taken.**
- **Sign flipped** where `higher_is_worse = false`.
- Monthly and quarterly series are **never forward-filled into daily**. Each
  observation keeps its true `obs_date` and the UI shows the age.
- Composites are the **unweighted mean** of member z-scores observed within 90
  days. No weighting — weighting invites tuning the dashboard until it agrees
  with you. A bucket with fewer than half its members fresh reports **no
  composite** rather than one built from the survivors.
- Counter-indicators are excluded from every composite.

**Winsorization clamps the distribution, not the observation being scored.** The
point of winsorizing is to stop one COVID-era print from permanently inflating
sigma and flattening the scale. Clamping the current print too would make the
dashboard under-report exactly the crisis it exists to detect, so the numerator
uses the raw value and a genuine new extreme can print past ±10.

### Two consequences worth knowing about

Both fall out of the spec as written. Neither is a bug; both are one-line
changes if you want them different.

1. **Quarterly indicators never reach a composite.** The composite freshness
   window is 90 days, but BEA and Fed quarterly series carry a release lag that
   puts their newest observation ~166 days old. So `cc_delinq`, `real_gdp_yoy`
   and `net_interest_receipts` render in their rows with a live z-score and are
   permanently excluded from the bucket averages. Both buckets still clear the
   half-fresh bar (5/6 and 4/6), so composites publish. If you want quarterly
   data to count, change `composite_window_days()` — it is a one-line SQL
   function, referenced everywhere, defined once.

2. **Annual series can never be scored.** A ten-year window holds at most ten
   annual observations, below the 24-observation minimum, so `co2_per_gdp` and
   `real_median_income` show `--` with `n=10` forever. Fix by lowering
   `zscore_min_obs()`, widening `zscore_window_years()` for annual cadence, or
   accepting that annual series are context rather than signal.

### Performance

Scoring is materialized. `indicator_zscores_mv` is rebuilt by
`refresh_analytics()` after every ingest, and the API reads only the snapshot —
a single page load never runs the windowed percentile query. `analytics_status`
exposes the rebuild timestamp, which the footer displays, so a stale snapshot is
visible rather than silent.

For a single indicator call `zscores('slug')`. Do **not** filter
`indicator_zscores` by slug: its `windowed` CTE is referenced twice and therefore
materialized, which fences off predicate push-down and rescores every indicator
in the database.

---

## Hard rules this codebase keeps

- **Never interpolate, never fabricate.** A failed fetch leaves a gap and the UI
  shows it. `observations.value` is `not null`; a missing point is an absent row,
  not a null or a filled one. There is no synthetic fill anywhere.
- **Seed data is obviously fake.** Fixtures use the `demo_` slug prefix and every
  production view filters them out. A test asserts that they cannot leak.
- **Every row links to its primary source** so any number is verifiable in one
  click, and `indicators.license` records the terms per series.
- **Staleness is a visual state.** Past its own `stale_after_days` an indicator
  renders desaturated with its age. Showing quarterly data as if it were live is
  worse than not showing it.
- **Dates are rendered as published.** Date-only observations are never parsed
  into a local `Date`, which is how a quarterly print ends up displayed a day
  early for half the planet.

### Licensing note

The ICE BofA OAS series (`hy_oas`, `ig_oas`) are ICE Data Indices, LLC, used
with permission via FRED and subject to redistribution terms — check the series
page before republishing them. Everything else in Phase 1 is US government
public domain. ACLED, planned for Phase 2, requires registration and restricts
redistribution; check its terms before exposing it on a public URL.

---

## Tests

```bash
npm test
```

The normalization layer is SQL, so the tests run **against a real database**
rather than a TypeScript reimplementation that could drift from it. They cover
sign flipping, winsorization, insufficient-history handling, the stale-composite
rule at its exact boundary, and demo-fixture isolation. No UI tests.

Fixtures are created and torn down under the `demo_` prefix. Set `SUPABASE_URL`
and `SUPABASE_SERVICE_KEY` (in `.dev.vars` or the environment) or the suite skips.

---

## Phase 2

Stubbed at `worker/connectors/registry.ts`. Each source is a module exporting
`fetchSeries(indicator, ctx)`; adding one is a new file plus one line in the
factory table. Planned, in rough value order:

- **IMF PortWatch** (ArcGIS REST, no key) — daily transit counts for Hormuz,
  Suez, Bab el-Mandeb, Panama. The highest-value non-FRED source on the list and
  it is free.
- **EIA API v2** — SPR level, diesel retail, distillate and crude stocks. The
  diesel crack spread is *derived* from products and crude, not fetched.
- **NY Fed ACM term premium** — CSV.
- **NOAA / NSIDC** — Mauna Loa CO2, daily global SST, Arctic sea ice extent.
  Also the replacement for the discontinued CO2 series noted below.
- **FAO Food Price Index** and **USDA WASDE** stocks-to-use — CSV.
- **USBR** — Lake Mead and Powell storage (Reclamation HDB).
- **ACLED** — registration required; check the license before shipping publicly.
- **State DOI / FAIR plan policy counts** — no API. Needs the authenticated CSV
  import route, which is Phase 2 work; `cadence = 'manual'` already exists in the
  schema for it.

Three of the five failure modes have no members until these land, and the
dashboard says so explicitly rather than rendering an empty card as if it were a
reading of zero.

### Known upstream data issues

- `EMISSCO2TOTVTTTOUSA` (feeding `co2_per_gdp`) is **discontinued upstream** —
  last observation 2021-01-01. It renders heavily stale by design until NOAA or
  another feed replaces it.
- `net_interest_receipts` divides federal interest payments by federal current
  **tax** receipts (`W006RC1Q027SBEA`), not total receipts. The ratio is
  correspondingly higher than an interest-to-total-receipts measure.

---

## Access boundary

The publishable key the Worker reads with is public by design, so it is treated
as public: it reaches exactly seven views and nothing else. Verified directly
against PostgREST with that key:

| Reachable with the publishable key | Denied |
|---|---|
| `indicator_current` | `observations`, `indicators`, `failure_modes` |
| `indicator_sparkline` | `ingest_runs`, `analytics_meta` |
| `indicator_spark_window` | `indicator_zscores`, `indicator_zscores_mv` |
| `failure_mode_composites` | `failure_mode_composite_history` |
| `ingest_status` | `rpc/refresh_analytics`, `rpc/zscores` |
| `normalization_policy` | `rpc/composite_at` |
| `analytics_status` | |
| `rpc/composite_at_public` (production data only) | |

Two things that bit during setup and are worth knowing before editing
`migrations/0006`–`0007`:

- `revoke execute ... from anon, authenticated` **does nothing**. Postgres grants
  `EXECUTE` to `PUBLIC` on `CREATE FUNCTION` and both roles inherit it. The
  revoke has to name `PUBLIC`. Until it did, `refresh_analytics()` was callable
  by anyone holding the publishable key — a free trigger for an expensive
  rebuild.
- A view with `security_invoker = false` runs **table** access as its owner, but
  **function** `EXECUTE` is still checked against the calling role. That is why
  `failure_mode_composites` needs `composite_at_public` — a wrapper with
  `include_demo` pinned to false — rather than `composite_at` itself.

Supabase's linter reports `security_definer_view` for the seven views and
`rls_enabled_no_policy` for the base tables. Both are the intended design: the
views are the access boundary and expose only data the dashboard publishes, and
the base tables carry RLS with no policies precisely so that nothing reaches them
except the service role.
