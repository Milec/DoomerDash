-- 0008: schema changes Phase 2 needs.
--
-- Consolidates the Phase 2 schema work (percentile rank, plain-language columns,
-- seasonal comparison, the 'derived' transform). The zscores() function itself is
-- defined once, in its final form, in 0011 - it was revised several times during
-- Phase 2 and only the end state is worth carrying.
--
-- WHY A PERCENTILE. A z-score is precise and unreadable to anyone who has not
-- taken statistics. "Worse than 94% of the last ten years" explains itself. The
-- percentile is EMPIRICAL - the actual rank inside the same trailing window -
-- not a normal-curve conversion of z, because these distributions are skewed and
-- fat-tailed and pushing z through a normal CDF would quietly invent a number.
--
-- WHY SEASONAL COMPARISON. Phase 1 was all financial series with no seasonal
-- cycle. Phase 2 brings Arctic sea ice, reservoir storage and fuel stockpiles,
-- which swing hugely with the calendar. Scoring September sea ice against a full
-- ten-year window measures "it is September", not "this is unusual". Indicators
-- flagged seasonal are compared against the same time of year instead, which is
-- how these series are conventionally reported and keeps the published claim
-- honest: still the indicator's own history, just the comparable part of it.

begin;

alter table indicators    add column if not exists explainer text;
alter table indicators    add column if not exists seasonal boolean not null default false;
alter table failure_modes add column if not exists explainer text;
alter table failure_modes add column if not exists plain_question text;
alter table failure_modes add column if not exists is_visible boolean not null default true;

comment on column indicators.explainer is
  'Plain language: what this measures and why it matters, for someone with no finance or climate background.';
comment on column indicators.seasonal is
  'When true the trailing window is restricted to the same time of year (+/- seasonal_window_days), so the score measures anomaly rather than season.';
comment on column failure_modes.plain_question is
  'The one question this bucket answers, in plain words.';
comment on column failure_modes.is_visible is
  'False for non-production buckets (the test harness). Presentation views filter on it.';

alter table indicators drop constraint if exists indicators_transform_check;
alter table indicators add constraint indicators_transform_check
  check (transform in ('level','yoy_pct','diff','ratio','derived'));

comment on column indicators.transform is
  'How the connector derives the stored analytic value. "derived" means the connector computes it from more than one upstream series; see source_series_id.';

create or replace function seasonal_window_days() returns int
  language sql immutable parallel safe set search_path = public as $$ select 15 $$;

-- Distance in days-of-year, wrapping at the year boundary so 31 Dec and 1 Jan
-- are one day apart, not 364.
create or replace function doy_distance(a date, b date) returns int
  language sql immutable parallel safe set search_path = public as $$
  select least(
    abs(extract(doy from a)::int - extract(doy from b)::int),
    366 - abs(extract(doy from a)::int - extract(doy from b)::int)
  )
$$;

-- Failure-mode rows, including the two invisible test-harness buckets, are
-- seeded in 0009.

revoke execute on function doy_distance(date,date), seasonal_window_days() from public;

commit;
