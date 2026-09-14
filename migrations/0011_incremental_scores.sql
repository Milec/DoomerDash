-- 0011: scoring becomes a table, refreshed one indicator at a time.
--
-- THE BUG THIS FIXES. Scoring lived in a materialized view rebuilt by
-- REFRESH MATERIALIZED VIEW - one statement covering every indicator. Once
-- Phase 2 tripled the row count that statement exceeded PostgREST's 8s cap.
-- `SET LOCAL statement_timeout` inside the refresh function could not help: the
-- timer belongs to the statement already executing the function, so raising it
-- mid-flight does nothing.
--
-- The failure was silent and serious. Ingest reported success, scores never
-- rebuilt, and the dashboard would have frozen at whatever it last computed
-- while still looking live - the exact failure mode this project exists to
-- avoid. Ingest now rescores each indicator as it lands: one small statement
-- each, no single long-running statement anywhere, and a slow source cannot
-- stop the others from being scored.
--
-- Scored rows cost (rows) x (window size), so only rows something reads are
-- scored: the last 60 days plus each indicator's 40 most recent observations
-- however old. The API needs a score in exactly two places - the latest
-- observation, and the latest as of 30 days ago for the trend arrow. Sparklines
-- plot raw values and read `observations` directly, so they cost nothing here.

begin;

create table if not exists indicator_scores (
  indicator_slug text not null references indicators(slug) on delete cascade,
  obs_date       date not null,
  value          numeric not null,
  window_n       int,
  window_p01     numeric,
  window_p99     numeric,
  window_mean    numeric,
  window_sd      numeric,
  z              numeric,
  pct_worse      numeric,
  seasonal       boolean,
  scored_at      timestamptz not null default now(),
  primary key (indicator_slug, obs_date)
);

create index if not exists indicator_scores_slug_date_desc
  on indicator_scores (indicator_slug, obs_date desc);

alter table indicator_scores enable row level security;
revoke all on indicator_scores from anon, authenticated;

drop view if exists indicator_zscores cascade;
drop materialized view if exists indicator_zscores_mv cascade;
drop function if exists zscores(text);

-- The normalization layer, in its final form. p_slug scopes it to one indicator;
-- null covers every indicator.
--
-- Winsorization clamps the window used to estimate mean and sd. It does NOT
-- clamp the observation being scored: the point is to stop one freak print from
-- permanently inflating sigma, whereas capping the current print would make the
-- dashboard under-report exactly the crisis it exists to detect.
create function zscores(p_slug text default null)
returns table (
  indicator_slug text, obs_date date, value numeric, window_n int,
  window_p01 numeric, window_p99 numeric, window_mean numeric, window_sd numeric,
  z numeric, pct_worse numeric, seasonal boolean
) language sql stable parallel safe set search_path = public as $$
  with scored_rows as (
    select ranked.indicator_slug, ranked.obs_date, ranked.value
    from (
      select o.indicator_slug, o.obs_date, o.value,
             row_number() over (partition by o.indicator_slug order by o.obs_date desc) as rn
      from observations o
      where p_slug is null or o.indicator_slug = p_slug
    ) ranked
    where ranked.obs_date >= current_date - interval '60 days' or ranked.rn <= 40
  ),
  windowed as (
    select r.indicator_slug, r.obs_date, r.value as scored_value, w.value as win_value
    from scored_rows r
    join indicators i on i.slug = r.indicator_slug
    join observations w
      on w.indicator_slug = r.indicator_slug
     and w.obs_date <= r.obs_date
     and w.obs_date > (r.obs_date - (zscore_window_years() || ' years')::interval)
     and (not i.seasonal or doy_distance(w.obs_date, r.obs_date) <= seasonal_window_days())
  ),
  bounds as (
    select w.indicator_slug, w.obs_date,
           percentile_cont(0.01) within group (order by w.win_value) as p01,
           percentile_cont(0.99) within group (order by w.win_value) as p99
    from windowed w group by w.indicator_slug, w.obs_date
  ),
  stats as (
    select w.indicator_slug, w.obs_date, b.p01, b.p99,
           count(*)::int                                           as n,
           avg(least(greatest(w.win_value, b.p01), b.p99))         as mu,
           stddev_samp(least(greatest(w.win_value, b.p01), b.p99)) as sigma,
           -- Mid-rank percentile of the scored value within its own window.
           (count(*) filter (where w.win_value < w.scored_value)
            + 0.5 * count(*) filter (where w.win_value = w.scored_value))::numeric
             / nullif(count(*), 0)                                 as pct_below
    from windowed w
    join bounds b on b.indicator_slug = w.indicator_slug and b.obs_date = w.obs_date
    group by w.indicator_slug, w.obs_date, b.p01, b.p99
  )
  select r.indicator_slug, r.obs_date, r.value, s.n, s.p01, s.p99, s.mu, s.sigma,
    case when s.n >= zscore_min_obs() and s.sigma is not null and s.sigma > 0
         then (case when i.higher_is_worse then 1 else -1 end) * ((r.value - s.mu) / s.sigma) end,
    -- Direction-normalized, so this always reads "worse than N% of the window".
    case when s.n >= zscore_min_obs()
         then round(100 * (case when i.higher_is_worse then s.pct_below else 1 - s.pct_below end), 1) end,
    i.seasonal
  from scored_rows r
  join indicators i on i.slug = r.indicator_slug
  join stats s on s.indicator_slug = r.indicator_slug and s.obs_date = r.obs_date
$$;

create view indicator_zscores as select * from zscores(null);
comment on view indicator_zscores is
  'Live, uncached scores for every indicator. Expensive by design: readers use indicator_scores, and single-indicator callers use zscores(slug).';

/** Rescore one indicator. Small enough to finish well inside any request budget. */
create or replace function refresh_scores(p_slug text) returns int
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from indicator_scores where indicator_slug = p_slug;
  insert into indicator_scores (
    indicator_slug, obs_date, value, window_n, window_p01, window_p99,
    window_mean, window_sd, z, pct_worse, seasonal
  )
  select indicator_slug, obs_date, value, window_n, window_p01, window_p99,
         window_mean, window_sd, z, pct_worse, seasonal
  from zscores(p_slug);
  get diagnostics n = row_count;
  update analytics_meta set refreshed_at = now() where only_row;
  return n;
end $$;

-- Whole-database rescore. Fine from a script or psql; the Worker uses the
-- per-slug form so it never depends on this finishing inside a request.
create or replace function refresh_analytics() returns timestamptz
  language plpgsql security definer set search_path = public as $$
declare s text; ts timestamptz;
begin
  for s in select slug from indicators order by slug loop
    perform refresh_scores(s);
  end loop;
  ts := now();
  update analytics_meta set refreshed_at = ts where only_row;
  return ts;
end $$;

create or replace function composite_at(as_of date, include_demo boolean default false)
returns table (
  failure_mode text, member_count int, fresh_count int, composite_z numeric
) language sql stable parallel safe security definer set search_path = public as $$
  with members as (
    select i.slug, i.failure_mode from indicators i
    where not i.is_counter and (include_demo or not is_demo_slug(i.slug))
  ),
  latest as (
    select fm.slug as failure_mode, m.slug as indicator_slug, z.z, z.obs_date
    from failure_modes fm
    left join members m on m.failure_mode = fm.slug
    left join lateral (
      select s.z, s.obs_date from indicator_scores s
      where s.indicator_slug = m.slug and s.obs_date <= as_of and s.z is not null
      order by s.obs_date desc limit 1
    ) z on true
  )
  select failure_mode,
         count(indicator_slug)::int,
         count(*) filter (where z is not null and (as_of - obs_date) <= composite_window_days())::int,
         avg(z) filter (where z is not null and (as_of - obs_date) <= composite_window_days())
  from latest group by failure_mode
$$;

create or replace view indicator_current as
select
  i.slug, i.name, i.failure_mode, i.source, i.source_series_id, i.unit,
  i.cadence, i.higher_is_worse, i.transform, i.is_counter, i.seasonal,
  i.stale_after_days, i.notes, i.explainer, i.source_url, i.license, i.display_order,
  z.obs_date, z.value, z.z, z.pct_worse, z.window_n,
  (current_date - z.obs_date)::int                       as age_days,
  ((current_date - z.obs_date)::int > i.stale_after_days) as is_stale
from indicators i
left join lateral (
  select s.obs_date, s.value, s.z, s.pct_worse, s.window_n
  from indicator_scores s
  where s.indicator_slug = i.slug
  order by s.obs_date desc limit 1
) z on true
where not is_demo_slug(i.slug);

-- Raw values straight off the base table: sparklines plot values, not scores.
create or replace view indicator_sparkline as
select o.indicator_slug, o.obs_date, o.value
from observations o
join indicators i on i.slug = o.indicator_slug
where not is_demo_slug(i.slug)
  and o.obs_date >= current_date - (spark_days(i.cadence) || ' days')::interval;

create or replace view normalization_policy as
select composite_window_days() as composite_window_days,
       zscore_window_years()   as zscore_window_years,
       zscore_min_obs()        as zscore_min_obs,
       seasonal_window_days()  as seasonal_window_days;

drop view if exists failure_mode_composites cascade;
create view failure_mode_composites as
select
  fm.slug as failure_mode, fm.label, fm.subtitle, fm.plain_question, fm.explainer,
  fm.display_order,
  coalesce(cur.member_count, 0) as member_count,
  coalesce(cur.fresh_count, 0)  as fresh_count,
  composite_status(cur.member_count, cur.fresh_count, cur.composite_z) as status,
  case when composite_status(cur.member_count, cur.fresh_count, cur.composite_z) = 'ok'
       then cur.composite_z end as composite_z,
  case when composite_status(prev.member_count, prev.fresh_count, prev.composite_z) = 'ok'
       then prev.composite_z end as composite_z_30d_ago
from failure_modes fm
left join lateral composite_at_public(current_date)      cur  on cur.failure_mode  = fm.slug
left join lateral composite_at_public(current_date - 30) prev on prev.failure_mode = fm.slug
where fm.is_visible;

alter view indicator_current       set (security_invoker = false);
alter view indicator_sparkline     set (security_invoker = false);
alter view normalization_policy    set (security_invoker = false);
alter view failure_mode_composites set (security_invoker = false);

grant select on indicator_current, indicator_sparkline, normalization_policy,
                failure_mode_composites to anon;
revoke all on indicator_current, indicator_sparkline, normalization_policy,
              failure_mode_composites from authenticated;
revoke all on indicator_zscores, indicator_scores from anon, authenticated;
revoke execute on function zscores(text), refresh_scores(text), refresh_analytics() from public;
grant execute on function zscores(text), refresh_scores(text), refresh_analytics() to service_role;

commit;
