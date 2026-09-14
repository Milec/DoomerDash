/**
 * Rescore every indicator, one at a time.
 *
 * Ingest already rescores what it touches, so this is for after a schema change
 * to the normalization layer, or to repair a partial run. Per-indicator because
 * a whole-database rebuild does not fit inside a request budget.
 *
 *   npm run rescore
 */
import { createClient } from '@supabase/supabase-js';
import { requireEnv } from './env.ts';

const env = requireEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_KEY']);
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data, error } = await db.from('indicators').select('slug').order('slug');
if (error) throw new Error(error.message);

let failed = 0;
for (const { slug } of (data ?? []) as Array<{ slug: string }>) {
  const t0 = Date.now();
  const { data: rows, error: e } = await db.rpc('refresh_scores', { p_slug: slug });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (e) {
    failed++;
    console.log(`  FAIL ${slug.padEnd(28)} ${secs}s  ${e.message}`);
  } else {
    console.log(`   ok  ${slug.padEnd(28)} ${secs}s  ${rows} scored rows`);
  }
}
console.log(failed ? `\n${failed} indicator(s) failed to score` : '\nall indicators scored');
process.exit(failed ? 1 : 0);
