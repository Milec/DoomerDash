-- 0013: copy for the climate split, in the voice 0012 established.
--
-- 0012 was written before the environment was split out of physical_resource,
-- so it still describes that bucket as covering climate and says nothing about
-- the new one or its indicators. This brings both into line without touching
-- anything 0012 already got right.

begin;

update failure_modes set plain_question = v.question, explainer = v.explainer
from (values
  ('physical_resource',
   'Are energy, food, and water supplies holding up?',
   'Tracks prices, reserves, and inventories - the near-term supply picture, separate from the slower climate trends that shape it.'),
  ('climate_ecology',
   'Is the wider environment everything depends on still steady?',
   'Tracks greenhouse gases, global temperature, sea ice, ocean patterns, and drought. These move over decades rather than weeks, but they set the conditions the supply measures operate under.')
) as v(slug, question, explainer)
where failure_modes.slug = v.slug;

update indicators set explainer = v.explainer, notes = v.notes
from (values
  ('methane_ch4',
   'Methane in the atmosphere. Over twenty years it traps far more heat than carbon dioxide, but it also breaks down faster, so changes here show up in temperatures sooner.',
   'NOAA global monthly mean, published several months behind.'),
  ('nitrous_oxide_n2o',
   'Nitrous oxide, mostly from fertiliser use. There is far less of it than carbon dioxide, but each molecule traps much more heat and stays airborne for over a century.',
   'NOAA global monthly mean, published with a long lag.'),
  ('global_temp_anomaly',
   'How much warmer the planet''s surface is than the 1951-1980 average, combining land and ocean readings. This is the figure climate targets are written against.',
   'NASA GISTEMP land-ocean index.'),
  ('antarctic_sea_ice',
   'The area of ocean around Antarctica covered by sea ice. For decades this held steady while the Arctic shrank, so a sustained decline here is a newer signal.',
   'Compared with the same date in earlier years.'),
  ('enso_nino34',
   'How far Pacific ocean temperatures sit from normal, in either direction. El Nino and La Nina push weather opposite ways but both disrupt rainfall, harvests, and fisheries.',
   'The score uses the distance from normal, not the direction, because both extremes cause disruption.'),
  ('drought_severe',
   'The share of the continental US in severe drought or worse. It links the slower climate measures to the immediate ones: drought drains reservoirs, cuts harvests, and lowers rivers used for freight and power.',
   'US Drought Monitor category D2, which also counts the more severe D3 and D4.')
) as v(slug, explainer, notes)
where indicators.slug = v.slug;

commit;
