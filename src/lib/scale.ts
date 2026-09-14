/**
 * Diverging scale for z-scores. Positive is always "worse" by the time a value
 * reaches here - the sign flip happens in SQL - so the ramp runs cool for
 * "better than its own history" through a neutral midpoint to warm for "worse".
 *
 * Three steps per arm, breaks at |z| of 0.5, 1.5 and 2.5. Every step clears 3:1
 * on the page surface and the steps are monotonic in lightness outward from the
 * midpoint, so magnitude reads even where hue does not.
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

/** Hex for the tone, for SVG strokes and inline styles Tailwind cannot reach. */
export const zColor = (z: number | null | undefined): string => TOKENS[zTone(z)];

/** Plain-language reading, so the color never carries meaning on its own. */
export function zLabel(z: number | null | undefined): string {
  if (z === null || z === undefined || !Number.isFinite(z)) return 'not scored';
  const a = Math.abs(z);
  const dir = z > 0 ? 'worse' : 'better';
  if (a < 0.5) return 'in line with its 10y range';
  if (a < 1.5) return `${dir} than usual`;
  if (a < 2.5) return `well ${dir} than usual`;
  return `extreme vs its 10y range (${dir})`;
}
