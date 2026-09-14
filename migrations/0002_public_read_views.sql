-- 0002: the read surface.
--
-- The dashboard is public data, so the read path runs on the publishable/anon
-- key rather than the service role. anon is granted SELECT on exactly these
-- views and nothing else; the base tables stay revoked. The views are owned by
-- postgres and run with owner rights, so anon reaches the underlying tables
-- only through the shape defined here.

begin;

-- Sparkline span per cadence. A 90-day window on a quarterly series is one
-- point, so low-cadence series get a longer window and the UI labels the span.
create or replace function spark_days(cad text) returns int
  language sql immutable parallel safe as $$
  select case cad
    when 'daily'     then 90
    when 'weekly'    then 180
    when 'monthly'   then 730
    when 'quarterly' then 1825
    when 'annual'    then 3650
    else 365
  end
$$;

create or replace view indicator_sparkline as
select mv.indicator_slug, mv.obs_date, mv.value, mv.z
from indicator_zscores_mv mv
join indicators i on i.slug = mv.indicator_slug
where not is_demo_slug(i.slug)
  and mv.obs_date >= current_date - (spark_days(i.cadence) || ' days')::interval;

create or replace view normalization_policy as
select composite_window_days() as composite_window_days,
       zscore_window_years()   as zscore_window_years,
       zscore_min_obs()        as zscore_min_obs;

create or replace view analytics_status as
select refreshed_at from analytics_meta where only_row;

create or replace view indicator_spark_window as
select slug, spark_days(cadence) as spark_days
from indicators
where not is_demo_slug(slug);

grant select on
  indicator_current,
  indicator_sparkline,
  indicator_spark_window,
  failure_mode_composites,
  ingest_status,
  normalization_policy,
  analytics_status
to anon;

revoke all on indicator_sparkline, indicator_spark_window, normalization_policy, analytics_status
  from authenticated;

commit;
