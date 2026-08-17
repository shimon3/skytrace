import { getDailyLimit, readStats, utcDay } from '../lib/stats.js';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, private',
      'x-content-type-options': 'nosniff',
    },
  });
}

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export async function onRequestGet(context) {
  const configuredToken = context.env?.ADMIN_STATS_TOKEN;
  if (!configuredToken) {
    return jsonResponse({ error: 'ADMIN_NOT_CONFIGURED' }, 503);
  }

  const authorization = context.request.headers.get('authorization') || '';
  const providedToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';

  if (!constantTimeEqual(providedToken, configuredToken)) {
    return jsonResponse({ error: 'UNAUTHORIZED' }, 401);
  }

  const url = new URL(context.request.url);
  const day = utcDay();
  const stats = await readStats(context.env, day, url.origin);
  const dailyLimit = getDailyLimit();

  return jsonResponse({
    ...stats,
    dailyLimit,
    remaining: Math.max(0, dailyLimit - stats.requests),
    percentUsed: dailyLimit > 0 ? Math.round((stats.requests / dailyLimit) * 1000) / 10 : 0,
    storage: context.env?.SKYTRACE_STATS ? 'KV' : 'cache-fallback',
  });
}
