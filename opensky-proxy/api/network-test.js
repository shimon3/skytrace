import dns from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';

const HOST = 'auth.opensky-network.org';

function tcpTest(address, family, timeout = 6000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.createConnection({ host: address, port: 443, family });
    const done = (payload) => { socket.destroy(); resolve({ ...payload, ms: Date.now() - started }); };
    socket.setTimeout(timeout, () => done({ ok: false, error: 'TIMEOUT' }));
    socket.once('connect', () => done({ ok: true }));
    socket.once('error', (e) => done({ ok: false, error: e.code || e.name, message: e.message }));
  });
}

function tlsTest(address, family, timeout = 7000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = tls.connect({ host: address, port: 443, family, servername: HOST, rejectUnauthorized: true });
    const done = (payload) => { socket.destroy(); resolve({ ...payload, ms: Date.now() - started }); };
    socket.setTimeout(timeout, () => done({ ok: false, error: 'TIMEOUT' }));
    socket.once('secureConnect', () => done({ ok: true, protocol: socket.getProtocol() }));
    socket.once('error', (e) => done({ ok: false, error: e.code || e.name, message: e.message }));
  });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  res.setHeader('Cache-Control', 'no-store');
  const out = { ok: false, host: HOST, dns: null, tests: [] };
  try {
    const records = await dns.lookup(HOST, { all: true });
    out.dns = { ok: true, records };
    for (const r of records.slice(0, 4)) {
      const tcp = await tcpTest(r.address, r.family);
      const tlsResult = tcp.ok ? await tlsTest(r.address, r.family) : { ok: false, skipped: true };
      out.tests.push({ address: r.address, family: r.family, tcp, tls: tlsResult });
    }
    out.ok = out.tests.some((t) => t.tls?.ok);
    return res.status(200).json(out);
  } catch (e) {
    out.dns = { ok: false, error: e.code || e.name, message: e.message };
    return res.status(200).json(out);
  }
}
