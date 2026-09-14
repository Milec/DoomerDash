import type { Connector, ConnectorContext, IndicatorRow, Observation } from './types.ts';
import { toDiff, toRatio, toYoYPercent } from './transforms.ts';

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';

/**
 * FRED publishes no per-key quota header, and the documented ceiling is ~120
 * requests/minute. 520ms between requests keeps a full run comfortably under it
 * without needing to react to a 429 in the common case.
 */
const MIN_REQUEST_GAP_MS = 520;
const MAX_ATTEMPTS = 4;
const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface FredObservation {
  date: string;
  value: string;
}

export function createFredConnector(): Connector {
  // Deduplicates series within a single run: GDPC1 backs both real_gdp_yoy and
  // the denominator of co2_per_gdp, and should be fetched once.
  const cache = new Map<string, Promise<Observation[]>>();
  let nextAllowedAt = 0;

  async function throttle(): Promise<void> {
    const wait = nextAllowedAt - Date.now();
    if (wait > 0) await sleep(wait);
    nextAllowedAt = Date.now() + MIN_REQUEST_GAP_MS;
  }

  async function fetchRaw(seriesId: string, ctx: ConnectorContext): Promise<Observation[]> {
    if (!ctx.apiKey) throw new Error('FRED_API_KEY is not configured');

    const url = new URL(FRED_BASE);
    url.searchParams.set('series_id', seriesId);
    url.searchParams.set('api_key', ctx.apiKey);
    url.searchParams.set('file_type', 'json');
    url.searchParams.set('observation_start', ctx.observationStart);

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      await throttle();
      try {
        const res = await fetch(url, { signal: ctx.signal });

        if (!res.ok) {
          if (RETRY_STATUSES.has(res.status) && attempt < MAX_ATTEMPTS) {
            const retryAfter = Number(res.headers.get('retry-after'));
            const backoff = Number.isFinite(retryAfter) && retryAfter > 0
              ? retryAfter * 1000
              : 2 ** (attempt - 1) * 750 + Math.random() * 250;
            await sleep(backoff);
            continue;
          }
          const body = await res.text().catch(() => '');
          throw new Error(`FRED ${seriesId}: HTTP ${res.status} ${body.slice(0, 200)}`);
        }

        const json = (await res.json()) as { observations?: FredObservation[] };
        if (!Array.isArray(json.observations)) {
          throw new Error(`FRED ${seriesId}: response had no observations array`);
        }

        const out: Observation[] = [];
        for (const o of json.observations) {
          // FRED encodes "no value published" as ".". It stays a gap.
          if (!o || typeof o.value !== 'string' || o.value === '.') continue;
          const value = Number(o.value);
          if (!Number.isFinite(value)) continue;
          if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date)) continue;
          out.push({ obs_date: o.date, value });
        }
        return out;
      } catch (err) {
        lastError = err;
        if (attempt >= MAX_ATTEMPTS) break;
        await sleep(2 ** (attempt - 1) * 750 + Math.random() * 250);
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`FRED ${seriesId}: failed after ${MAX_ATTEMPTS} attempts`);
  }

  function series(seriesId: string, ctx: ConnectorContext): Promise<Observation[]> {
    let hit = cache.get(seriesId);
    if (!hit) {
      hit = fetchRaw(seriesId, ctx);
      cache.set(seriesId, hit);
    }
    return hit;
  }

  return {
    source: 'fred',

    async fetchSeries(indicator: IndicatorRow, ctx: ConnectorContext): Promise<Observation[]> {
      const id = indicator.source_series_id?.trim();
      if (!id) throw new Error(`${indicator.slug}: source_series_id is required for FRED`);

      if (indicator.transform === 'ratio') {
        const [numId, denId] = id.split('/').map((s) => s.trim());
        if (!numId || !denId) {
          throw new Error(
            `${indicator.slug}: ratio indicators need source_series_id "NUMERATOR/DENOMINATOR", got "${id}"`,
          );
        }
        const [num, den] = await Promise.all([series(numId, ctx), series(denId, ctx)]);
        return toRatio(num, den);
      }

      const raw = await series(id, ctx);
      switch (indicator.transform) {
        case 'level':
          return raw;
        case 'yoy_pct':
          return toYoYPercent(raw);
        case 'diff':
          return toDiff(raw);
        default: {
          const never: never = indicator.transform;
          throw new Error(`${indicator.slug}: unsupported transform ${String(never)}`);
        }
      }
    },
  };
}
