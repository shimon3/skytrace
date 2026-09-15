const TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const STATES_URL = 'https://opensky-network.org/api/states/all?lamin=29.5&lomin=32.5&lamax=33.5&lomax=36';

function errorInfo(error) {
  const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
  return {
    ok: false,
    error: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR',
    name: error?.name || null,
    message: error instanceof Error ? error.message : String(error),
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  res.setHeader('Cache-Control', 'no-store');

  const clientId = String(process.env.OPENSKY_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.OPENSKY_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) {
    return res.status(503).json({ ok: false, oauthConfigured: false, error: 'OPENSKY_OAUTH_NOT_CONFIGURED' });
  }

  const result = {
    ok: false,
    oauthConfigured: true,
    oauth: null,
    api: { attempted: false, ok: false, http: null, ms: null, aircraft: null },
  };

  let token;
  const oauthStarted = Date.now();
  try {
    const tokenResponse = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
      signal: AbortSignal.timeout(12000),
    });
    const tokenPayload = await tokenResponse.json().catch(() => null);
    result.oauth = {
      ok: tokenResponse.ok && Boolean(tokenPayload?.access_token),
      http: tokenResponse.status,
      ms: Date.now() - oauthStarted,
    };
    if (!result.oauth.ok) {
      result.error = 'OPENSKY_TOKEN_FAILED';
      return res.status(502).json(result);
    }
    token = String(tokenPayload.access_token);
  } catch (error) {
    result.oauth = { ...errorInfo(error), http: null, ms: Date.now() - oauthStarted };
    result.error = result.oauth.error === 'TIMEOUT' ? 'OPENSKY_OAUTH_TIMEOUT' : 'OPENSKY_OAUTH_NETWORK_ERROR';
    return res.status(result.oauth.error === 'TIMEOUT' ? 504 : 502).json(result);
  }

  const apiStarted = Date.now();
  result.api.attempted = true;
  try {
    const statesResponse = await fetch(STATES_URL, {
      headers: { accept: 'application/json', authorization: `Bearer ${token}`, 'user-agent': 'SkyTrace/2.6' },
      signal: AbortSignal.timeout(12000),
    });
    const statesPayload = await statesResponse.json().catch(() => null);
    result.api = {
      attempted: true,
      ok: statesResponse.ok,
      http: statesResponse.status,
      ms: Date.now() - apiStarted,
      aircraft: Array.isArray(statesPayload?.states) ? statesPayload.states.length : null,
    };
    result.ok = result.oauth.ok && result.api.ok;
    if (!result.api.ok) result.error = 'OPENSKY_API_HTTP_ERROR';
    return res.status(result.ok ? 200 : 502).json(result);
  } catch (error) {
    result.api = {
      attempted: true,
      ...errorInfo(error),
      http: null,
      ms: Date.now() - apiStarted,
      aircraft: null,
    };
    result.error = result.api.error === 'TIMEOUT' ? 'OPENSKY_API_TIMEOUT' : 'OPENSKY_API_NETWORK_ERROR';
    return res.status(result.api.error === 'TIMEOUT' ? 504 : 502).json(result);
  }
}
