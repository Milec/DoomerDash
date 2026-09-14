import type { Connector, ConnectorContext, IndicatorRow, Observation } from './types.ts';
import { createHttp, num } from './http.ts';

/**
 * IMF PortWatch daily chokepoint transit counts (ArcGIS REST, no key).
 *
 * source_series_id is the chokepoint's `portname` exactly as PortWatch spells
 * it, e.g. "Strait of Hormuz". The stored value is `n_total`, the number of
 * vessels transiting that day.
 *
 * The layer caps responses at 1000 features and reports exceededTransferLimit,
 * so every series is paged to completion. A truncated fetch would look like a
 * collapse in traffic, which is the exact signal this indicator exists to
 * detect - so pages are followed until the layer says there are no more.
 */

const LAYER =
  'https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query';
const PAGE_SIZE = 1000;
const MAX_PAGES = 40; // ~40k rows; far beyond any single chokepoint's history

interface ArcGisResponse {
  features?: Array<{ attributes: Record<string, unknown> }>;
  exceededTransferLimit?: boolean;
  error?: { message?: string };
}

export function createPortwatchConnector(): Connector {
  const http = createHttp({ minGapMs: 300 });

  return {
    source: 'portwatch',

    async fetchSeries(indicator: IndicatorRow, ctx: ConnectorContext): Promise<Observation[]> {
      const portname = indicator.source_series_id?.trim();
      if (!portname) {
        throw new Error(`${indicator.slug}: source_series_id must be the PortWatch chokepoint name`);
      }

      const out: Observation[] = [];
      let offset = 0;

      for (let page = 0; page < MAX_PAGES; page++) {
        const url =
          `${LAYER}?where=${encodeURIComponent(`portname='${portname.replace(/'/g, "''")}'`)}` +
          `&outFields=${encodeURIComponent('date,n_total')}` +
          `&orderByFields=${encodeURIComponent('date ASC')}` +
          `&returnGeometry=false&resultOffset=${offset}&resultRecordCount=${PAGE_SIZE}&f=json`;

        const body = await http.json<ArcGisResponse>(url);
        if (body.error) throw new Error(`PortWatch ${portname}: ${body.error.message ?? 'query failed'}`);

        const features = body.features ?? [];
        for (const f of features) {
          const a = f.attributes ?? {};
          // The layer types `date` as esriFieldTypeDateOnly, so it arrives as an
          // ISO string. Guard anyway rather than trusting the schema.
          const raw = a.date;
          const obs_date = typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw)
            ? raw.slice(0, 10)
            : typeof raw === 'number'
              ? new Date(raw).toISOString().slice(0, 10)
              : null;
          const value = num(a.n_total as string | number | null);
          if (!obs_date || value === null) continue;
          if (obs_date < ctx.observationStart) continue;
          out.push({ obs_date, value });
        }

        if (features.length === 0 || !body.exceededTransferLimit) break;
        offset += features.length;
      }

      if (out.length === 0) {
        throw new Error(`PortWatch ${portname}: no rows returned - is the chokepoint name spelled as PortWatch spells it?`);
      }
      return out;
    },
  };
}
