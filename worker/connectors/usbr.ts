import type { Connector, ConnectorContext, IndicatorRow, Observation } from './types.ts';
import { createHttp, num, parseCsv } from './http.ts';

/**
 * US Bureau of Reclamation, Upper Colorado hydrodata (no key).
 *
 * source_series_id is "<siteId>/<datatypeId>", e.g. "921/17" for Lake Mead
 * storage. The endpoint returns a plain two-column CSV: datetime,value.
 *
 * RISE (data.usbr.gov) is the newer API but its search endpoint sits behind a
 * WAF that rejects query strings, so this uses the stable hydrodata CSV files.
 */

const BASE = 'https://www.usbr.gov/uc/water/hydrodata/reservoir_data';

export function createUsbrConnector(): Connector {
  const http = createHttp({ minGapMs: 400 });

  return {
    source: 'usbr',

    async fetchSeries(indicator: IndicatorRow, ctx: ConnectorContext): Promise<Observation[]> {
      const id = indicator.source_series_id?.trim();
      const m = id ? /^(\d+)\/(\d+)$/.exec(id) : null;
      if (!m) {
        throw new Error(`${indicator.slug}: source_series_id must be "<siteId>/<datatypeId>", got "${id}"`);
      }

      const csv = await http.text(`${BASE}/${m[1]}/csv/${m[2]}.csv`);
      const rows = parseCsv(csv);
      const out: Observation[] = [];

      for (const row of rows.slice(1)) {
        if (row.length < 2) continue;
        const obs_date = row[0]?.trim().slice(0, 10);
        const value = num(row[1]);
        if (!obs_date || !/^\d{4}-\d{2}-\d{2}$/.test(obs_date) || value === null) continue;
        // The endpoint only serves the entire record, so the window is applied
        // here rather than re-upserting decades of unchanged rows every run.
        if (obs_date < ctx.observationStart) continue;
        out.push({ obs_date, value });
      }
      return out;
    },
  };
}
