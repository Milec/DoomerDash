-- 0005: make the normalization layer addressable by indicator.
--
-- `windowed` is referenced twice in the scoring query, so Postgres materializes
-- it, and a materialized CTE is an optimization fence: `where indicator_slug =
-- 'x'` on the view could not be pushed down, so scoring ONE indicator rescored
-- every indicator in the database and hit the statement timeout.
--
-- Same shape as composite_at: the computation takes its filter as a parameter,
-- and the view is the unfiltered call. One implementation; single-indicator
-- callers (the tests, any future per-series endpoint) get a cheap scoped query.

begin;

create or replace function zscores(p_slug text default null)
returns table (
  indicator_slug text,
  obs_date       date,
  value          numeric,
  window_n       int,
  window_p01     numeric,
  window_p99     numeric,
  window_mean    numeric,
  window_sd      numeric,
  z              numeric
) language sql stable parallel safe set search_path = public as $$
  with scored_rows as (
    select ranked.indicator_slug, ranked.obs_date, ranked.value
    from (
      select o.indicator_slug, o.obs_date, o.value,
             row_number() over (partition by o.indicator_slug order by o.obs_date desc) as rn
      from observations o
      where p_slug is null or o.indicator_slug = p_slug
    ) ranked
    -- Everything the UI can reach: the last 150 days, plus each indicator's 40
    -- most recent observations however old. The second clause keeps a
    -- discontinued or annual series scored and visibly stale rather than absent.
    where ranked.obs_date >= current_date - interval '150 days' or ranked.rn <= 40
  ),
  windowed as (
    select r.indicator_slug, r.obs_date, w.value as win_value
    from scored_rows r
    join observations w
      on w.indicator_slug = r.indicator_slug
     and w.obs_date <= r.obs_date
     and w.obs_date > (r.obs_date - (zscore_window_years() || ' years')::interval)
  ),
  bounds as (
    select w.indicator_slug, w.obs_date,
           percentile_cont(0.01) within group (order by w.win_value) as p01,
           percentile_cont(0.99) within group (order by w.win_value) as p99
    from windowed w
    group by w.indicator_slug, w.obs_date
  ),
  stats as (
    -- Winsorized moments. The clamp shapes the DISTRIBUTION only; the value
    -- being scored is never clamped, so a genuine new extreme can still print
    -- past the top of its own history.
    select w.indicator_slug, w.obs_date, b.p01, b.p99,
           count(*)::int                                           as n,
           avg(least(greatest(w.win_value, b.p01), b.p99))         as mu,
           stddev_samp(least(greatest(w.win_value, b.p01), b.p99)) as sigma
    from windowed w
    join bounds b on b.indicator_slug = w.indicator_slug and b.obs_date = w.obs_date
    group by w.indicator_slug, w.obs_date, b.p01, b.p99
  )
  select
    r.indicator_slug, r.obs_date, r.value,
    s.n, s.p01, s.p99, s.mu, s.sigma,
    case
      when s.n >= zscore_min_obs() and s.sigma is not null and s.sigma > 0
      then (case when i.higher_is_worse then 1 else -1 end) * ((r.value - s.mu) / s.sigma)
    end
  from scored_rows r
  join indicators i on i.slug = r.indicator_slug
  join stats s on s.indicator_slug = r.indicator_slug and s.obs_date = r.obs_date
$$;

comment on function zscores is
  'The normalization layer. p_slug scopes it to one indicator; null scores every indicator, which is what the materialized snapshot uses.';

drop view if exists indicator_zscores cascade;
drop materialized view if exists indicator_zscores_mv cascade;

create view indicator_zscores as select * from zscores(null);
comment on view indicator_zscores is
  'Live, uncached scores for every indicator. Expensive by design: the API reads indicator_zscores_mv, and single-indicator callers use zscores(slug).';

create materialized view indicator_zscores_mv as select * from zscores(null);
create unique index indicator_zscores_mv_pk on indicator_zscores_mv (indicator_slug, obs_date);

create view indicator_current as
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

create view indicator_sparkline as
select mv.indicator_slug, mv.obs_date, mv.value, mv.z
from indicator_zscores_mv mv
join indicators i on i.slug = mv.indicator_slug
where not is_demo_slug(i.slug)
  and mv.obs_date >= current_date - (spark_days(i.cadence) || ' days')::interval;

grant select on indicator_current, indicator_sparkline to anon;
revoke all on indicator_zscores, indicator_zscores_mv from anon, authenticated;
revoke execute on function zscores(text) from anon, authenticated;

commit;
