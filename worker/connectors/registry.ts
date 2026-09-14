import type { Connector } from './types.ts';
import type { Env } from '../env.d.ts';
import { createFredConnector } from './fred.ts';

/**
 * Sources that have a working connector. Each entry is a factory so that every
 * ingest run gets a fresh instance with its own request cache and throttle state.
 *
 * Phase 2 plugs in here and nowhere else. Each of these is a new module exporting
 * a Connector, plus one line in this table:
 *
 *   eia        EIA API v2 (key)      SPR level, diesel retail, distillate + crude
 *                                    stocks. The diesel crack spread is derived
 *                                    from products and crude, not fetched.
 *   portwatch  IMF PortWatch (open)  daily transit counts: Hormuz, Suez,
 *                                    Bab el-Mandeb, Panama.
 *   nyfed      ACM term premium      CSV download.
 *   noaa       NOAA / NSIDC          Mauna Loa CO2, global SST, Arctic sea ice.
 *   fao        FAO Food Price Index  CSV; USDA WASDE stocks-to-use.
 *   usbr       Reclamation HDB       Lake Mead and Lake Powell storage.
 *   acled      ACLED (registration)  check redistribution terms before shipping.
 *
 * `cadence = 'manual'` indicators intentionally have no connector: they arrive
 * through an authenticated CSV import route.
 */
const FACTORIES: Record<string, () => Connector> = {
  fred: createFredConnector,
};

export const CONNECTOR_SOURCES = Object.keys(FACTORIES);

export function getConnector(source: string): Connector {
  const factory = FACTORIES[source];
  if (!factory) {
    throw new Error(
      `No connector for source "${source}". Known sources: ${CONNECTOR_SOURCES.join(', ') || '(none)'}`,
    );
  }
  return factory();
}

/** Per-source credential lookup, so the orchestrator never guesses secret names. */
export function apiKeyForSource(source: string, env: Env): string | undefined {
  switch (source) {
    case 'fred':
      return env.FRED_API_KEY;
    default:
      return undefined;
  }
}
