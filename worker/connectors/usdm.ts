import type { Connector, ConnectorContext, IndicatorRow, Observation } from './types.ts';
import { createHttp, num, parseCsv } from './http.ts';

/**
 * US Drought Monitor (droughtmonitor.unl.edu), no key.
 *
 * source_series_id is the drought category to report: D0 (abnormally dry)
 * through D4 (exceptional). Categories are CUMULATIVE - D2 means "D2 or worse"
 * - so D2 is the usual headline for "how much of the country is in severe
 * drought or worse".
 *
 * The API needs an explicit date range, which is taken from the ingest window,
 * so a routine run asks for a few months rather than two decades.
 *
 * It also returns TWO rows per week - "CONUS" (the 48 contiguous states) and
 * "Total" (which adds Alaska, Hawaii and Puerto Rico). Only CONUS is kept:
 * taking both produced two rows for the same date and broke the upsert.
 */

const BASE = 'https://usdmdataservices.unl.edu/api/USStatistics/GetDroughtSeverityStatisticsByAreaPercent';

/** The API wants M/D/YYYY, not ISO. */
function usDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}/${y}`;
}

export function createUsdmConnector(): Connector {
  const http = createHttp({ minGapMs: 500 });

  return {
    source: 'usdm',

    async fetchSeries(indicator: IndicatorRow, ctx: ConnectorContext): Promise<Observation[]> {
      const category = (indicator.source_series_id ?? 'D2').trim().toUpperCase();
      if (!/^D[0-4]$/.test(category)) {
        throw new Error(`${indicator.slug}: source_series_id must be D0-D4, got "${category}"`);
      }

      const end = new Date().toISOString().slice(0, 10);
      const url =
        `${BASE}?aoi=us&startdate=${encodeURIComponent(usDate(ctx.observationStart))}` +
        `&enddate=${encodeURIComponent(usDate(end))}&statisticsType=1`;

      const rows = parseCsv(await http.text(url));
      if (rows.length < 2) throw new Error('USDM: no rows returned');

      const header = rows[0].map((c) => c.trim());
      const di = header.indexOf('MapDate');
      const ci = header.indexOf(category);
      const ai = header.indexOf('AreaOfInterest');
      if (di === -1 || ci === -1 || ai === -1) {
        throw new Error(
          `USDM: expected MapDate, AreaOfInterest and ${category} columns, got: ${header.join(',')}`,
        );
      }

      const out: Observation[] = [];
      for (const row of rows.slice(1)) {
        if (row[ai]?.trim().toUpperCase() !== 'CONUS') continue;
        const raw = row[di]?.trim();
        const value = num(row[ci]);
        if (!raw || !/^\d{8}$/.test(raw) || value === null) continue;
        out.push({
          obs_date: `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`,
          value,
        });
      }
      return out;
    },
  };
}
