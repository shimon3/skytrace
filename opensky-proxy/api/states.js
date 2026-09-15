let cachedToken = null;
let tokenExpiresAt = 0;

const TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const STATES_URL = 'https://opensky-network.org/api/states/all';

function clampNumber(value, min, max) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : null;
}

async function getToken(force = false) {
  if (!force && cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
  const clientId = String(process.env.OPENSKY_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.OPENSKY_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) throw new Error('OPENSKY_OAUTH_NOT_CONFIGURED');

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
    signal: AbortSignal.timeout(8000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.access_token) {
    const error = new Error(`OPENSKY_TOKEN_FAILED_${response.status}`);
    error.status = response.status;
    throw error;
  }
  cachedToken = String(payload.access_token);
  const ttl = Math.max(60, (Number(payload.expires_in) || 1800) - 120);
  tokenExpiresAt = Date.now() + ttl * 1000;
  return cachedToken;
}

async function fetchStates(url, token) {
  return fetch(url, {
    headers: { accept: 'application/json', authorization: `Bearer ${token}`, 'user-agent': 'SkyTrace/2.6' },
    signal: AbortSignal.timeout(10000),
  });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });

  const proxyKey = String(process.env.SKYTRACE_PROXY_KEY || '').trim();
  if (proxyKey && req.headers.authorization !== `Bearer ${proxyKey}`) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }

  const lamin = clampNumber(req.query.lamin, -85, 85);
  const lomin = clampNumber(req.query.lomin, -180, 180);
  const lamax = clampNumber(req.query.lamax, -85, 85);
  const lomax = clampNumber(req.query.lomax, -180, 180);
  if ([lamin, lomin, lamax, lomax].some((v) => v === null) || lamin >= lamax || lomin >= lomax) {
    return res.status(400).json({ error: 'INVALID_BBOX' });
  }

  const upstream = new URL(STATES_URL);
  upstream.searchParams.set('lamin', String(lamin));
  upstream.searchParams.set('lomin', String(lomin));
  upstream.searchParams.set('lamax', String(lamax));
  upstream.searchParams.set('lomax', String(lomax));

  try {
    let token = await getToken(false);
    let response = await fetchStates(upstream, token);
    if (response.status === 401) {
      cachedToken = null;
      tokenExpiresAt = 0;
      token = await getToken(true);
      response = await fetchStates(upstream, token);
    }
    const text = await response.text();
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
    res.setHeader('X-SkyTrace-Upstream', 'opensky');
    return res.status(response.status).send(text);
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return res.status(timedOut ? 504 : 502).json({ error: timedOut ? 'OPENSKY_TIMEOUT' : 'OPENSKY_PROXY_ERROR', detail: error instanceof Error ? error.message : String(error) });
  }
}
