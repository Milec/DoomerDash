/**
 * Fails the build if a credential reached the browser bundle.
 *
 * The frontend talks only to /api/*, so dist/ must contain no API key, no
 * Supabase URL, and no service token. Run before every deploy.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
})(DIST);

// Literal secret values from the environment, plus structural patterns that
// match a leaked key even when this process cannot see the value itself.
const literals = ['SUPABASE_SERVICE_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'FRED_API_KEY', 'INGEST_TOKEN']
  .map((k) => process.env[k])
  .filter((v) => typeof v === 'string' && v.length >= 12);

const patterns = [
  [/\bsb_secret_[A-Za-z0-9_-]{10,}/g, 'Supabase secret key'],
  [/\bsb_publishable_[A-Za-z0-9_-]{10,}/g, 'Supabase publishable key'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, 'JWT (Supabase anon/service key)'],
  [/https:\/\/[a-z0-9]{16,}\.supabase\.co/g, 'Supabase project URL'],
  [/api\.stlouisfed\.org/g, 'direct FRED call from the client'],
  [/\bapi_key=[A-Za-z0-9]{16,}/g, 'inline api_key parameter'],
];

const findings = [];
for (const file of files) {
  if (!/\.(js|mjs|cjs|css|html|json|map|txt)$/.test(file)) continue;
  const text = readFileSync(file, 'utf8');
  for (const [re, label] of patterns) {
    if (re.test(text)) findings.push(`${file}: ${label}`);
    re.lastIndex = 0;
  }
  for (const value of literals) {
    if (text.includes(value)) findings.push(`${file}: literal secret value`);
  }
}

if (findings.length) {
  console.error('Secret material found in the built bundle:\n' + findings.map((f) => `  ${f}`).join('\n'));
  process.exit(1);
}
console.log(`check:bundle - scanned ${files.length} files in ${DIST}/, no credentials found`);
