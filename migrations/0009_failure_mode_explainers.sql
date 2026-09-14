-- 0009: plain-language content for the five failure modes.
--
-- Written for someone with no finance, energy or climate background: the one
-- question each group answers, and why it belongs on a board about systemic
-- risk. Generated from the live table so it cannot drift from what ships.

begin;

update failure_modes set plain_question = v.q, explainer = v.e from (values
  ('fiscal_monetary',
   'Can the government still borrow cheaply, and does anyone still believe the central bank?',
   'Governments borrow constantly, and that works only while lenders trust they will be repaid in money that still holds its value. This group watches for that trust starting to wobble: borrowing costs climbing, expected inflation drifting upward, and interest payments eating a larger share of tax revenue.'),
  ('credit_plumbing',
   'Is money still flowing between banks, businesses and households?',
   'Most of the economy runs on credit - overnight loans between banks, company borrowing, household credit cards. It normally works invisibly. When it jams, things break quickly, which is why this is where a slow decline turns into a sudden crisis. These measures track the price of risky borrowing, how much spare cash banks hold, and whether households are falling behind.'),
  ('physical_resource',
   'Are the physical basics - energy, food, water - still arriving reliably?',
   'Everything else on this board assumes fuel reaches the pumps, food reaches the shelves and water reaches the taps. This group tracks how much of each is in storage, what it costs, and the slower climate trends that shape those over decades.'),
  ('supply_conflict',
   'Are the world''s shipping chokepoints still open?',
   'Roughly a third of global trade squeezes through a handful of narrow waterways. Close one - through war, drought, piracy or accident - and shortages spread worldwide within weeks. Rather than guessing at risk, these measures simply count the ships actually passing through each one every day.'),
  ('institutional',
   'Is the machinery of government still working predictably?',
   'Businesses and households can cope with bad news. What they cannot cope with is not knowing the rules. When policy itself becomes unpredictable, hiring and investment get postponed even when nothing else is wrong.')
) as v(slug, q, e) where failure_modes.slug = v.slug;

commit;
