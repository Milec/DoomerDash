/**
 * Backfill history for a source.
 *
 * There is no separate backfill path: ingestion always requests full history
 * from OBSERVATION_START and upserts on (indicator_slug, obs_date), so running
 * it is the backfill. Add an indicator row, run this, done.
 *
 *   npm run backfill -- fred
 */
import { requireEnv } from './env.ts';
import { ingestSource } from '../worker/ingest.ts';
import { CONNECTOR_SOURCES } from '../worker/connectors/registry.ts';
import type { Env } from '../worker/env.d.ts';

const source = process.argv[2] ?? 'fred';
if (!CONNECTOR_SOURCES.includes(source)) {
  console.error(`Unknown source "${source}". Known: ${CONNECTOR_SOURCES.join(', ')}`);
  process.exit(1);
}

const env = requireEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'FRED_API_KEY']) as unknown as Env;

console.log(`Backfilling ${source} ...`);
// Backfills request full history; routine ingest only fetches a recent window.
const result = await ingestSource(source, env, true);

for (const o of result.indicators) {
  console.log(`  ${o.error ? 'FAIL' : ' ok '}  ${o.slug.padEnd(28)} ${String(o.rows).padStart(6)} rows` + (o.error ? `  ${o.error}` : ''));
}
console.log(`\n${source}: ${result.status}, ${result.rows_upserted} rows upserted (run #${result.run_id})`);
if (result.error_text) console.log(`errors: ${result.error_text}`);
process.exit(result.status === 'error' ? 1 : 0);
