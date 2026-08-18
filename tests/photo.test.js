import test from 'node:test';
import assert from 'node:assert/strict';

import { onRequestGet } from '../functions/api/photo.js';
import { writeProviderControl } from '../functions/lib/provider-controls.js';
import { installFakeCaches, makeContext } from './helpers/cf-runtime.js';

const ORIGIN = 'https://skytrace.test';

function photoRequest(registration) {
  const url = new URL(`${ORIGIN}/api/photo`);
  if (registration !== undefined) url.searchParams.set('registration', registration);
  return new Request(url);
}

test('rejects a request without a registration', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  const context = makeContext({ request: photoRequest(''), env: {} });
  const response = await onRequestGet(context);
  assert.equal(response.status, 400);
});

test('is paused when the admin has disabled planespotters.net', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  const env = {};
  await writeProviderControl(env, 'planespotters.net', { enabled: false, pausedUntil: null }, ORIGIN);
  const context = makeContext({ request: photoRequest('4X-ABC'), env });
  const response = await onRequestGet(context);
  assert.equal(response.status, 503);
});

test('extracts the thumbnail URL from a successful lookup and caches it', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  let fetchCalls = 0;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    fetchCalls += 1;
    assert.match(String(input), /planespotters\.net\/pub\/photos\/reg\/4X-ABC/);
    // planespotters.net returns 403 to requests with no User-Agent header.
    assert.ok(init?.headers?.['user-agent'], 'expected a user-agent header on the upstream request');
    return new Response(
      JSON.stringify({ photos: [{ thumbnail_large: { src: 'https://img.example/4x-abc.jpg' } }] }),
      { status: 200 }
    );
  });

  const context1 = makeContext({ request: photoRequest('4X-ABC'), env: {} });
  const response1 = await onRequestGet(context1);
  await context1.flush();
  assert.equal((await response1.json()).url, 'https://img.example/4x-abc.jpg');

  const context2 = makeContext({ request: photoRequest('4X-ABC'), env: {} });
  const response2 = await onRequestGet(context2);
  assert.equal((await response2.json()).url, 'https://img.example/4x-abc.jpg');
  assert.equal(fetchCalls, 1);
});

test('returns null when no photo exists for the registration', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ photos: [] }), { status: 200 }));
  const context = makeContext({ request: photoRequest('4X-ABC'), env: {} });
  const response = await onRequestGet(context);
  assert.equal((await response.json()).url, null);
});

test('forwards the upstream error status when the provider fails', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  t.mock.method(globalThis, 'fetch', async () => new Response('nope', { status: 404 }));
  const context = makeContext({ request: photoRequest('4X-ABC'), env: {} });
  const response = await onRequestGet(context);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, 'PHOTO_PROVIDER_ERROR');
});

test('returns 502 when the upstream request throws', async (t) => {
  const { restore } = installFakeCaches();
  t.after(restore);
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('network down');
  });
  const context = makeContext({ request: photoRequest('4X-ABC'), env: {} });
  const response = await onRequestGet(context);
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, 'PHOTO_PROVIDER_UNAVAILABLE');
});
