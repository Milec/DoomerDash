import type { Connector, ConnectorContext, IndicatorRow, Observation } from './types.ts';
import { createHttp, num } from './http.ts';

/**
 * EIA API v2 (free key).
 *
 * source_series_id is "<route>:<seriesId>", because v2 series live under
 * different routes and the route is not derivable from the id:
 *
 *   petroleum/stoc/wstk:WCSSTUS1   SPR crude stocks, weekly
 *   petroleum/pri/gnd:EMD_EPD2D_PTE_NUS_DPG   retail diesel, weekly
 *   petroleum/pri/spt:RWTC         WTI spot, daily
 *
 * The diesel crack spread is NOT a series anyone publishes - it is computed
 * here from the ULSD and crude spot prices, which is why it uses the
 * "derived:" prefix instead of a route.
 */

const BASE = 'https://api.eia.gov/v2';
const PAGE = 5000;
const MAX_PAGES = 20;

/** US refined-product spot prices are $/gallon; crude is $/barrel. */
const GALLONS_PER_BARREL = 42;

const ULSD_SPOT = 'petroleum/pri/spt:EER_EPD2DXL0_PF4_RGC_DPG';
const WTI_SPOT = 'petroleum/pri/spt:RWTC';

interface EiaResponse {
  response?: { data?: Array<{ period?: string; value?: string | number | null }>; total?: number };
  error?: unknown;
}

/** EIA frequency names match our cadence names for the ones we use. */
function frequencyFor(cadence: string): string {
  if (cadence === 'daily' || cadence === 'weekly' || cadence === 'monthly') return cadence;
  throw new Error(`EIA: unsupported cadence "${cadence}"`);
}

export function createEiaConnector(): Connector {
  const http = createHttp({ minGapMs: 350 });
  const cache = new Map<string, Promise<Observation[]>>();

  async function fetchSeries(spec: string, frequency: string, ctx: ConnectorContext): Promise<Observation[]> {
    if (!ctx.apiKey) throw new Error('EIA_API_KEY is not configured');
    const [route, seriesId] = spec.split(':');
    if (!route || !seriesId) throw new Error(`EIA: source_series_id must be "route:SERIES_ID", got "${spec}"`);

    const out: Observation[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const url =
        `${BASE}/${route}/data/?api_key=${encodeURIComponent(ctx.apiKey)}` +
        `&frequency=${frequency}&data[0]=value` +
        `&facets[series][]=${encodeURIComponent(seriesId)}` +
        `&start=${ctx.observationStart}` +
        `&sort[0][column]=period&sort[0][direction]=asc` +
        `&offset=${page * PAGE}&length=${PAGE}`;

      const body = await http.json<EiaResponse>(url);
      if (body.error) throw new Error(`EIA ${seriesId}: ${JSON.stringify(body.error).slice(0, 180)}`);

      const rows = body.response?.data ?? [];
      for (const r of rows) {
        const period = r.period?.trim();
        const value = num(r.value ?? null);
        if (!period || value === null) continue;
        // Weekly and daily periods are already YYYY-MM-DD; monthly is YYYY-MM.
        const obs_date = /^\d{4}-\d{2}-\d{2}$/.test(period)
          ? period
          : /^\d{4}-\d{2}$/.test(period)
            ? `${period}-01`
            : null;
        if (!obs_date) continue;
        out.push({ obs_date, value });
      }
      if (rows.length < PAGE) break;
    }
    return out;
  }

  function cached(spec: string, frequency: string, ctx: ConnectorContext): Promise<Observation[]> {
    const key = `${spec}@${frequency}`;
    let hit = cache.get(key);
    if (!hit) {
      hit = fetchSeries(spec, frequency, ctx);
      cache.set(key, hit);
    }
    return hit;
  }

  /**
   * Diesel crack spread, $/barrel: the refining margin between a barrel of
   * crude and the diesel made from it. Widening means refined fuel is getting
   * expensive relative to crude, which is a supply-side squeeze rather than a
   * general oil price move - that is why it is worth computing rather than
   * just tracking the diesel price.
   */
  async function dieselCrack(ctx: ConnectorContext): Promise<Observation[]> {
    const [ulsd, wti] = await Promise.all([
      cached(ULSD_SPOT, 'daily', ctx),
      cached(WTI_SPOT, 'daily', ctx),
    ]);
    const crude = new Map(wti.map((o) => [o.obs_date, o.value]));
    const out: Observation[] = [];
    for (const d of ulsd) {
      const c = crude.get(d.obs_date);
      // Only dates where both prices genuinely exist. No carry-forward.
      if (c === undefined) continue;
      out.push({ obs_date: d.obs_date, value: d.value * GALLONS_PER_BARREL - c });
    }
    if (out.length === 0) throw new Error('EIA diesel crack: no overlapping ULSD and WTI dates');
    return out;
  }

  const DERIVED: Record<string, (ctx: ConnectorContext) => Promise<Observation[]>> = {
    diesel_crack: dieselCrack,
  };

  return {
    source: 'eia',

    async fetchSeries(indicator: IndicatorRow, ctx: ConnectorContext): Promise<Observation[]> {
      const spec = indicator.source_series_id?.trim();
      if (!spec) throw new Error(`${indicator.slug}: source_series_id is required for EIA`);

      if (spec.startsWith('derived:')) {
        const name = spec.slice('derived:'.length);
        const fn = DERIVED[name];
        if (!fn) {
          throw new Error(`${indicator.slug}: unknown derived EIA series "${name}". Known: ${Object.keys(DERIVED).join(', ')}`);
        }
        return fn(ctx);
      }
      return cached(spec, frequencyFor(indicator.cadence), ctx);
    },
  };
}
