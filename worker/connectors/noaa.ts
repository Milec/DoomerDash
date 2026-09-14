import type { Connector, ConnectorContext, IndicatorRow, Observation } from './types.ts';
import { createHttp, isoDate, num, parseCsv } from './http.ts';

/**
 * NOAA GML and NSIDC climate series (no key).
 *
 * One connector, several file formats, dispatched on source_series_id:
 *
 *   mlo_co2_monthly      Mauna Loa monthly mean CO2 (NOAA GML)
 *   nsidc_arctic_extent  Arctic sea ice extent, daily (NSIDC G02135 v4.0)
 *
 * Daily global sea surface temperature is deliberately absent. The usual free
 * feed (Climate Reanalyzer's oisst2.1 JSON) stopped updating in September 2024
 * - its other filenames now redirect to the site root - and shipping a series
 * two years behind as if it were a daily indicator is exactly the failure this
 * dashboard is built to avoid. Wiring SST needs a live replacement first.
 */

const CO2_URL = 'https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_mlo.csv';
const ICE_URL =
  'https://noaadata.apps.nsidc.org/NOAA/G02135/north/daily/data/N_seaice_extent_daily_v4.0.csv';

/** NOAA and NSIDC both encode "no measurement" as a large negative sentinel. */
const isSentinel = (v: number) => v <= -99;

export function createNoaaConnector(): Connector {
  const http = createHttp({ minGapMs: 400 });

  async function co2Monthly(): Promise<Observation[]> {
    const text = await http.text(CO2_URL);
    // The file is prefixed with a long '#' licence header of varying length.
    const body = text.split('\n').filter((l) => !l.startsWith('#')).join('\n');
    const rows = parseCsv(body);
    if (rows.length === 0) throw new Error('NOAA CO2: empty file');

    const header = rows[0].map((c) => c.trim().toLowerCase());
    const yi = header.indexOf('year');
    const mi = header.indexOf('month');
    const vi = header.indexOf('average');
    if (yi === -1 || mi === -1 || vi === -1) {
      throw new Error(`NOAA CO2: expected year/month/average columns, got: ${header.join(',')}`);
    }

    const out: Observation[] = [];
    for (const row of rows.slice(1)) {
      const y = num(row[yi]);
      const m = num(row[mi]);
      const v = num(row[vi]);
      if (y === null || m === null || v === null || isSentinel(v)) continue;
      const d = isoDate(y, m, 1);
      if (d) out.push({ obs_date: d, value: v });
    }
    return out;
  }

  async function arcticExtent(): Promise<Observation[]> {
    const rows = parseCsv(await http.text(ICE_URL));
    if (rows.length < 3) throw new Error('NSIDC sea ice: file too short');

    // Row 0 is the header, row 1 is a units row ("YYYY, MM, DD, 10^6 sq km...").
    const header = rows[0].map((c) => c.trim().toLowerCase());
    const yi = header.indexOf('year');
    const mi = header.indexOf('month');
    const di = header.indexOf('day');
    const vi = header.indexOf('extent');
    if ([yi, mi, di, vi].some((i) => i === -1)) {
      throw new Error(`NSIDC sea ice: expected Year/Month/Day/Extent, got: ${header.join(',')}`);
    }

    const out: Observation[] = [];
    for (const row of rows.slice(1)) {
      const y = num(row[yi]);
      const m = num(row[mi]);
      const dd = num(row[di]);
      const v = num(row[vi]);
      if (y === null || m === null || dd === null || v === null || isSentinel(v)) continue;
      const d = isoDate(y, m, dd);
      if (d) out.push({ obs_date: d, value: v });
    }
    return out;
  }

  const HANDLERS: Record<string, () => Promise<Observation[]>> = {
    mlo_co2_monthly: co2Monthly,
    nsidc_arctic_extent: arcticExtent,
  };

  return {
    source: 'noaa',

    async fetchSeries(indicator: IndicatorRow, ctx: ConnectorContext): Promise<Observation[]> {
      const key = indicator.source_series_id?.trim() ?? '';
      const handler = HANDLERS[key];
      if (!handler) {
        throw new Error(
          `${indicator.slug}: unknown NOAA series "${key}". Known: ${Object.keys(HANDLERS).join(', ')}`,
        );
      }
      const all = await handler();
      return all.filter((o) => o.obs_date >= ctx.observationStart);
    },
  };
}
