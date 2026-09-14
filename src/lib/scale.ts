/**
 * Turning scores into sentences.
 *
 * The dashboard leads with a percentile, not a z-score, because "worse than 94%
 * of the past decade" needs no statistics background while "z = +1.6" needs a
 * semester of it. Both are shown; the readable one is bigger.
 *
 * By the time a value reaches here the sign has already been flipped in SQL, so
 * positive and "worse" always mean the same thing regardless of whether the
 * underlying measure is bad when it rises or bad when it falls.
 */
export type ZTone =
  | 'z-cool-3' | 'z-cool-2' | 'z-cool-1'
  | 'z-neutral'
  | 'z-warm-1' | 'z-warm-2' | 'z-warm-3';

const TOKENS: Record<ZTone, string> = {
  'z-cool-3': '#3987e5',
  'z-cool-2': '#2a78d6',
  'z-cool-1': '#256abf',
  'z-neutral': '#7d7b73',
  'z-warm-1': '#a83c3c',
  'z-warm-2': '#c74444',
  'z-warm-3': '#e34948',
};

export function zTone(z: number | null | undefined): ZTone {
  if (z === null || z === undefined || !Number.isFinite(z)) return 'z-neutral';
  if (z <= -2.5) return 'z-cool-3';
  if (z <= -1.5) return 'z-cool-2';
  if (z <= -0.5) return 'z-cool-1';
  if (z < 0.5) return 'z-neutral';
  if (z < 1.5) return 'z-warm-1';
  if (z < 2.5) return 'z-warm-2';
  return 'z-warm-3';
}

export const zColor = (z: number | null | undefined): string => TOKENS[zTone(z)];

/**
 * The headline sentence: where today sits in this measure's own history.
 * Stated as a percentile because that is the form a reader can act on without
 * being taught anything first.
 */
export function plainReading(pct: number | null, seasonal = false): string {
  if (pct === null || !Number.isFinite(pct)) return 'Not enough history to score';
  const against = seasonal ? 'at this time of year' : 'of the past decade';
  const r = Math.round(pct);
  if (r >= 50) return `Worse than ${r}% ${against}`;
  return `Better than ${100 - r}% ${against}`;
}

/** One-word severity, so colour is never the only signal. */
export function severityWord(z: number | null | undefined): string {
  if (z === null || z === undefined || !Number.isFinite(z)) return 'unscored';
  if (z >= 2.5) return 'extreme';
  if (z >= 1.5) return 'high';
  if (z >= 0.5) return 'elevated';
  if (z > -0.5) return 'normal';
  if (z > -1.5) return 'calm';
  return 'very calm';
}

/** Plain band for a composite, which is an average of scores and has no percentile. */
export function compositeWord(z: number | null): string {
  if (z === null || !Number.isFinite(z)) return 'unavailable';
  if (z >= 2) return 'Extreme stress';
  if (z >= 1) return 'Well above normal';
  if (z >= 0.5) return 'Above normal';
  if (z > -0.5) return 'Normal range';
  if (z > -1.5) return 'Calmer than usual';
  return 'Much calmer than usual';
}
