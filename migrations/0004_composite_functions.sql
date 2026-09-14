-- 0004: single-source the composite rule.
--
-- The composite logic was inlined in two views, and the production views exclude
-- demo_ slugs, which left the rule untestable without duplicating it. It now
-- lives in one function that takes an as-of date and a flag for whether demo
-- fixtures participate. Production passes false; tests pass true and drive
-- fixtures through a failure mode that has no real members. The SQL under test
-- is the SQL that ships.

begin;

create or replace function composite_status(
  member_count int, fresh_count int, composite_z numeric
) returns text language sql immutable parallel safe as $$
  select case
    when coalesce(member_count, 0) = 0        then 'no_members'
    when fresh_count * 2 < member_count       then 'insufficient_members'
    when composite_z is null                  then 'insufficient_members'
    else 'ok'
  end
$$;

comment on function composite_status is
  'A bucket needs at least half its members fresh. Exactly half is enough; below half is unavailable rather than computed from the survivors.';

create or replace function composite_at(as_of date, include_demo boolean default false)
returns table (
  failure_mode text,
  member_count int,
  fresh_count  int,
  composite_z  numeric
) language sql stable parallel safe as $$
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

create or replace view failure_mode_composite_history as
select s.d, c.failure_mode, c.member_count, c.fresh_count, c.composite_z
from generate_series(current_date - interval '120 days', current_date, interval '1 day') s(d)
cross join lateral composite_at(s.d::date, false) c;

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
left join lateral composite_at(current_date, false)      cur  on cur.failure_mode  = fm.slug
left join lateral composite_at(current_date - 30, false) prev on prev.failure_mode = fm.slug;

grant select on failure_mode_composites, failure_mode_composite_history to anon;
revoke all on failure_mode_composite_history from anon;
revoke execute on function composite_at(date, boolean) from anon, authenticated;

commit;
