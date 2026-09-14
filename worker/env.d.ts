// Minimal Workers runtime surface. Hand-rolled rather than pulling in
// @cloudflare/workers-types, which is not part of the agreed dependency set.

export interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export interface ScheduledController {
  scheduledTime: number;
  cron: string;
}

export interface Env {
  ASSETS: Fetcher;
  /** This Worker, bound to itself, so the cron can fan out one invocation per source. */
  SELF?: Fetcher;
  SUPABASE_URL: string;
  /** Publishable/anon key. Read path only; granted SELECT on the public views. */
  SUPABASE_PUBLISHABLE_KEY: string;
  /** Service role key. Write path only; never used to serve a browser request. */
  SUPABASE_SERVICE_KEY: string;
  FRED_API_KEY: string;
  /** EIA API v2 key: https://www.eia.gov/opendata/register.php */
  EIA_API_KEY: string;
  INGEST_TOKEN: string;
}

/**
 * Workers exposes a default cache that the DOM CacheStorage type does not
 * describe. Narrow it at the use site rather than redeclaring the global.
 */
export type WorkersCacheStorage = CacheStorage & { default: Cache };
