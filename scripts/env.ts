import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Node-side config. Reads process.env first, then falls back to .dev.vars so
 * local scripts and tests use the same file `wrangler dev` does. Nothing here
 * is ever bundled into the browser build.
 */
export function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const line of readFileSync(resolve(root, '.dev.vars'), 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    // .dev.vars is optional; process.env alone is a valid setup.
  }
  for (const [k, v] of Object.entries(process.env)) if (v) out[k] = v;
  return out;
}

export function requireEnv(keys: string[]): Record<string, string> {
  const env = loadEnv();
  const missing = keys.filter((k) => !env[k]);
  if (missing.length) {
    throw new Error(
      `Missing ${missing.join(', ')}. Set them in .dev.vars (see .dev.vars.example) or the environment.`,
    );
  }
  return env;
}
