import type { Observation } from './types.ts';

/**
 * Pure derivations applied to raw upstream series before they are stored.
 *
 * Every function here drops points it cannot derive honestly. None of them
 * interpolate, forward-fill, or invent a date. If the inputs do not support a
 * value, no row is produced.
 */

const byDate = (obs: Observation[]) => new Map(obs.map((o) => [o.obs_date, o.value]));
const sorted = (obs: Observation[]) => [...obs].sort((a, b) => a.obs_date.localeCompare(b.obs_date));

/** Same calendar date one year earlier, as an ISO string. Feb 29 has no match. */
function oneYearEarlier(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${String(Number(y) - 1).padStart(4, '0')}-${m}-${d}`;
}

const dayMs = 86_400_000;
const toMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Year-over-year percent change against the observation exactly one year back.
 * Points with no exact-dated counterpart are dropped, not approximated.
 */
export function toYoYPercent(obs: Observation[]): Observation[] {
  const lookup = byDate(obs);
  const out: Observation[] = [];
  for (const o of sorted(obs)) {
    const prior = lookup.get(oneYearEarlier(o.obs_date));
    if (prior === undefined || prior === 0) continue;
    out.push({ obs_date: o.obs_date, value: ((o.value - prior) / Math.abs(prior)) * 100 });
  }
  return out;
}

/** Period-over-period first difference. The first observation has no predecessor. */
export function toDiff(obs: Observation[]): Observation[] {
  const s = sorted(obs);
  const out: Observation[] = [];
  for (let i = 1; i < s.length; i++) {
    out.push({ obs_date: s[i].obs_date, value: s[i].value - s[i - 1].value });
  }
  return out;
}

/**
 * Numerator / denominator, aligned on the numerator's dates.
 *
 * An exact date match wins. Otherwise the denominator is aggregated to the
 * numerator's frequency by averaging the denominator observations that fall
 * inside the numerator's period - that is how annual CO2 is divided by
 * quarterly real GDP. Averaging observations that exist is aggregation;
 * it is not the same thing as inventing observations that do not.
 */
export function toRatio(numerator: Observation[], denominator: Observation[]): Observation[] {
  const num = sorted(numerator);
  const den = sorted(denominator);
  if (num.length === 0 || den.length === 0) return [];

  const exact = byDate(den);
  const out: Observation[] = [];

  for (let i = 0; i < num.length; i++) {
    const n = num[i];
    const direct = exact.get(n.obs_date);
    if (direct !== undefined) {
      if (direct !== 0) out.push({ obs_date: n.obs_date, value: n.value / direct });
      continue;
    }

    // Period end: the next numerator date, or one period past the last one.
    let endMs: number;
    if (i + 1 < num.length) {
      endMs = toMs(num[i + 1].obs_date);
    } else if (num.length > 1) {
      endMs = toMs(n.obs_date) + (toMs(n.obs_date) - toMs(num[i - 1].obs_date));
    } else {
      continue; // single point, no exact match, no inferable period
    }

    const startMs = toMs(n.obs_date);
    const inPeriod = den.filter((d) => {
      const ms = toMs(d.obs_date);
      return ms >= startMs && ms < endMs;
    });
    if (inPeriod.length === 0) continue;

    const mean = inPeriod.reduce((a, d) => a + d.value, 0) / inPeriod.length;
    if (mean === 0) continue;
    out.push({ obs_date: n.obs_date, value: n.value / mean });
  }
  return out;
}

export const _internal = { oneYearEarlier, toIso, dayMs };
