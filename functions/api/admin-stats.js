import {
  getAutoPausePercent,
  getProviderDailyBudget,
  providerUsagePercent,
  readAllProviderControls,
} from '../lib/provider-controls.js';
import { readStats, utcDay } from '../lib/stats.js';

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

function previousUtcDays(count) {
  const result = [];
  const now = new Date();
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setUTCDate(now.getUTCDate() - offset);
    result.push(utcDay(date));
  }
  return result;
}

function providerHealth(provider, configured = true, enabled = true) {
  if (!configured) return 'not-configured';
  if (!enabled) return 'paused';
  if (!provider?.lastStatus) return 'unknown';
  if (provider.lastStatus >= 200 && provider.lastStatus < 300) return 'operational';
  if (provider.lastStatus === 429 || provider.lastStatus === 403) return 'limited';
  if (provider.lastStatus >= 500) return 'unavailable';
  return 'degraded';
}

export async function onRequestGet(context) {
  const configuredToken = context.env?.ADMIN_STATS_TOKEN;
  if (!configuredToken) return jsonResponse({ error: 'ADMIN_NOT_CONFIGURED' }, 503);

  const authorization = context.request.headers.get('authorization') || '';
  const providedToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!constantTimeEqual(providedToken, configuredToken))
    return jsonResponse({ error: 'UNAUTHORIZED' }, 401);

  const url = new URL(context.request.url);
  const day = utcDay();
  const stats = await readStats(context.env, day, url.origin);
  const controls = await readAllProviderControls(context.env, url.origin);
  const controlMap = Object.fromEntries(controls.map((item) => [item.provider, item]));
  const autoPausePercent = getAutoPausePercent(context.env);

  const historyDays = previousUtcDays(7);
  const history = await Promise.all(
    historyDays.map(async (historyDay) => {
      const item = await readStats(context.env, historyDay, url.origin);
      return {
        day: historyDay,
        requests: item.requests || 0,
        successes: item.successes || 0,
        failures: item.failures || 0,
        cacheHits: item.cacheHits || 0,
      };
    })
  );

  const providerDefinitions = [
    { id: 'adsb.fi', label: 'ADSB.fi', configured: true },
    { id: 'adsb.lol', label: 'adsb.lol', configured: true },
    {
      id: 'airplanes.live',
      label: 'Airplanes.live',
      configured: String(context.env?.AIRPLANES_LIVE_ACCESS || '') === '1',
    },
    { id: 'airlabs', label: 'AirLabs', configured: Boolean(context.env?.AIRLABS_API_KEY) },
    { id: 'planespotters.net', label: 'Planespotters.net', configured: true },
  ];

  const providers = providerDefinitions.map((definition) => {
    const provider = stats.providers?.[definition.id] || {};
    const control = controlMap[definition.id] || {
      enabled: true,
      pausedUntil: null,
      pauseReason: null,
    };
    const dailyBudget = getProviderDailyBudget(context.env, definition.id);
    const percentUsed = providerUsagePercent(provider.requests || 0, dailyBudget);

    return {
      ...definition,
      requests: provider.requests || 0,
      successes: provider.successes || 0,
      failures: provider.failures || 0,
      lastStatus: provider.lastStatus ?? null,
      lastRequestAt: provider.lastRequestAt || null,
      enabled: control.enabled,
      pausedUntil: control.pausedUntil,
      pauseReason: control.pauseReason || null,
      health: providerHealth(provider, definition.configured, control.enabled),
      dailyBudget,
      remainingBudget: Math.max(0, dailyBudget - (provider.requests || 0)),
      percentUsed,
      autoPausePercent,
    };
  });

  const hourly = Array.from({ length: 24 }, (_, hour) => {
    const key = String(hour).padStart(2, '0');
    const bucket = stats.hourly?.[key] || {};
    return {
      hour: key,
      requests: bucket.requests || 0,
      successes: bucket.successes || 0,
      failures: bucket.failures || 0,
    };
  });

  const primary = providers.find((provider) => provider.id === 'adsb.fi');
  const primaryBudget = primary?.dailyBudget || 1000;
  const primaryRequests = primary?.requests || 0;

  return jsonResponse({
    ...stats,
    providers,
    hourly,
    history,
    dailyLimit: primaryBudget,
    remaining: Math.max(0, primaryBudget - primaryRequests),
    percentUsed: primary?.percentUsed || 0,
    autoPausePercent,
    primaryProvider: 'adsb.fi',
    storage: context.env?.SKYTRACE_STATS ? 'KV' : 'cache-fallback',
  });
}
