import type { Env, ExecutionContext, ScheduledController, WorkersCacheStorage } from './env.d.ts';
import { dashboardPayload } from './api.ts';
import { ingestSource } from './ingest.ts';
import { CONNECTOR_SOURCES } from './connectors/registry.ts';

const DASHBOARD_TTL_SECONDS = 300;

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers ?? {}) },
  });

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Constant-time-ish bearer check. Compares full length regardless of where the
 * first mismatch is, so the route does not leak the token prefix through timing.
 */
function authorized(request: Request, env: Env): boolean {
  const expected = env.INGEST_TOKEN;
  if (!expected) return false;
  const header = request.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (presented.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function handleDashboard(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const cache = (caches as WorkersCacheStorage).default;
  const cacheKey = new Request(new URL('/api/dashboard', request.url).toString(), { method: 'GET' });

  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const payload = await dashboardPayload(env);
  const response = json(payload, {
    headers: {
      'cache-control': `public, max-age=60, s-maxage=${DASHBOARD_TTL_SECONDS}`,
      'x-doomerdash-cache': 'miss',
    },
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

async function handleIngest(request: Request, env: Env): Promise<Response> {
  if (!authorized(request, env)) {
    return json({ error: 'unauthorized' }, { status: 401 });
  }
  const source = new URL(request.url).searchParams.get('source');
  if (!source) {
    return json({ error: 'source parameter is required', known_sources: CONNECTOR_SOURCES }, { status: 400 });
  }
  if (!CONNECTOR_SOURCES.includes(source)) {
    return json({ error: `unknown source "${source}"`, known_sources: CONNECTOR_SOURCES }, { status: 404 });
  }
  try {
    const result = await ingestSource(source, env);
    return json(result, { status: result.status === 'error' ? 500 : 200 });
  } catch (err) {
    return json({ source, status: 'error', error: errorMessage(err) }, { status: 500 });
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return json({ ok: true, now: new Date().toISOString() });
    }

    if (url.pathname === '/api/dashboard') {
      try {
        return await handleDashboard(request, env, ctx);
      } catch (err) {
        return json({ error: errorMessage(err) }, { status: 502 });
      }
    }

    if (url.pathname === '/api/ingest') {
      if (request.method !== 'POST' && request.method !== 'GET') {
        return json({ error: 'method not allowed' }, { status: 405 });
      }
      return handleIngest(request, env);
    }

    if (url.pathname.startsWith('/api/')) {
      return json({ error: 'not found' }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },

  /** Cron Trigger: 09:00 UTC daily (see wrangler.toml). */
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        for (const source of CONNECTOR_SOURCES) {
          try {
            const result = await ingestSource(source, env);
            console.log(
              `[cron ${controller.cron}] ${source}: ${result.status}, ${result.rows_upserted} rows` +
                (result.error_text ? ` - ${result.error_text}` : ''),
            );
          } catch (err) {
            console.error(`[cron ${controller.cron}] ${source} failed: ${errorMessage(err)}`);
          }
        }
      })(),
    );
  },
};
