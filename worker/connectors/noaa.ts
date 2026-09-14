import type { Connector, ConnectorContext, IndicatorRow, Observation } from './types.ts';
import { createHttp, isoDate, num, parseCsv } from './http.ts';

/**
 * NOAA climate series (no key). One connector, several file formats, dispatched
 * on source_series_id:
 *
 *   mlo_co2_monthly           Mauna Loa monthly mean CO2 (GML)
 *   gml_ch4_monthly           Global mean methane (GML)
 *   gml_n2o_monthly           Global mean nitrous oxide (GML)
 *   nsidc_arctic_extent       Arctic sea ice extent, daily (NSIDC G02135 v4.0)
 *   nsidc_antarctic_extent    Antarctic sea ice extent, daily (same dataset)
 *   psl_nino34_abs            |Nino 3.4 anomaly|, monthly (PSL) - see below
 *
 * Daily global sea surface temperature is still absent. The usual free feed
 * (Climate Reanalyzer's oisst2.1 JSON) stopped updating in September 2024 and
 * CPC's weekly SST file stops in January 2021. Shipping a series years behind as
 * if it were current is exactly the failure this dashboard exists to avoid, so
 * SST needs a live replacement first. ENSO covers part of the same ground.
 */

const CO2_URL = 'https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_mlo.csv';
const CH4_URL = 'https://gml.noaa.gov/webdata/ccgg/trends/ch4/ch4_mm_gl.csv';
const N2O_URL = 'https://gml.noaa.gov/webdata/ccgg/trends/n2o/n2o_mm_gl.csv';
const ICE_NORTH_URL =
  'https://noaadata.apps.nsidc.org/NOAA/G02135/north/daily/data/N_seaice_extent_daily_v4.0.csv';
const ICE_SOUTH_URL =
  'https://noaadata.apps.nsidc.org/NOAA/G02135/south/daily/data/S_seaice_extent_daily_v4.0.csv';
const NINO34_URL = 'https://psl.noaa.gov/data/correlation/nina34.anom.data';

/** NOAA and NSIDC both encode "no measurement" as a large negative sentinel. */
const isSentinel = (v: number) => v <= -99;

export function createNoaaConnector(): Connector {
  const http = createHttp({ minGapMs: 400 });

  /** NOAA GML trend files share one shape: a '#' header, then year,month,...,average. */
  async function gmlMonthly(url: string): Promise<Observation[]> {
    const text = await http.text(url);
    // The file is prefixed with a long '#' licence header of varying length.
    const body = text.split('\n').filter((l) => !l.startsWith('#')).join('\n');
    const rows = parseCsv(body);
    if (rows.length === 0) throw new Error(`NOAA GML: empty file at ${url}`);

    const header = rows[0].map((c) => c.trim().toLowerCase());
    const yi = header.indexOf('year');
    const mi = header.indexOf('month');
    const vi = header.indexOf('average');
    if (yi === -1 || mi === -1 || vi === -1) {
      throw new Error(`NOAA GML: expected year/month/average columns, got: ${header.join(',')}`);
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

  async function seaIceExtent(url: string): Promise<Observation[]> {
    const rows = parseCsv(await http.text(url));
    if (rows.length < 3) throw new Error(`NSIDC sea ice: file too short at ${url}`);

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

  /**
   * |Nino 3.4 anomaly|, monthly.
   *
   * The ABSOLUTE value is deliberate. El Nino and La Nina are opposite signs but
   * both disrupt rainfall, harvests and fisheries; scoring the raw anomaly would
   * report a severe La Nina as the safest possible reading. What carries risk is
   * distance from neutral, in either direction.
   *
   * Format: a year-range header line, then one line per year with twelve monthly
   * values, then footer prose. -99.99 marks a month not yet published.
   */
  async function nino34Abs(): Promise<Observation[]> {
    const text = await http.text(NINO34_URL);
    const out: Observation[] = [];
    for (const line of text.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length !== 13) continue;            // skip header and footer lines
      const year = num(parts[0]);
      if (year === null || !Number.isInteger(year) || year < 1800 || year > 2999) continue;
      for (let m = 1; m <= 12; m++) {
        const v = num(parts[m]);
        if (v === null || v <= -99) continue;
        const d = isoDate(year, m, 1);
        if (d) out.push({ obs_date: d, value: Math.abs(v) });
      }
    }
    if (out.length === 0) throw new Error('NOAA PSL Nino3.4: no rows parsed');
    return out;
  }

  const HANDLERS: Record<string, () => Promise<Observation[]>> = {
    mlo_co2_monthly: () => gmlMonthly(CO2_URL),
    gml_ch4_monthly: () => gmlMonthly(CH4_URL),
    gml_n2o_monthly: () => gmlMonthly(N2O_URL),
    nsidc_arctic_extent: () => seaIceExtent(ICE_NORTH_URL),
    nsidc_antarctic_extent: () => seaIceExtent(ICE_SOUTH_URL),
    psl_nino34_abs: nino34Abs,
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
