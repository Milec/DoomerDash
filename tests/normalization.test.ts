import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from '../scripts/env.ts';

/**
 * The normalization layer is SQL, so these tests run against the real database
 * rather than a reimplementation in TypeScript. Fixtures use the demo_ slug
 * prefix, which every production view filters out, so nothing here can reach
 * the dashboard.
 */

const env = loadEnv();
const configured = Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY);
const db: SupabaseClient = configured
  ? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : (null as unknown as SupabaseClient);

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Month-start dates, oldest first, ending `endBeforeDays` before today. */
function monthStarts(count: number, endBeforeDays = 0): string[] {
  const end = new Date(Date.now() - endBeforeDays * 86_400_000);
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    out.push(new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1)).toISOString().slice(0, 10));
  }
  return out;
}

/** Deterministic, low-variance series. No randomness: assertions must be stable. */
const wobble = (i: number) => 10 + Math.sin(i * 1.7) * 0.5 + (i % 3) * 0.1;

const sd = (xs: number[]) => {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1));
};

async function makeIndicator(slug: string, opts: Partial<Record<string, unknown>> = {}) {
  const { error } = await db.from('indicators').upsert({
    slug,
    name: slug,
    // Generic fixtures live here so they cannot skew the bucket the composite
    // test asserts on; that test passes failure_mode explicitly.
    failure_mode: 'institutional',
    source: 'test',
    source_series_id: null,
    unit: 'x',
    cadence: 'monthly',
    higher_is_worse: true,
    transform: 'level',
    is_counter: false,
    stale_after_days: 45,
    ...opts,
  });
  if (error) throw new Error(`${slug}: ${error.message}`);
}

async function putObs(slug: string, dates: string[], values: number[]) {
  const rows = dates.map((d, i) => ({ indicator_slug: slug, obs_date: d, value: values[i] }));
  const { error } = await db.from('observations').upsert(rows, { onConflict: 'indicator_slug,obs_date' });
  if (error) throw new Error(`${slug}: ${error.message}`);
}

interface ZRow {
  obs_date: string;
  value: number | null;
  z: number | null;
  window_n: number;
  window_sd: number | null;
  window_p01: number | null;
  window_p99: number | null;
}

async function zrows(slug: string): Promise<ZRow[]> {
  // Scoped through zscores(slug) rather than the indicator_zscores view: the
  // view's materialized CTE blocks predicate push-down, so filtering it by slug
  // would rescore every indicator in the database.
  const { data, error } = await db.rpc('zscores', { p_slug: slug });
  if (error) throw new Error(`${slug}: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>)
    .sort((a, b) => String(a.obs_date).localeCompare(String(b.obs_date)))
    .map((r) => ({
    obs_date: String(r.obs_date),
    value: num(r.value),
    z: num(r.z),
    window_n: Number(r.window_n),
    window_sd: num(r.window_sd),
    window_p01: num(r.window_p01),
    window_p99: num(r.window_p99),
  }));
}

async function cleanup() {
  await db.from('indicators').delete().like('slug', 'demo\\_%');
}

describe.skipIf(!configured)('normalization layer (SQL)', () => {
  beforeAll(async () => {
    await cleanup();
  }, 60_000);

  afterAll(async () => {
    await cleanup();
    await db.rpc('refresh_analytics');
  }, 60_000);

  it('flips the sign when higher_is_worse is false', async () => {
    const dates = monthStarts(36);
    const values = dates.map((_, i) => wobble(i));

    await makeIndicator('demo_flip_up', { higher_is_worse: true });
    await makeIndicator('demo_flip_down', { higher_is_worse: false });
    await putObs('demo_flip_up', dates, values);
    await putObs('demo_flip_down', dates, values);

    const up = await zrows('demo_flip_up');
    const down = await zrows('demo_flip_down');

    expect(up.length).toBe(dates.length);
    expect(down.length).toBe(up.length);

    const scored = up.filter((r) => r.z !== null);
    expect(scored.length).toBeGreaterThan(0);

    for (let i = 0; i < up.length; i++) {
      expect(down[i].obs_date).toBe(up[i].obs_date);
      // Identical inputs produce an identical distribution ...
      expect(down[i].window_sd).toBeCloseTo(up[i].window_sd ?? 0, 12);
      // ... and exactly opposite scores.
      if (up[i].z === null) {
        expect(down[i].z).toBeNull();
      } else {
        expect(down[i].z!).toBeCloseTo(-(up[i].z as number), 12);
      }
    }

    // Positive z must mean "worse" on both. The last value sits above the mean,
    // so the higher_is_worse=true series scores positive and its twin negative.
    const lastUp = up.at(-1)!;
    const lastDown = down.at(-1)!;
    expect(Math.sign(lastUp.z!)).toBe(-Math.sign(lastDown.z!));
  }, 60_000);

  it('winsorizes the window so one spike cannot flatten the scale', async () => {
    const dates = monthStarts(120);
    const clean = dates.map((_, i) => wobble(i));
    const spiked = [...clean];
    spiked[spiked.length - 1] = 1000;

    await makeIndicator('demo_wins_clean');
    await makeIndicator('demo_wins_spike');
    await putObs('demo_wins_clean', dates, clean);
    await putObs('demo_wins_spike', dates, spiked);

    const cleanRows = await zrows('demo_wins_clean');
    const spikeRows = await zrows('demo_wins_spike');
    const lastClean = cleanRows.at(-1)!;
    const lastSpike = spikeRows.at(-1)!;

    expect(lastSpike.window_n).toBe(120);
    expect(lastSpike.value).toBe(1000);

    // The 99th percentile sits in the normal range, so the spike is clamped out
    // of the mean/sd estimate entirely.
    expect(lastSpike.window_p99!).toBeLessThan(20);
    expect(lastSpike.window_p01!).toBeGreaterThan(5);

    // Without winsorization the spike would dominate sigma.
    const naiveSd = sd(spiked);
    expect(naiveSd).toBeGreaterThan(80);
    expect(lastSpike.window_sd!).toBeLessThan(naiveSd / 20);

    // And the resulting scale stays essentially the unspiked one.
    const drift = Math.abs(lastSpike.window_sd! - lastClean.window_sd!) / lastClean.window_sd!;
    expect(drift).toBeLessThan(0.3);

    // The observation being scored is NOT clamped: a genuine new extreme has to
    // be able to blow past the top of the historical range.
    expect(lastSpike.z!).toBeGreaterThan(10);
  }, 90_000);

  it('emits no z-score until the window holds the minimum observations', async () => {
    const { data: minObsData } = await db.from('normalization_policy').select('zscore_min_obs').single();
    const minObs = Number(minObsData?.zscore_min_obs ?? 24);
    expect(minObs).toBe(24);

    const shortDates = monthStarts(minObs - 1);
    const exactDates = monthStarts(minObs);

    await makeIndicator('demo_hist_short');
    await makeIndicator('demo_hist_exact');
    await putObs('demo_hist_short', shortDates, shortDates.map((_, i) => wobble(i)));
    await putObs('demo_hist_exact', exactDates, exactDates.map((_, i) => wobble(i)));

    const short = await zrows('demo_hist_short');
    const exact = await zrows('demo_hist_exact');

    expect(short.length).toBe(minObs - 1);
    expect(short.every((r) => r.z === null)).toBe(true);
    expect(short.at(-1)!.window_n).toBe(minObs - 1);

    // Only the row whose own trailing window reaches the threshold is scored.
    expect(exact.filter((r) => r.z !== null).length).toBe(1);
    const scored = exact.at(-1)!;
    expect(scored.window_n).toBe(minObs);
    expect(scored.z).not.toBeNull();
  }, 60_000);

  it('reports a composite as unavailable when fewer than half its members are fresh', async () => {
    const fresh = monthStarts(40);
    const stale = monthStarts(40, 240);
    const values = fresh.map((_, i) => wobble(i) + i * 0.02);

    for (const slug of ['demo_sc_a', 'demo_sc_b', 'demo_sc_c', 'demo_sc_d']) {
      await makeIndicator(slug, { failure_mode: 'supply_conflict', is_counter: false });
    }
    await putObs('demo_sc_a', fresh, values);
    await putObs('demo_sc_b', fresh, values);
    await putObs('demo_sc_c', stale, values);
    await putObs('demo_sc_d', stale, values);
    await db.rpc('refresh_analytics');

    const today = new Date().toISOString().slice(0, 10);
    const read = async () => {
      const { data, error } = await db.rpc('composite_at', { as_of: today, include_demo: true });
      if (error) throw new Error(error.message);
      const row = (data as Array<Record<string, unknown>>).find((r) => r.failure_mode === 'supply_conflict')!;
      const { data: status, error: sErr } = await db.rpc('composite_status', {
        member_count: row.member_count,
        fresh_count: row.fresh_count,
        composite_z: row.composite_z,
      });
      if (sErr) throw new Error(sErr.message);
      return {
        member_count: Number(row.member_count),
        fresh_count: Number(row.fresh_count),
        composite_z: num(row.composite_z),
        status: status as unknown as string,
      };
    };

    // Exactly half fresh is still enough to publish a composite.
    const half = await read();
    expect(half.member_count).toBe(4);
    expect(half.fresh_count).toBe(2);
    expect(half.status).toBe('ok');
    expect(half.composite_z).not.toBeNull();

    // The composite is the unweighted mean of the fresh members only.
    const [za, zb] = await Promise.all([zrows('demo_sc_a'), zrows('demo_sc_b')]);
    const expected = ((za.at(-1)!.z as number) + (zb.at(-1)!.z as number)) / 2;
    expect(half.composite_z!).toBeCloseTo(expected, 6);

    // Age out one of the two fresh members. It keeps enough history to be
    // scored, so this isolates staleness from insufficient history.
    const cutoff = new Date(Date.now() - 240 * 86_400_000).toISOString().slice(0, 10);
    const { error: delErr } = await db
      .from('observations')
      .delete()
      .eq('indicator_slug', 'demo_sc_b')
      .gt('obs_date', cutoff);
    if (delErr) throw new Error(delErr.message);
    await db.rpc('refresh_analytics');

    const belowHalf = await read();
    expect(belowHalf.member_count).toBe(4);
    expect(belowHalf.fresh_count).toBe(1);
    expect(belowHalf.status).toBe('insufficient_members');
    // Unavailable, not computed from the survivor.
    const { data: composites } = await db
      .from('failure_mode_composites')
      .select('failure_mode,status,composite_z')
      .eq('failure_mode', 'supply_conflict')
      .single();
    expect(composites?.composite_z).toBeNull();
  }, 120_000);

  it('never exposes demo fixtures through a production view', async () => {
    await makeIndicator('demo_leak_check');
    await putObs('demo_leak_check', monthStarts(30), monthStarts(30).map((_, i) => wobble(i)));
    await db.rpc('refresh_analytics');

    const { data: current } = await db.from('indicator_current').select('slug').like('slug', 'demo\\_%');
    expect(current ?? []).toHaveLength(0);

    const { data: spark } = await db.from('indicator_sparkline').select('indicator_slug').like('indicator_slug', 'demo\\_%');
    expect(spark ?? []).toHaveLength(0);

    const { data: production } = await db.rpc('composite_at', {
      as_of: new Date().toISOString().slice(0, 10),
      include_demo: false,
    });
    const sc = (production as Array<Record<string, unknown>>).find((r) => r.failure_mode === 'supply_conflict');
    expect(Number(sc?.member_count ?? 0)).toBe(0);
  }, 90_000);
});
