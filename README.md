# DoomerDash

**Live: https://doomerdash.mikie-mcconaghy3.workers.dev**

Systemic risk indicators across five failure modes, normalized so they can be
compared to each other.

Every indicator is displayed as a **z-score against its own trailing ten-year
distribution**, direction-normalized so that **positive always means worse**.
Raw values are secondary. The dashboard answers one question per panel: *is this
getting worse relative to its own history?*

**Phase 2 is live.** 32 indicators across six sources — FRED, EIA, IMF
PortWatch, NOAA/NSIDC, FAO and USBR — filling all five failure modes.

Every reading is shown twice: as a plain sentence ("worse than 94% of the past
decade") and as a score for people who want one. The percentile is the empirical
rank inside the indicator's own trailing window, not a normal-curve conversion of
the z-score — these distributions are skewed and fat-tailed, and pushing z
through a normal CDF would quietly invent a number.

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
wrangler secret put EIA_API_KEY                # eia.gov/opendata/register.php
wrangler secret put INGEST_TOKEN               # bearer guarding POST /api/ingest
```

For local work put the same five in `.dev.vars` (gitignored; `.dev.vars.example`
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

### Performance, and a bug worth remembering

Scoring is precomputed into the `indicator_scores` table. Ingest calls
`refresh_scores(slug)` for each indicator as its rows land, so no page load ever
runs the windowed percentile query. `analytics_status` exposes the last rebuild
time, which the footer shows, so a stale snapshot is visible rather than silent.

This started as a materialized view rebuilt in one statement. Once Phase 2
tripled the row count that statement exceeded PostgREST's 8s cap, and
`SET LOCAL statement_timeout` inside the refresh function could not help — the
timer belongs to the statement already executing the function, so raising it
mid-flight does nothing. The failure was silent: ingest reported success, scores
never rebuilt, and the dashboard would have frozen at its last computed values
while still looking live. Per-indicator rescoring means there is no long-running
statement anywhere, and a slow source cannot stop the others being scored.
Nothing here should reintroduce a whole-database rebuild on a request path.

For a single indicator call `zscores('slug')`. Do **not** filter
`indicator_zscores` by slug: its `windowed` CTE is referenced twice and therefore
materialized, which fences off predicate push-down and rescores everything.

    npm run rescore    # rescore every indicator, one at a time

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

Fixtures are created and torn down under the `demo_` prefix, inside two
`is_visible = false` failure modes that production views filter out. They
originally borrowed `supply_conflict` because it happened to be empty; Phase 2
filled it and the tests broke, correctly. Test isolation is now a property of the
schema rather than a coincidence about which buckets are empty.

Set `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` (in `.dev.vars` or the environment)
or the suite skips.

---

## Phase 2: what shipped

| Source | Key | Indicators |
|---|---|---|
| **FRED** | yes | 18 — rates, spreads, inflation, labour, plus the NY Fed ACM term premium and two policy-uncertainty indices |
| **EIA v2** | yes | 5 — SPR level, retail diesel, crude and distillate stocks, and the **derived** diesel crack spread |
| **IMF PortWatch** | no | 4 — daily transits through Hormuz, Suez, Bab el-Mandeb and Panama |
| **NOAA / NSIDC** | no | 2 — Mauna Loa CO₂, Arctic sea ice extent |
| **USBR** | no | 2 — Lake Mead and Lake Powell storage |
| **FAO** | no | 1 — Food Price Index |

The NY Fed ACM term premium needed no connector at all: FRED publishes it as
`THREEFYTP10`, so it was a database insert. That is the connector interface
working as intended.

### Seasonal comparison

Arctic sea ice, reservoir storage and fuel stockpiles swing enormously with the
calendar. Scoring September sea ice against a full ten-year window measures *it
is September*, not *this is unusual*. Indicators flagged `seasonal` are compared
against the same time of year instead — every observation within ±15 days-of-year
across the window. Rows say so in the UI. It is still the indicator's own
history, just the part of it that is comparable.

### Deliberately not shipped

- **ACLED** — registration required, and its licence does not permit
  redistributing the data from a public URL. Left out rather than shipped in
  breach of terms. The spec said to check before exposing it publicly; this is
  the result of checking.
- **Daily global sea surface temperature** — the usual free feed (Climate
  Reanalyzer's `oisst2.1` JSON) stopped updating in September 2024, and its other
  filenames now redirect to the site root. Shipping a series two years behind as
  a daily indicator is precisely the failure this dashboard exists to avoid, so
  it needs a live replacement first.
- **USDA WASDE stocks-to-use** — the PSD API needs its own key and the only
  keyless path is a 2.8 MB zip, which would mean adding a decompression
  dependency. Better suited to the manual CSV route.
- **The authenticated CSV import route** — still unbuilt. `cadence = 'manual'`
  exists in the schema for it.

### A caveat on the Institutional bucket

Its two members (`policy_uncertainty`, `equity_uncertainty`) share a
methodology and authorship, so they are correlated: the bucket is effectively one
signal measured twice, and its composite should be read as weaker evidence than a
bucket of six independent measures. Better institutional indicators are the most
valuable thing to add next.

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
