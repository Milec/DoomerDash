-- DoomerDash: systemic risk dashboard
-- 0001_init: core schema, normalization layer, Phase 1 indicator seed.
--
-- Design notes that matter when reading this file:
--
--   * observations.value stores the ANALYTIC value of the indicator, not the raw
--     upstream series. An indicator defined as a YoY percent change stores the
--     percent change; one defined as a ratio stores the ratio. `transform`
--     documents how the connector derived it. This keeps the z-score layer a pure
--     function of one column, and makes the "raw value" shown in the UI the number
--     the indicator actually claims to be.
--
--   * There is no NULL value and no gap-filling anywhere. A missing observation is
--     an absent row. Never add an interpolation step here.
--
--   * Winsorization clamps the window used to estimate mean/sd. It does NOT clamp
--     the observation being scored. The point of winsorizing is to stop one
--     COVID-era print from permanently inflating sigma and flattening the scale;
--     capping the current print would make the dashboard under-report exactly the
--     crisis it exists to detect.

begin;

-- ---------------------------------------------------------------------------
-- Reference: the five failure modes
-- ---------------------------------------------------------------------------

create table if not exists failure_modes (
  slug          text primary key,
  label         text not null,
  subtitle      text not null,
  display_order int  not null
);

insert into failure_modes (slug, label, subtitle, display_order) values
  ('fiscal_monetary',  'Fiscal & Monetary', 'Credibility of the sovereign and the central bank', 1),
  ('credit_plumbing',  'Credit & Plumbing', 'Where a slow story turns fast',                     2),
  ('physical_resource','Physical Resource', 'Energy, food, water, climate',                      3),
  ('supply_conflict',  'Supply & Conflict', 'Chokepoints, shipping, armed conflict',             4),
  ('institutional',    'Institutional',     'Whether the machine still functions',               5)
on conflict (slug) do update
  set label = excluded.label,
      subtitle = excluded.subtitle,
      display_order = excluded.display_order;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists indicators (
  slug              text primary key,
  name              text not null,
  failure_mode      text not null references failure_modes(slug),
  source            text not null,
  source_series_id  text,
  unit              text,
  cadence           text not null check (cadence in (
                      'daily','weekly','monthly','quarterly','annual','manual')),
  higher_is_worse   boolean not null,
  transform         text not null default 'level' check (transform in (
                      'level','yoy_pct','diff','ratio')),
  is_counter        boolean not null default false,
  stale_after_days  int not null check (stale_after_days > 0),
  notes             text,
  source_url        text,
  license           text,
  display_order     int not null default 100,
  created_at        timestamptz not null default now()
);

comment on column indicators.source_series_id is
  'Upstream identifier. For transform=''ratio'' this is "NUMERATOR/DENOMINATOR".';
comment on column indicators.stale_after_days is
  'Age in days past which this indicator renders stale. Set from cadence plus the publisher''s release lag.';
comment on column indicators.cadence is
  '"manual" means there is no feed; observations arrive through the authenticated CSV import route.';

create table if not exists observations (
  indicator_slug  text not null references indicators(slug) on delete cascade,
  obs_date        date not null,
  value           numeric not null,
  ingested_at     timestamptz not null default now(),
  primary key (indicator_slug, obs_date)
);

create index if not exists observations_slug_date_desc
  on observations (indicator_slug, obs_date desc);

create table if not exists ingest_runs (
  id            bigint generated always as identity primary key,
  source        text not null,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  status        text not null check (status in ('running','success','partial','error')),
  rows_upserted int not null default 0,
  error_text    text
);

create index if not exists ingest_runs_source_started
  on ingest_runs (source, started_at desc);

-- Single-row table recording when the z-score snapshot was last rebuilt, so the
-- UI can show analytics staleness rather than silently serving old scores.
create table if not exists analytics_meta (
  only_row     boolean primary key default true check (only_row),
  refreshed_at timestamptz
);
insert into analytics_meta (only_row, refreshed_at) values (true, null)
  on conflict (only_row) do nothing;

-- ---------------------------------------------------------------------------
-- Normalization policy constants
-- ---------------------------------------------------------------------------

-- A member contributes to its bucket's composite only if its most recent
-- observation is within this many days of the as-of date. Change here to change
-- the policy everywhere. See README "Composite freshness" for the trade-off.
create or replace function composite_window_days() returns int
  language sql immutable parallel safe as $$ select 90 $$;

create or replace function zscore_window_years() returns int
  language sql immutable parallel safe as $$ select 10 $$;

-- Minimum observations inside the trailing window before any z-score is emitted.
create or replace function zscore_min_obs() returns int
  language sql immutable parallel safe as $$ select 24 $$;

create or replace function is_demo_slug(s text) returns boolean
  language sql immutable parallel safe as $$ select s like 'demo\_%' $$;

-- ---------------------------------------------------------------------------
-- indicator_zscores: the normalization layer
-- ---------------------------------------------------------------------------
--
-- For each scored observation, build the trailing window of that indicator's
-- observations ending at (and including) that observation's date, winsorize the
-- window at the 1st/99th percentile, and score the raw value against the
-- winsorized mean and sample sd. Flip sign so positive is always "worse".
--
-- Scoring is limited to rows the UI can reach: anything in the last 400 days,
-- plus each indicator's 40 most recent observations regardless of age. That
-- second clause keeps a discontinued or very low-cadence series scored and
-- visibly stale instead of silently vanishing from the board.

create or replace view indicator_zscores as
with scored_rows as (
  select indicator_slug, obs_date, value
  from (
    select o.indicator_slug, o.obs_date, o.value,
           row_number() over (partition by o.indicator_slug order by o.obs_date desc) as rn
    from observations o
  ) ranked
  where obs_date >= current_date - interval '400 days' or rn <= 40
)
select
  r.indicator_slug,
  r.obs_date,
  r.value,
  s.n     as window_n,
  s.p01   as window_p01,
  s.p99   as window_p99,
  s.mu    as window_mean,
  s.sigma as window_sd,
  case
    when s.n >= zscore_min_obs() and s.sigma is not null and s.sigma > 0
    then (case when i.higher_is_worse then 1 else -1 end) * ((r.value - s.mu) / s.sigma)
  end     as z
from scored_rows r
join indicators i on i.slug = r.indicator_slug
cross join lateral (
  with win as (
    select w.value
    from observations w
    where w.indicator_slug = r.indicator_slug
      and w.obs_date <= r.obs_date
      and w.obs_date > (r.obs_date - (zscore_window_years() || ' years')::interval)
  ), q as (
    select percentile_cont(0.01) within group (order by value) as p01,
           percentile_cont(0.99) within group (order by value) as p99
    from win
  )
  select
    count(*)::int                                       as n,
    q.p01,
    q.p99,
    avg(least(greatest(win.value, q.p01), q.p99))       as mu,
    stddev_samp(least(greatest(win.value, q.p01), q.p99)) as sigma
  from win cross join q
  group by q.p01, q.p99
) s;

comment on view indicator_zscores is
  'Live (uncached) normalization layer. Correct but expensive; the API reads indicator_zscores_mv. Tests target this view directly so they exercise the real SQL.';

-- Materialized snapshot the API serves from. Rebuilt by refresh_analytics().
create materialized view if not exists indicator_zscores_mv as
  select * from indicator_zscores;

create unique index if not exists indicator_zscores_mv_pk
  on indicator_zscores_mv (indicator_slug, obs_date);

create or replace function refresh_analytics() returns timestamptz
  language plpgsql security definer set search_path = public as $$
declare ts timestamptz;
begin
  begin
    refresh materialized view concurrently indicator_zscores_mv;
  exception when others then
    -- CONCURRENTLY requires an already-populated view; fall back on first run.
    refresh materialized view indicator_zscores_mv;
  end;
  ts := now();
  update analytics_meta set refreshed_at = ts where only_row;
  return ts;
end $$;

-- ---------------------------------------------------------------------------
-- Presentation views. demo_ slugs are excluded from every one of them.
-- ---------------------------------------------------------------------------

create or replace view indicator_current as
select
  i.slug, i.name, i.failure_mode, i.source, i.source_series_id, i.unit,
  i.cadence, i.higher_is_worse, i.transform, i.is_counter,
  i.stale_after_days, i.notes, i.source_url, i.license, i.display_order,
  z.obs_date, z.value, z.z, z.window_n,
  (current_date - z.obs_date)::int                       as age_days,
  ((current_date - z.obs_date)::int > i.stale_after_days) as is_stale
from indicators i
left join lateral (
  select m.obs_date, m.value, m.z, m.window_n
  from indicator_zscores_mv m
  where m.indicator_slug = i.slug
  order by m.obs_date desc
  limit 1
) z on true
where not is_demo_slug(i.slug);

create or replace view failure_mode_composite_history as
with spine as (
  select generate_series(current_date - interval '120 days', current_date, interval '1 day')::date as d
),
members as (
  select slug, failure_mode from indicators
  where not is_counter and not is_demo_slug(slug)
),
as_of as (
  select s.d, fm.slug as failure_mode, m.slug as indicator_slug, z.z, z.obs_date
  from spine s
  cross join failure_modes fm
  left join members m on m.failure_mode = fm.slug
  left join lateral (
    select mv.z, mv.obs_date
    from indicator_zscores_mv mv
    where mv.indicator_slug = m.slug and mv.obs_date <= s.d and mv.z is not null
    order by mv.obs_date desc
    limit 1
  ) z on true
)
select
  d,
  failure_mode,
  count(indicator_slug)::int as member_count,
  count(*) filter (
    where z is not null and (d - obs_date) <= composite_window_days()
  )::int as fresh_count,
  avg(z) filter (
    where z is not null and (d - obs_date) <= composite_window_days()
  ) as composite_z
from as_of
group by d, failure_mode;

-- One row per failure mode: current composite, the composite 30 days ago, and an
-- explicit status so the UI never has to infer why a number is missing.
create or replace view failure_mode_composites as
select
  fm.slug          as failure_mode,
  fm.label,
  fm.subtitle,
  fm.display_order,
  coalesce(cur.member_count, 0) as member_count,
  coalesce(cur.fresh_count, 0)  as fresh_count,
  case
    when coalesce(cur.member_count, 0) = 0             then 'no_members'
    when cur.fresh_count * 2 < cur.member_count        then 'insufficient_members'
    when cur.composite_z is null                       then 'insufficient_members'
    else 'ok'
  end as status,
  case when cur.member_count > 0 and cur.fresh_count * 2 >= cur.member_count
       then cur.composite_z end as composite_z,
  case when prev.member_count > 0 and prev.fresh_count * 2 >= prev.member_count
       then prev.composite_z end as composite_z_30d_ago
from failure_modes fm
left join failure_mode_composite_history cur
  on cur.failure_mode = fm.slug and cur.d = current_date
left join failure_mode_composite_history prev
  on prev.failure_mode = fm.slug and prev.d = current_date - 30;

create or replace view ingest_status as
select
  source,
  max(started_at) filter (where status = 'success')      as last_success_at,
  max(started_at)                                        as last_run_at,
  (array_agg(status        order by started_at desc))[1] as last_status,
  (array_agg(rows_upserted order by started_at desc))[1] as last_rows_upserted,
  (array_agg(error_text    order by started_at desc))[1] as last_error_text
from ingest_runs
group by source;

-- ---------------------------------------------------------------------------
-- Lockdown. The browser never talks to Supabase; the Worker uses the service
-- role key, which bypasses RLS. anon/authenticated get nothing.
-- ---------------------------------------------------------------------------

alter table failure_modes  enable row level security;
alter table indicators     enable row level security;
alter table observations   enable row level security;
alter table ingest_runs    enable row level security;
alter table analytics_meta enable row level security;

revoke all on failure_modes, indicators, observations, ingest_runs, analytics_meta
  from anon, authenticated;
revoke all on indicator_zscores, indicator_zscores_mv, indicator_current,
              failure_mode_composite_history, failure_mode_composites, ingest_status
  from anon, authenticated;
revoke execute on function refresh_analytics() from anon, authenticated;

commit;
