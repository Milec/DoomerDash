import type { Env } from './env.d.ts';
import { writeClient } from './db.ts';
import { apiKeyForSource, getConnector } from './connectors/registry.ts';
import type { IndicatorRow, Observation } from './connectors/types.ts';

/** Full-history start from the spec; the floor for every source. */
export const OBSERVATION_START = '2005-01-01';

/**
 * Routine runs only ask for recent history: sources revise the recent past, not
 * 2009, so a 180-day window catches every revision that matters while keeping
 * the payload small. Backfills pass full=true.
 *
 * This applies ONLY to daily and weekly series, which are the bulky ones. Two
 * things break under a short window and so always get full history:
 *
 *   - Low-cadence series. A quarterly or annual series may publish nothing at
 *     all in 180 days, and an empty fetch is indistinguishable from a broken
 *     source. They are tiny anyway - an annual series is ~20 rows.
 *   - Derived transforms. yoy_pct needs the observation from a year earlier, so
 *     a 180-day window can never produce a single value; ratio and derived need
 *     both inputs aligned over the same span.
 */
const INCREMENTAL_DAYS = 180;
const INCREMENTAL_CADENCES = new Set(['daily', 'weekly']);
const FULL_HISTORY_TRANSFORMS = new Set(['yoy_pct', 'ratio', 'derived']);

function observationStartFor(indicator: IndicatorRow, full: boolean): string {
  if (full) return OBSERVATION_START;
  if (!INCREMENTAL_CADENCES.has(indicator.cadence)) return OBSERVATION_START;
  if (FULL_HISTORY_TRANSFORMS.has(indicator.transform)) return OBSERVATION_START;
  return new Date(Date.now() - INCREMENTAL_DAYS * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Rows are accumulated across ALL of a source's indicators and upserted in a
 * few large batches rather than per indicator. Cloudflare caps subrequests per
 * invocation (50 on the free plan) and per-indicator upserts blew through it:
 * ingest came back 'partial' with half the series unscored.
 */
const UPSERT_CHUNK = 5000;

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
export async function ingestSource(source: string, env: Env, full = false): Promise<IngestResult> {
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

    const apiKey = apiKeyForSource(source, env);

    // Phase 1: fetch every series, collecting rows into one buffer. One
    // indicator failing is recorded and does not stop the others.
    const pending: Array<{ indicator_slug: string; obs_date: string; value: number }> = [];
    const fetched: string[] = [];
    const ingestedAt = new Date().toISOString();

    for (const indicator of (indicators ?? []) as IndicatorRow[]) {
      try {
        const observations = await connector.fetchSeries(indicator, {
          apiKey,
          observationStart: observationStartFor(indicator, full),
        });
        if (observations.length === 0) {
          // Not a silent no-op: a source that returns nothing is a fault to see.
          outcomes.push({ slug: indicator.slug, rows: 0, error: 'source returned no observations' });
          continue;
        }
        for (const o of observations as Observation[]) {
          pending.push({ indicator_slug: indicator.slug, obs_date: o.obs_date, value: o.value });
        }
        fetched.push(indicator.slug);
        outcomes.push({ slug: indicator.slug, rows: observations.length });
      } catch (err) {
        outcomes.push({ slug: indicator.slug, rows: 0, error: message(err) });
      }
    }

    // Postgres refuses an ON CONFLICT statement that touches the same row twice,
    // so a source returning a date more than once would fail the entire batch
    // rather than just itself. Collapse duplicates first, last value winning -
    // the same rule the upsert applies across runs.
    const deduped = [...new Map(
      pending.map((r) => [`${r.indicator_slug}\u0000${r.obs_date}`, r]),
    ).values()];

    // Phase 2: one upsert per batch, across all indicators.
    for (const batch of chunk(deduped, UPSERT_CHUNK)) {
      const { error } = await db
        .from('observations')
        .upsert(batch.map((r) => ({ ...r, ingested_at: ingestedAt })), {
          onConflict: 'indicator_slug,obs_date',
        });
      if (error) throw new Error(`upsert failed: ${error.message}`);
      totalRows += batch.length;
    }

    // Phase 3: rescore what changed, one indicator at a time. Each call is a
    // small statement; a whole-database rebuild does not fit in a request.
    for (const slug of fetched) {
      const { error } = await db.rpc('refresh_scores', { p_slug: slug });
      if (error) {
        const o = outcomes.find((x) => x.slug === slug);
        if (o) o.error = `stored but not scored: ${error.message}`;
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
