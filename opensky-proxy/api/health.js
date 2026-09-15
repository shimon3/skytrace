const TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const STATES_URL = 'https://opensky-network.org/api/states/all?lamin=29.5&lomin=32.5&lamax=33.5&lomax=36';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });

  const clientId = String(process.env.OPENSKY_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.OPENSKY_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) {
    return res.status(503).json({ ok: false, oauthConfigured: false, error: 'OPENSKY_OAUTH_NOT_CONFIGURED' });
  }

  try {
    const tokenResponse = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
      signal: AbortSignal.timeout(8000),
    });
    const tokenPayload = await tokenResponse.json().catch(() => null);
    if (!tokenResponse.ok || !tokenPayload?.access_token) {
      return res.status(502).json({ ok: false, oauthConfigured: true, oauth: { ok: false, http: tokenResponse.status }, api: { ok: false, http: null }, error: 'OPENSKY_TOKEN_FAILED' });
    }

    const statesResponse = await fetch(STATES_URL, {
      headers: { accept: 'application/json', authorization: `Bearer ${tokenPayload.access_token}`, 'user-agent': 'SkyTrace/2.6' },
      signal: AbortSignal.timeout(10000),
    });
    const statesPayload = await statesResponse.json().catch(() => null);
    const aircraft = Array.isArray(statesPayload?.states) ? statesPayload.states.length : null;

    res.setHeader('Cache-Control', 'no-store');
    return res.status(statesResponse.ok ? 200 : 502).json({
      ok: statesResponse.ok,
      oauthConfigured: true,
      oauth: { ok: true, http: tokenResponse.status },
      api: { ok: statesResponse.ok, http: statesResponse.status, aircraft },
    });
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return res.status(timedOut ? 504 : 502).json({ ok: false, oauthConfigured: true, error: timedOut ? 'OPENSKY_TIMEOUT' : 'OPENSKY_HEALTH_ERROR' });
  }
}
