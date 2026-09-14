import type { Connector, IndicatorRow, Observation } from './types.ts';
import { createHttp, num, parseCsv } from './http.ts';

/**
 * FAO Food Price Index (CSV, no key).
 *
 * One file carries every sub-index, so source_series_id names the column:
 * "Food Price Index", "Meat", "Dairy", "Cereals", "Oils", "Sugar". Dates are
 * YYYY-MM and are stored as the first of that month, which is how FAO dates a
 * monthly average.
 *
 * The file opens with title and units rows before the real header, so the
 * header row is located by content rather than by position - FAO has moved it
 * before.
 */

const CSV_URL =
  'https://www.fao.org/media/docs/worldfoodsituationlibraries/default-document-library/food_price_indices_data.csv';

export function createFaoConnector(): Connector {
  const http = createHttp({ minGapMs: 500 });

  return {
    source: 'fao',

    async fetchSeries(indicator: IndicatorRow): Promise<Observation[]> {
      const column = (indicator.source_series_id ?? 'Food Price Index').trim();
      const rows = parseCsv(await http.text(CSV_URL));

      const headerIdx = rows.findIndex(
        (r) => r[0]?.trim().toLowerCase() === 'date' && r.some((c) => c.trim().length > 0 && c.trim().toLowerCase() !== 'date'),
      );
      if (headerIdx === -1) throw new Error('FAO: could not locate the header row (expected a cell "Date")');

      const header = rows[headerIdx].map((c) => c.trim().toLowerCase());
      const col = header.indexOf(column.toLowerCase());
      if (col === -1) {
        throw new Error(
          `FAO: column "${column}" not found. Available: ${header.filter(Boolean).join(', ')}`,
        );
      }

      const out: Observation[] = [];
      for (const row of rows.slice(headerIdx + 1)) {
        const period = row[0]?.trim();
        if (!period || !/^\d{4}-\d{2}$/.test(period)) continue;
        const value = num(row[col]);
        if (value === null) continue;
        out.push({ obs_date: `${period}-01`, value });
      }
      return out;
    },
  };
}
