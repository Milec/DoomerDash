-- 0007: actually revoke function EXECUTE, and split the composite entry point.
--
-- Two real holes, both from assumptions that did not hold:
--
--   1. `revoke execute ... from anon, authenticated` does nothing. Postgres
--      grants EXECUTE to PUBLIC by default on CREATE FUNCTION and both roles
--      inherit it. refresh_analytics() was callable by anyone holding the
--      publishable key - a free trigger for an expensive materialized view
--      rebuild - and composite_at(as_of, include_demo => true) exposed demo
--      fixtures over RPC. The revoke has to name PUBLIC.
--
--   2. A view with security_invoker = false runs TABLE access as its owner, but
--      function EXECUTE is still checked against the calling role. So anon does
--      need EXECUTE on whatever failure_mode_composites calls - which is why
--      revoking composite_at broke that view. Rather than hand anon the
--      include_demo parameter, expose a wrapper with the flag pinned false.

begin;

revoke execute on function refresh_analytics()                 from public;
revoke execute on function zscores(text)                       from public;
revoke execute on function composite_at(date, boolean)         from public;
revoke execute on function composite_status(int, int, numeric) from public;
revoke execute on function composite_window_days()             from public;
revoke execute on function zscore_window_years()               from public;
revoke execute on function zscore_min_obs()                    from public;
revoke execute on function spark_days(text)                    from public;
revoke execute on function is_demo_slug(text)                  from public;

-- Ingest and the test suite authenticate as service_role.
grant execute on function refresh_analytics()                 to service_role;
grant execute on function zscores(text)                       to service_role;
grant execute on function composite_at(date, boolean)         to service_role;
grant execute on function composite_status(int, int, numeric) to service_role;

-- Reached through SECURITY DEFINER paths, where a mutable search_path is a
-- hijack vector.
alter function composite_window_days()             set search_path = public;
alter function zscore_window_years()               set search_path = public;
alter function zscore_min_obs()                    set search_path = public;
alter function is_demo_slug(text)                  set search_path = public;
alter function spark_days(text)                    set search_path = public;
alter function composite_status(int, int, numeric) set search_path = public;

-- The only composite entry point anon gets: include_demo is not a parameter.
create or replace function composite_at_public(as_of date)
returns table (
  failure_mode text,
  member_count int,
  fresh_count  int,
  composite_z  numeric
) language sql stable parallel safe security definer set search_path = public as $$
  select * from composite_at(as_of, false)
$$;

create or replace view failure_mode_composites as
select
  fm.slug as failure_mode,
  fm.label,
  fm.subtitle,
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
left join lateral composite_at_public(current_date - 30) prev on prev.failure_mode = fm.slug;

alter view failure_mode_composites set (security_invoker = false);

revoke execute on function composite_at_public(date) from public;
grant  execute on function composite_at_public(date) to anon, service_role;

-- Pure arithmetic over three scalars; reaches no data.
grant execute on function composite_status(int, int, numeric) to anon;

grant select on failure_mode_composites to anon;
revoke all on failure_mode_composites from authenticated;

commit;
