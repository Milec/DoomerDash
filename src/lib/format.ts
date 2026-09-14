/**
 * Dates arrive as the source published them - date-only, no time. They are
 * rendered as the literal ISO string and never parsed into a local Date, which
 * is how a quarterly observation ends up displayed a day early for half the
 * planet.
 */
export const formatDate = (iso: string | null): string => iso ?? '--';

export function formatValue(value: number | null, unit: string | null): string {
  if (value === null || !Number.isFinite(value)) return '--';
  const a = Math.abs(value);
  const digits = a >= 10_000 ? 0 : a >= 100 ? 1 : a >= 1 ? 2 : 3;
  const n = value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return unit ? `${n} ${unit}` : n;
}

export const formatZ = (z: number | null): string =>
  z === null || !Number.isFinite(z) ? '--' : (z > 0 ? '+' : '') + z.toFixed(2);

export function formatAge(days: number | null): string {
  if (days === null) return 'no data';
  if (days <= 0) return 'today';
  if (days === 1) return '1 day old';
  if (days < 90) return `${days} days old`;
  const months = Math.round(days / 30.44);
  if (months < 24) return `${months} months old`;
  return `${(days / 365.25).toFixed(1)} years old`;
}

export function formatSpan(days: number): string {
  if (days <= 120) return `${days}d`;
  if (days < 730) return `${Math.round(days / 30.44)}m`;
  return `${Math.round(days / 365.25)}y`;
}

export function formatTimestamp(iso: string | null): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  // Timestamps (unlike observation dates) are real instants, so UTC is stated.
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}
