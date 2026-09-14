import type { Connector, ConnectorContext, IndicatorRow, Observation } from './types.ts';
import { createHttp, isoDate, num, parseCsv } from './http.ts';

/**
 * NASA GISS surface temperature analysis (GISTEMP v4), no key.
 *
 * source_series_id:
 *   gistemp_global_loti   Global land-ocean temperature anomaly, monthly (degC
 *                         relative to the 1951-1980 mean)
 *
 * The file is a WIDE table - one row per year, one column per month, plus
 * seasonal and annual summary columns - so it is pivoted back to one row per
 * month here. Months not yet published are '***' and are dropped, not zeroed.
 */

const GISTEMP_URL = 'https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export function createNasaConnector(): Connector {
  const http = createHttp({ minGapMs: 400 });

  async function gistempGlobal(): Promise<Observation[]> {
    const rows = parseCsv(await http.text(GISTEMP_URL));

    // A title line precedes the header, and NASA has moved it before, so the
    // header is located by content rather than by position.
    const headerIdx = rows.findIndex((r) => r[0]?.trim().toLowerCase() === 'year');
    if (headerIdx === -1) throw new Error('GISTEMP: could not find the header row (expected a cell "Year")');

    const header = rows[headerIdx].map((c) => c.trim().toLowerCase());
    const monthCols = MONTHS.map((m) => header.indexOf(m));
    if (monthCols.some((i) => i === -1)) {
      throw new Error(`GISTEMP: expected twelve month columns, got: ${header.join(',')}`);
    }

    const out: Observation[] = [];
    for (const row of rows.slice(headerIdx + 1)) {
      const year = num(row[0]);
      if (year === null || !Number.isInteger(year)) continue;
      for (let m = 0; m < 12; m++) {
        const value = num(row[monthCols[m]]); // '***' parses to null and is skipped
        if (value === null) continue;
        const d = isoDate(year, m + 1, 1);
        if (d) out.push({ obs_date: d, value });
      }
    }
    if (out.length === 0) throw new Error('GISTEMP: no rows parsed');
    return out;
  }

  const HANDLERS: Record<string, () => Promise<Observation[]>> = {
    gistemp_global_loti: gistempGlobal,
  };

  return {
    source: 'nasa',
    async fetchSeries(indicator: IndicatorRow, ctx: ConnectorContext): Promise<Observation[]> {
      const key = indicator.source_series_id?.trim() ?? '';
      const handler = HANDLERS[key];
      if (!handler) {
        throw new Error(`${indicator.slug}: unknown NASA series "${key}". Known: ${Object.keys(HANDLERS).join(', ')}`);
      }
      return (await handler()).filter((o) => o.obs_date >= ctx.observationStart);
    },
  };
}
