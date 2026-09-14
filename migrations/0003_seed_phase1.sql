-- 0003: Phase 1 indicator seed. FRED only.
--
-- Adding an indicator to a source that already has a connector is an insert
-- here and nothing else. `transform` tells the connector how to derive the
-- analytic value; `source_series_id` is "NUMERATOR/DENOMINATOR" for ratios.
--
-- stale_after_days is cadence plus the publisher's real release lag, not a
-- guess: daily rate series lapse over a long weekend, quarterly national
-- accounts land about a month after the quarter closes, and annual series
-- routinely run more than a year behind. Several of these will render stale on
-- day one. That is the intended reading, not a defect.

begin;

insert into indicators (
  slug, name, failure_mode, source, source_series_id, unit, cadence,
  higher_is_worse, transform, is_counter, stale_after_days, notes, source_url,
  license, display_order
) values

-- fiscal_monetary ------------------------------------------------------------
('t5yifr', '5y5y Forward Inflation Expectation', 'fiscal_monetary', 'fred', 'T5YIFR', '%', 'daily',
 true, 'level', false, 5,
 'Market-implied inflation five years out, five years forward. The cleanest read on whether the central bank is still believed.',
 'https://fred.stlouisfed.org/series/T5YIFR', 'U.S. Government public domain via FRED.', 10),

('t10y_yield', '10-Year Treasury Yield', 'fiscal_monetary', 'fred', 'DGS10', '%', 'daily',
 true, 'level', false, 5,
 'Nominal cost of ten-year sovereign borrowing.',
 'https://fred.stlouisfed.org/series/DGS10', 'U.S. Government public domain via FRED.', 20),

('t10y2y', '10y-2y Term Spread', 'fiscal_monetary', 'fred', 'T10Y2Y', 'pp', 'daily',
 false, 'level', false, 5,
 'Inversion (a low or negative spread) is the stress signal, so the sign is flipped: positive z means flatter or inverted.',
 'https://fred.stlouisfed.org/series/T10Y2Y', 'U.S. Government public domain via FRED.', 30),

('sticky_cpi', 'Sticky-Price Core CPI', 'fiscal_monetary', 'fred', 'CORESTICKM159SFRBATL', '% YoY', 'monthly',
 true, 'level', false, 45,
 'Atlanta Fed. Prices that reprice slowly, so a move here is harder to reverse than a headline print.',
 'https://fred.stlouisfed.org/series/CORESTICKM159SFRBATL', 'Federal Reserve Bank of Atlanta; public domain via FRED.', 40),

('trimmed_pce', 'Trimmed Mean PCE Inflation', 'fiscal_monetary', 'fred', 'PCETRIM12M159SFRBDAL', '% YoY', 'monthly',
 true, 'level', false, 45,
 'Dallas Fed. Trims the tails rather than dropping fixed categories.',
 'https://fred.stlouisfed.org/series/PCETRIM12M159SFRBDAL', 'Federal Reserve Bank of Dallas; public domain via FRED.', 50),

('net_interest_receipts', 'Federal Interest / Tax Receipts', 'fiscal_monetary', 'fred',
 'A091RC1Q027SBEA/W006RC1Q027SBEA', 'ratio', 'quarterly',
 true, 'ratio', false, 140,
 'Federal interest payments divided by federal current tax receipts. Derived from two BEA series; the denominator is tax receipts specifically, not total receipts.',
 'https://fred.stlouisfed.org/series/A091RC1Q027SBEA', 'U.S. Bureau of Economic Analysis; public domain via FRED.', 60),

-- credit_plumbing ------------------------------------------------------------
('hy_oas', 'High Yield OAS', 'credit_plumbing', 'fred', 'BAMLH0A0HYM2', 'pp', 'daily',
 true, 'level', false, 5,
 'ICE BofA US High Yield option-adjusted spread. The fastest-moving credit stress gauge on the board.',
 'https://fred.stlouisfed.org/series/BAMLH0A0HYM2',
 'ICE Data Indices, LLC - used with permission via FRED; check the series page before redistributing.', 10),

('ig_oas', 'Investment Grade OAS', 'credit_plumbing', 'fred', 'BAMLC0A0CM', 'pp', 'daily',
 true, 'level', false, 5,
 'ICE BofA US Corporate option-adjusted spread. Widening here means stress has reached balance sheets that are supposed to be safe.',
 'https://fred.stlouisfed.org/series/BAMLC0A0CM',
 'ICE Data Indices, LLC - used with permission via FRED; check the series page before redistributing.', 20),

('bank_reserves', 'Bank Reserve Balances', 'credit_plumbing', 'fred', 'WRESBAL', '$M', 'weekly',
 false, 'level', false, 12,
 'Reserves held at the Fed. Draining reserves is where funding markets seize, so the sign is flipped: positive z means scarcer.',
 'https://fred.stlouisfed.org/series/WRESBAL', 'Board of Governors of the Federal Reserve System; public domain via FRED.', 30),

('cc_delinq', 'Credit Card Delinquency Rate', 'credit_plumbing', 'fred', 'DRCCLACBS', '%', 'quarterly',
 true, 'level', false, 140,
 'All commercial banks. Household stress showing up on bank books.',
 'https://fred.stlouisfed.org/series/DRCCLACBS', 'Board of Governors of the Federal Reserve System; public domain via FRED.', 40),

('unemployment', 'Unemployment Rate', 'credit_plumbing', 'fred', 'UNRATE', '%', 'monthly',
 true, 'level', false, 45,
 'U-3. Lagging, but the level everything else is indexed against.',
 'https://fred.stlouisfed.org/series/UNRATE', 'U.S. Bureau of Labor Statistics; public domain via FRED.', 50),

('real_gdp_yoy', 'Real GDP Growth', 'credit_plumbing', 'fred', 'GDPC1', '% YoY', 'quarterly',
 false, 'yoy_pct', false, 140,
 'Year-over-year change in real GDP, derived from the level series. Sign flipped: positive z means slower growth.',
 'https://fred.stlouisfed.org/series/GDPC1', 'U.S. Bureau of Economic Analysis; public domain via FRED.', 60),

-- counter-indicators ---------------------------------------------------------
('co2_per_gdp', 'CO2 per Unit of Real GDP', 'physical_resource', 'fred',
 'EMISSCO2TOTVTTTOUSA/GDPC1', 'Mt CO2 / $B 2017', 'annual',
 true, 'ratio', true, 550,
 'Total US CO2 emissions divided by annualized real GDP. The EIA emissions series is discontinued upstream (last observation 2021), so this will always render heavily stale until a replacement feed is wired up.',
 'https://fred.stlouisfed.org/series/EMISSCO2TOTVTTTOUSA', 'U.S. Energy Information Administration; public domain via FRED.', 10),

('real_median_income', 'Real Median Household Income', 'institutional', 'fred', 'MEHOINUSA672N', '2024 $', 'annual',
 false, 'level', true, 550,
 'Census, inflation-adjusted. Annual with a long release lag, so it is stale by construction.',
 'https://fred.stlouisfed.org/series/MEHOINUSA672N', 'U.S. Census Bureau; public domain via FRED.', 20),

('labor_participation_prime', 'Prime-Age Labor Participation', 'institutional', 'fred', 'LNS11300060', '%', 'monthly',
 false, 'level', true, 45,
 'Ages 25-54, which strips out demographics and schooling decisions.',
 'https://fred.stlouisfed.org/series/LNS11300060', 'U.S. Bureau of Labor Statistics; public domain via FRED.', 30)

on conflict (slug) do update set
  name = excluded.name,
  failure_mode = excluded.failure_mode,
  source = excluded.source,
  source_series_id = excluded.source_series_id,
  unit = excluded.unit,
  cadence = excluded.cadence,
  higher_is_worse = excluded.higher_is_worse,
  transform = excluded.transform,
  is_counter = excluded.is_counter,
  stale_after_days = excluded.stale_after_days,
  notes = excluded.notes,
  source_url = excluded.source_url,
  license = excluded.license,
  display_order = excluded.display_order;

commit;
