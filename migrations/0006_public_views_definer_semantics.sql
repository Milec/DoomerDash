-- 0006: make the view layer the access boundary it was meant to be.
--
-- These views are created with security_invoker = true by default, which sends
-- anon straight at the revoked base tables and fails. That inverts the design:
-- the views are supposed to BE the boundary, exposing exactly the public shapes
-- (demo_ fixtures filtered out inside) while the base tables stay unreachable.
--
-- Definer semantics here are deliberate. Supabase's linter flags the pattern
-- because such a view can leak RLS-protected rows; there are none to leak - every
-- column these views expose is data the dashboard publishes anyway, and the base
-- tables remain revoked and RLS-enabled so nothing outside these shapes is
-- reachable with the publishable key.

begin;

alter view indicator_current       set (security_invoker = false);
alter view indicator_sparkline     set (security_invoker = false);
alter view indicator_spark_window  set (security_invoker = false);
alter view failure_mode_composites set (security_invoker = false);
alter view ingest_status           set (security_invoker = false);
alter view normalization_policy    set (security_invoker = false);
alter view analytics_status        set (security_invoker = false);

-- composite_at is called by failure_mode_composites and must run with the
-- owner's rights too, or the view's definer semantics stop at the call site.
create or replace function composite_at(as_of date, include_demo boolean default false)
returns table (
  failure_mode text,
  member_count int,
  fresh_count  int,
  composite_z  numeric
) language sql stable parallel safe security definer set search_path = public as $$
  with members as (
    select i.slug, i.failure_mode
    from indicators i
    where not i.is_counter
      and (include_demo or not is_demo_slug(i.slug))
  ),
  latest as (
    select fm.slug as failure_mode, m.slug as indicator_slug, z.z, z.obs_date
    from failure_modes fm
    left join members m on m.failure_mode = fm.slug
    left join lateral (
      select mv.z, mv.obs_date
      from indicator_zscores_mv mv
      where mv.indicator_slug = m.slug
        and mv.obs_date <= as_of
        and mv.z is not null
      order by mv.obs_date desc
      limit 1
    ) z on true
  )
  select
    failure_mode,
    count(indicator_slug)::int,
    count(*) filter (
      where z is not null and (as_of - obs_date) <= composite_window_days()
    )::int,
    avg(z) filter (
      where z is not null and (as_of - obs_date) <= composite_window_days()
    )
  from latest
  group by failure_mode
$$;

commit;
