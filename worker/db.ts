import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from './env.d.ts';

const OPTS = { auth: { persistSession: false, autoRefreshToken: false } } as const;

/** Least-privilege client for serving the dashboard. Cannot write. */
export function readClient(env: Env): SupabaseClient {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be configured');
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, OPTS);
}

/** Service-role client. Ingest only; never reachable from an unauthenticated route. */
export function writeClient(env: Env): SupabaseClient {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    throw new Error(
      'SUPABASE_SERVICE_KEY is not configured. Ingest is disabled until it is set ' +
        '(`wrangler secret put SUPABASE_SERVICE_KEY`).',
    );
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, OPTS);
}
