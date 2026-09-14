-- 0009: the failure modes, with plain-language content.
--
-- Six visible buckets. The environment was split out of physical_resource:
-- that bucket had become an energy bucket with a couple of climate points
-- bolted on, and averaging CO2 - which moves glacially and sits permanently
-- near its maximum - with the diesel crack spread produced a composite that
-- described neither. The two answer different questions on different
-- timescales, so they get different cards.
--
-- The two _harness buckets are is_visible = false: the test suite puts fixtures
-- there and every presentation view filters them out.
--
-- Generated from the live table so it cannot drift from what ships.

begin;

insert into failure_modes (slug, label, subtitle, plain_question, explainer, display_order, is_visible) values
  ('fiscal_monetary', 'Fiscal & Monetary', 'Credibility of the sovereign and the central bank', 'Can the government still borrow cheaply, and does anyone still believe the central bank?', 'Governments borrow constantly, and that works only while lenders trust they will be repaid in money that still holds its value. This group watches for that trust starting to wobble: borrowing costs climbing, expected inflation drifting upward, and interest payments eating a larger share of tax revenue.', 1, true),
  ('credit_plumbing', 'Credit & Plumbing', 'Where a slow story turns fast', 'Is money still flowing between banks, businesses and households?', 'Most of the economy runs on credit - overnight loans between banks, company borrowing, household credit cards. It normally works invisibly. When it jams, things break quickly, which is why this is where a slow decline turns into a sudden crisis. These measures track the price of risky borrowing, how much spare cash banks hold, and whether households are falling behind.', 2, true),
  ('physical_resource', 'Physical Resource', 'Fuel, food and water actually in storage', 'Are the physical basics - energy, food, water - still arriving reliably?', 'Everything else on this board assumes fuel reaches the pumps, food reaches the shelves and water reaches the taps. This group tracks how much of each is in storage right now and what it costs - the near-term supply picture, as distinct from the slower climate trends that shape it.', 3, true),
  ('climate_ecology', 'Climate & Ecology', 'The physical envelope everything else sits inside', 'Is the physical envelope everything else sits inside still stable?', 'These move on decades rather than weeks, and they will rarely be the reason something breaks tomorrow. They are here because they set the conditions everything else operates under: what the harvests do, where the water is, how often the infrastructure gets tested. Slow does not mean unimportant, and a measure sitting permanently near its own record is telling you something even when it is barely moving.', 4, true),
  ('supply_conflict', 'Supply & Conflict', 'Chokepoints, shipping, armed conflict', 'Are the world''s shipping chokepoints still open?', 'Roughly a third of global trade squeezes through a handful of narrow waterways. Close one - through war, drought, piracy or accident - and shortages spread worldwide within weeks. Rather than guessing at risk, these measures simply count the ships actually passing through each one every day.', 5, true),
  ('institutional', 'Institutional', 'Whether the machine still functions', 'Is the machinery of government still working predictably?', 'Businesses and households can cope with bad news. What they cannot cope with is not knowing the rules. When policy itself becomes unpredictable, hiring and investment get postponed even when nothing else is wrong.', 6, true),
  ('_harness_composite', 'Test harness (composites)', 'Fixtures only', 'Does the composite rule behave?', 'Used by the test suite. Never rendered.', 998, false),
  ('_harness', 'Test harness', 'Fixtures only', 'Does the normalization layer behave?', 'Used by the test suite. Never rendered.', 999, false)
on conflict (slug) do update set
  label = excluded.label,
  subtitle = excluded.subtitle,
  plain_question = excluded.plain_question,
  explainer = excluded.explainer,
  display_order = excluded.display_order,
  is_visible = excluded.is_visible;

commit;
