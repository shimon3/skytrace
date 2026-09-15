import http from 'node:http';
import statesHandler from './api/states.js';
import healthHandler from './api/health.js';

function adaptResponse(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => {
    if (!res.headersSent) res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
    return res;
  };
  return res;
}

const server = http.createServer(async (req, rawRes) => {
  const res = adaptResponse(rawRes);
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  req.query = Object.fromEntries(url.searchParams.entries());
  try {
    if (url.pathname === '/api/health') return await healthHandler(req, res);
    if (url.pathname === '/api/states') return await statesHandler(req, res);
    return res.status(200).json({ ok: true, service: 'skytrace-opensky-proxy', endpoints: ['/api/health', '/api/states'] });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
    res.end();
  }
});

const port = Number(process.env.PORT || 10000);
server.listen(port, '0.0.0.0', () => console.log(`SkyTrace OpenSky proxy listening on ${port}`));
