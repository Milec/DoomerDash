-- Replace the launch copy with shorter, plain-language descriptions.

begin;

update failure_modes set plain_question = v.question, explainer = v.explainer
from (values
  ('fiscal_monetary', 'Are borrowing costs and inflation expectations under control?', 'Tracks the cost of government borrowing, expected inflation, and the share of tax revenue used to pay interest.'),
  ('credit_plumbing', 'Is credit still reaching banks, businesses, and households?', 'Tracks lending stress, bank liquidity, and signs that households are struggling to keep up with payments.'),
  ('physical_resource', 'Are energy, food, water, and climate conditions holding up?', 'Tracks prices, reserves, inventories, and longer-term environmental pressures that affect daily life.'),
  ('supply_conflict', 'Are major shipping routes moving normally?', 'Counts ships through critical waterways. A sustained drop can point to conflict, drought, or a disruption in trade.'),
  ('institutional', 'Can people and businesses plan around stable rules?', 'Tracks policy uncertainty and household economic outcomes.')
) as v(slug, question, explainer)
where failure_modes.slug = v.slug;

update indicators set explainer = v.explainer, notes = v.notes
from (values
  ('hy_oas', 'The extra interest rate risky companies pay compared with the US government. A rise means investors see more risk in lower-rated corporate debt.', 'A fast-moving measure of stress in high-yield credit.'),
  ('ig_oas', 'The extra interest rate paid by financially stronger companies. A rise suggests credit stress is spreading beyond the riskiest borrowers.', 'Tracks investment-grade corporate debt.'),
  ('bank_reserves', 'Cash commercial banks hold at the Federal Reserve. Lower reserves leave less room for banks to settle payments and meet sudden demand.', 'Lower is treated as worse in the score.'),
  ('cc_delinq', 'The share of credit-card balances with overdue payments. It shows household stress reaching bank balance sheets.', 'All commercial banks.'),
  ('unemployment', 'The share of people looking for work who cannot find it. It usually rises after a downturn has started.', 'The standard U-3 unemployment rate.'),
  ('real_gdp_yoy', 'Inflation-adjusted economic growth compared with a year earlier. Slower growth or contraction increases stress.', 'Derived from the real GDP level series; lower growth is worse.'),
  ('t5yifr', 'What markets expect inflation to average five to ten years from now. A rise can signal weaker confidence in long-run price stability.', 'Market-implied inflation expectation.'),
  ('t10y_yield', 'The interest rate paid on ten-year US government debt. It influences mortgages, corporate borrowing, and many other rates.', 'Nominal ten-year Treasury yield.'),
  ('t10y2y', 'The gap between ten-year and two-year Treasury yields. A very small or negative gap has often preceded recessions.', 'A lower or inverted spread is treated as worse.'),
  ('sticky_cpi', 'Inflation in categories that usually change prices slowly, such as rent and insurance. It helps show whether inflation is becoming entrenched.', 'Atlanta Fed measure.'),
  ('trimmed_pce', 'Inflation after removing the largest price moves in either direction. It is designed to show the underlying trend.', 'Dallas Fed measure.'),
  ('net_interest_receipts', 'Federal interest payments as a share of federal tax receipts. A higher share leaves less budget room for other priorities.', 'Interest payments divided by current tax receipts.'),
  ('term_premium', 'The extra return investors demand to hold long-term bonds instead of rolling over short-term bonds. A rise means more uncertainty is priced in.', 'New York Fed ACM model.'),
  ('policy_uncertainty', 'How often major newspapers discuss uncertainty around economic policy. High readings can make businesses delay hiring and investment.', 'A text-based proxy, not a direct measure.'),
  ('equity_uncertainty', 'A newspaper-based measure of uncertainty that is relevant to stock markets. It is best read alongside the broader policy measure.', 'Closely related to the policy uncertainty series.'),
  ('real_median_income', 'Inflation-adjusted income for the household in the middle of the distribution. It is less affected by very high incomes than an average.', 'Annual series with a long release lag.'),
  ('labor_participation_prime', 'The share of 25-to-54-year-olds who are working or looking for work. It focuses on people in their core working years.', 'Higher participation is treated as better.'),
  ('diesel_crack', 'The margin from turning crude oil into diesel. A wider margin can point to a shortage of refining capacity.', 'Calculated from diesel and crude prices.'),
  ('co2_per_gdp', 'Carbon dioxide emitted for each unit of economic output. A decline means the economy is becoming less carbon-intensive.', 'The upstream emissions series ends in 2021, so this reading is old.'),
  ('diesel_retail', 'Average US diesel price at the pump. Higher diesel costs raise the price of freight, farming, and construction.', null),
  ('spr_level', 'Oil held in the US emergency reserve. Lower levels mean less protection against a sudden supply shock.', 'Lower is treated as worse in the score.'),
  ('crude_stocks', 'Commercial crude-oil inventory, separate from the emergency reserve. It is a buffer between production and refining.', 'Compared with the same season in prior years.'),
  ('distillate_stocks', 'US inventories of diesel and heating oil. Low stocks leave less room to absorb cold weather or refinery outages.', 'Compared with the same season in prior years.'),
  ('mauna_loa_co2', 'Atmospheric carbon dioxide measured at Mauna Loa since 1958. It is one of the clearest long-term records of global change.', 'This series trends upward over time, so high readings are expected.'),
  ('arctic_sea_ice', 'The area of the Arctic Ocean covered by sea ice. Less ice than usual for the date indicates greater stress.', 'Compared with the same date in earlier years.'),
  ('lake_mead_storage', 'Water stored in Lake Mead, a key source for the US Southwest. Lower storage reduces the region''s water and power buffer.', 'Compared with the same season in prior years.'),
  ('lake_powell_storage', 'Water stored in Lake Powell, upstream of Lake Mead. Watching both reservoirs helps show pressure across the Colorado River system.', 'Compared with the same season in prior years.'),
  ('food_price_index', 'A monthly index of internationally traded food commodities. Sharp increases can put pressure on countries that import much of their food.', null),
  ('chokepoint_hormuz', 'Ships passing through the Strait of Hormuz each day. Lower traffic can disrupt a major route for global oil shipments.', null),
  ('chokepoint_suez', 'Ships passing through the Suez Canal each day. A drop can force cargo around Africa, adding time and cost.', null),
  ('chokepoint_bab_el_mandeb', 'Ships passing through the southern entrance to the Red Sea. Lower traffic can signal disruption on the Suez route.', 'Long disruptions gradually become part of the trailing baseline.'),
  ('chokepoint_panama', 'Ships passing through the Panama Canal each day. Drought can limit crossings because the canal relies on freshwater.', null)
) as v(slug, explainer, notes)
where indicators.slug = v.slug;

commit;
