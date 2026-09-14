import type { Connector } from './types.ts';
import type { Env } from '../env.d.ts';
import { createFredConnector } from './fred.ts';
import { createEiaConnector } from './eia.ts';
import { createPortwatchConnector } from './portwatch.ts';
import { createNoaaConnector } from './noaa.ts';
import { createFaoConnector } from './fao.ts';
import { createUsbrConnector } from './usbr.ts';
import { createNasaConnector } from './nasa.ts';
import { createUsdmConnector } from './usdm.ts';

/**
 * Sources that have a working connector. Each entry is a factory so that every
 * ingest run gets a fresh instance with its own request cache and throttle state.
 *
 * Adding an indicator to a source listed here is a database insert and nothing
 * else. Adding a new source is a module exporting a Connector plus one line
 * below.
 *
 * Deliberately absent:
 *
 *   acled   Registration required, and its licence does not permit
 *           redistributing the data from a public URL. Left out of the public
 *           build rather than shipped in breach of terms.
 *   sst     Daily global sea surface temperature. Climate Reanalyzer's oisst2.1
 *           JSON stopped updating in September 2024 and CPC's weekly SST file
 *           stops in January 2021. Needs a live replacement; the ENSO indicator
 *           covers part of the same ground in the meantime.
 *   usda    WASDE grain stocks-to-use. The PSD API needs its own key and the
 *           only keyless path is a 2.8MB zip, which would mean adding a
 *           decompression dependency. Suited to the manual CSV route instead.
 *
 * `cadence = 'manual'` indicators intentionally have no connector: they arrive
 * through an authenticated CSV import route.
 */
const FACTORIES: Record<string, () => Connector> = {
  fred: createFredConnector,
  eia: createEiaConnector,
  portwatch: createPortwatchConnector,
  noaa: createNoaaConnector,
  fao: createFaoConnector,
  usbr: createUsbrConnector,
  nasa: createNasaConnector,
  usdm: createUsdmConnector,
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
    case 'eia':
      return env.EIA_API_KEY;
    default:
      // portwatch, noaa, fao and usbr are all open data with no key.
      return undefined;
  }
}
