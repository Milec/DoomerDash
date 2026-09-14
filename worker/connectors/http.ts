/**
 * Shared fetch plumbing for every connector: polite throttling, bounded retry
 * with exponential backoff, and a CSV parser.
 *
 * Connectors differ in their data shapes, not in how they should behave on the
 * wire. Keeping this in one place means a fix to backoff or rate limiting
 * applies to every source at once.
 */

export interface HttpOptions {
  /** Minimum milliseconds between requests from this client. */
  minGapMs?: number;
  maxAttempts?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

// Several public data hosts (Climate Reanalyzer among them) reject requests
// with no User-Agent. Identify the bot rather than impersonating a browser.
const USER_AGENT = 'DoomerDash/1.0 (systemic risk dashboard; +https://doomerdash.mikie-mcconaghy3.workers.dev)';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Http {
  text(url: string): Promise<string>;
  json<T>(url: string): Promise<T>;
}

export function createHttp(opts: HttpOptions = {}): Http {
  const minGap = opts.minGapMs ?? 250;
  const maxAttempts = opts.maxAttempts ?? 4;
  let nextAllowedAt = 0;

  async function request(url: string): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const wait = nextAllowedAt - Date.now();
      if (wait > 0) await sleep(wait);
      nextAllowedAt = Date.now() + minGap;

      try {
        const res = await fetch(url, {
          signal: opts.signal,
          headers: { 'user-agent': USER_AGENT, ...(opts.headers ?? {}) },
        });
        if (res.ok) return res;

        if (RETRY_STATUSES.has(res.status) && attempt < maxAttempts) {
          const retryAfter = Number(res.headers.get('retry-after'));
          await sleep(
            Number.isFinite(retryAfter) && retryAfter > 0
              ? retryAfter * 1000
              : 2 ** (attempt - 1) * 750 + Math.random() * 250,
          );
          continue;
        }
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} for ${url.split('?')[0]}: ${body.slice(0, 180)}`);
      } catch (err) {
        lastError = err;
        if (attempt >= maxAttempts) break;
        await sleep(2 ** (attempt - 1) * 750 + Math.random() * 250);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`failed to fetch ${url}`);
  }

  return {
    async text(url) {
      return (await request(url)).text();
    },
    async json<T>(url: string) {
      return (await request(url)).json() as Promise<T>;
    },
  };
}

/**
 * RFC 4180-ish CSV. Handles quoted fields containing commas, escaped quotes and
 * newlines, and both CRLF and LF. NSIDC's sea ice file needs this: its source
 * column is a quoted Python list with commas inside.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

/** Finite number or null. Never coerces junk to 0. */
export function num(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const s = typeof raw === 'string' ? raw.trim() : raw;
  if (s === '' || s === '.' || s === 'NA' || s === 'null') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Zero-padded ISO date from parts. Returns null if the parts are not a real date. */
export function isoDate(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
