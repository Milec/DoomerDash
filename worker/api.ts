import type { Env } from './env.d.ts';
import { readClient } from './db.ts';
import type {
  DashboardPayload,
  FailureModeSlug,
  FailureModeView,
  IndicatorView,
  SparkPoint,
  SourceStatus,
} from '../shared/types.ts';

const asNum = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

interface CurrentRow {
  slug: string; name: string; explainer: string | null; seasonal: boolean;
  failure_mode: FailureModeSlug; source: string;
  source_series_id: string | null; unit: string | null; cadence: string;
  higher_is_worse: boolean; transform: string; is_counter: boolean;
  stale_after_days: number; notes: string | null; source_url: string | null;
  license: string | null; display_order: number; obs_date: string | null;
  value: unknown; z: unknown; pct_worse: unknown; window_n: number | null;
  age_days: number | null; is_stale: boolean | null;
}

interface CompositeRow {
  failure_mode: FailureModeSlug; label: string; subtitle: string; display_order: number;
  plain_question: string | null; explainer: string | null;
  member_count: number; fresh_count: number; status: string;
  composite_z: unknown; composite_z_30d_ago: unknown;
}

/**
 * Everything the page needs, in one round trip. The browser never learns the
 * Supabase URL, holds no key, and cannot reach an upstream API.
 */
export async function dashboardPayload(env: Env): Promise<DashboardPayload> {
  const db = readClient(env);

  const [composites, current, sparkRows, spans, sourceRows, policy, analytics] = await Promise.all([
    db.from('failure_mode_composites').select('*').order('display_order'),
    db.from('indicator_current').select('*').order('display_order'),
    db.from('indicator_sparkline').select('*').order('obs_date').limit(20000),
    db.from('indicator_spark_window').select('*'),
    db.from('ingest_status').select('*'),
    db.from('normalization_policy').select('*').single(),
    db.from('analytics_status').select('refreshed_at').maybeSingle(),
  ]);

  for (const [name, r] of Object.entries({ composites, current, sparkRows, spans, sourceRows, policy })) {
    if (r.error) throw new Error(`${name}: ${r.error.message}`);
  }

  const sparksBySlug = new Map<string, SparkPoint[]>();
  for (const row of (sparkRows.data ?? []) as Array<Record<string, unknown>>) {
    const slug = String(row.indicator_slug);
    const list = sparksBySlug.get(slug) ?? [];
    list.push({ d: String(row.obs_date), v: asNum(row.value) ?? 0, z: asNum(row.z) });
    sparksBySlug.set(slug, list);
  }

  const spanBySlug = new Map<string, number>(
    ((spans.data ?? []) as Array<{ slug: string; spark_days: number }>).map((s) => [s.slug, s.spark_days]),
  );

  const toView = (r: CurrentRow): IndicatorView => ({
    slug: r.slug,
    name: r.name,
    explainer: r.explainer,
    seasonal: Boolean(r.seasonal),
    failure_mode: r.failure_mode,
    source: r.source,
    source_series_id: r.source_series_id,
    unit: r.unit,
    cadence: r.cadence,
    transform: r.transform,
    higher_is_worse: r.higher_is_worse,
    is_counter: r.is_counter,
    notes: r.notes,
    source_url: r.source_url,
    license: r.license,
    stale_after_days: r.stale_after_days,
    obs_date: r.obs_date,
    value: asNum(r.value),
    z: asNum(r.z),
    pct_worse: asNum(r.pct_worse),
    window_n: r.window_n,
    age_days: r.age_days,
    // No observations at all reads as stale, never as fresh.
    is_stale: r.obs_date === null ? true : Boolean(r.is_stale),
    spark: sparksBySlug.get(r.slug) ?? [],
    spark_days: spanBySlug.get(r.slug) ?? 90,
  });

  const rows = ((current.data ?? []) as CurrentRow[]).map(toView);
  const byMode = new Map<string, IndicatorView[]>();
  const counters: IndicatorView[] = [];
  for (const row of rows) {
    if (row.is_counter) {
      counters.push(row);
      continue;
    }
    const list = byMode.get(row.failure_mode) ?? [];
    list.push(row);
    byMode.set(row.failure_mode, list);
  }

  const failure_modes: FailureModeView[] = ((composites.data ?? []) as CompositeRow[]).map((c) => ({
    slug: c.failure_mode,
    label: c.label,
    subtitle: c.subtitle,
    plain_question: c.plain_question,
    explainer: c.explainer,
    status: (c.status === 'ok' || c.status === 'insufficient_members' ? c.status : 'no_members'),
    composite_z: asNum(c.composite_z),
    composite_z_30d_ago: asNum(c.composite_z_30d_ago),
    member_count: c.member_count,
    fresh_member_count: c.fresh_count,
    members: byMode.get(c.failure_mode) ?? [],
  }));

  const sources: SourceStatus[] = ((sourceRows.data ?? []) as SourceStatus[]).map((s) => ({
    source: s.source,
    last_success_at: s.last_success_at,
    last_run_at: s.last_run_at,
    last_status: s.last_status,
    last_rows_upserted: s.last_rows_upserted,
    last_error_text: s.last_error_text,
  }));

  const p = (policy.data ?? {}) as Record<string, number>;
  return {
    generated_at: new Date().toISOString(),
    analytics_refreshed_at: (analytics.data?.refreshed_at as string | undefined) ?? null,
    composite_window_days: p.composite_window_days ?? 90,
    zscore_window_years: p.zscore_window_years ?? 10,
    zscore_min_obs: p.zscore_min_obs ?? 24,
    seasonal_window_days: p.seasonal_window_days ?? 15,
    failure_modes,
    counter_indicators: counters,
    sources,
  };
}
