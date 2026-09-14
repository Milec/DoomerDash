import type { Env } from './env.d.ts';
import { writeClient } from './db.ts';
import { apiKeyForSource, getConnector } from './connectors/registry.ts';
import type { IndicatorRow, Observation } from './connectors/types.ts';

/** FRED history start from the spec; also the floor for every other source. */
export const OBSERVATION_START = '2005-01-01';

const UPSERT_CHUNK = 1000;

export interface IndicatorOutcome {
  slug: string;
  rows: number;
  error?: string;
}

export interface IngestResult {
  source: string;
  status: 'success' | 'partial' | 'error';
  rows_upserted: number;
  indicators: IndicatorOutcome[];
  error_text: string | null;
  run_id: number | null;
  started_at: string;
  finished_at: string;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Fetch one source end to end and upsert it.
 *
 * Idempotent on (indicator_slug, obs_date): sources revise history and the later
 * value wins. One indicator failing does not abort the others; it downgrades the
 * run to 'partial' and is recorded in ingest_runs.error_text.
 */
export async function ingestSource(source: string, env: Env): Promise<IngestResult> {
  const db = writeClient(env);
  const startedAt = new Date().toISOString();

  const { data: runRow, error: runError } = await db
    .from('ingest_runs')
    .insert({ source, started_at: startedAt, status: 'running' })
    .select('id')
    .single();
  if (runError) throw new Error(`could not open ingest run: ${runError.message}`);
  const runId: number = runRow.id;

  const outcomes: IndicatorOutcome[] = [];
  let totalRows = 0;
  let fatal: string | null = null;

  try {
    const connector = getConnector(source);
    const { data: indicators, error: indError } = await db
      .from('indicators')
      .select('slug,name,source,source_series_id,transform,cadence,unit')
      .eq('source', source)
      .not('slug', 'like', 'demo\\_%')
      .order('slug');
    if (indError) throw new Error(`could not load indicators: ${indError.message}`);

    const ctx = { apiKey: apiKeyForSource(source, env), observationStart: OBSERVATION_START };

    for (const indicator of (indicators ?? []) as IndicatorRow[]) {
      try {
        const observations = await connector.fetchSeries(indicator, ctx);
        if (observations.length === 0) {
          // Not a silent no-op: a source that returns nothing is a fault to see.
          outcomes.push({ slug: indicator.slug, rows: 0, error: 'source returned no observations' });
          continue;
        }

        let written = 0;
        for (const batch of chunk(observations, UPSERT_CHUNK)) {
          const rows = batch.map((o: Observation) => ({
            indicator_slug: indicator.slug,
            obs_date: o.obs_date,
            value: o.value,
            ingested_at: new Date().toISOString(),
          }));
          const { error } = await db
            .from('observations')
            .upsert(rows, { onConflict: 'indicator_slug,obs_date' });
          if (error) throw new Error(error.message);
          written += rows.length;
        }
        totalRows += written;
        outcomes.push({ slug: indicator.slug, rows: written });
      } catch (err) {
        outcomes.push({ slug: indicator.slug, rows: 0, error: message(err) });
      }
    }
  } catch (err) {
    fatal = message(err);
  }

  const failures = outcomes.filter((o) => o.error);
  const status: IngestResult['status'] = fatal
    ? 'error'
    : failures.length === 0 && outcomes.length > 0
      ? 'success'
      : failures.length === outcomes.length
        ? 'error'
        : 'partial';

  const errorText =
    fatal ??
    (failures.length ? failures.map((f) => `${f.slug}: ${f.error}`).join('; ').slice(0, 4000) : null);

  const finishedAt = new Date().toISOString();
  await db
    .from('ingest_runs')
    .update({ finished_at: finishedAt, status, rows_upserted: totalRows, error_text: errorText })
    .eq('id', runId);

  // Rebuild the z-score snapshot even on a partial run: the rows that did land
  // should be scored. Failure here is recorded but does not change run status.
  if (status !== 'error') {
    const { error } = await db.rpc('refresh_analytics');
    if (error) console.error(`refresh_analytics failed after ${source}: ${error.message}`);
  }

  return {
    source,
    status,
    rows_upserted: totalRows,
    indicators: outcomes,
    error_text: errorText,
    run_id: runId,
    started_at: startedAt,
    finished_at: finishedAt,
  };
}
