import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const integration = await readFile(
  new URL('../js/flight-status-integration.js', import.meta.url),
  'utf8'
);
const worker = await readFile(
  new URL('../functions/api/flight-status.js', import.meta.url),
  'utf8'
);

const forbiddenSecretPatterns = [
  /AIRLABS_API_KEY\s*=\s*['"][^'"]+['"]/, 
  /api_key=[A-Za-z0-9_-]{12,}/,
];

const optionalVersion = '(?:\\?v=[A-Za-z0-9._-]+)?';

test('keeps the existing aircraft application and loads AirLabs as an additive module', () => {
  assert.match(
    index,
    new RegExp(`<script type="module" src="app\\.js${optionalVersion}"><\\/script>`)
  );
  assert.match(
    index,
    new RegExp(
      `<script type="module" src="js\\/flight-status-integration\\.js${optionalVersion}"><\\/script>`
    )
  );
  assert.match(index, new RegExp(`href="flight-status\\.css${optionalVersion}"`));
});

test('stores the AirLabs key only in the Cloudflare environment', () => {
  assert.match(worker, /context\.env\.AIRLABS_API_KEY/);
  assert.doesNotMatch(index, /AIRLABS_API_KEY/);
  assert.doesNotMatch(integration, /AIRLABS_API_KEY/);
  for (const pattern of forbiddenSecretPatterns) {
    assert.doesNotMatch(worker, pattern);
    assert.doesNotMatch(integration, pattern);
  }
});

test('queries AirLabs only through the same-origin Cloudflare endpoint', () => {
  assert.match(integration, /new URL\('\/api\/flight-status', location\.origin\)/);
  assert.doesNotMatch(integration, /airlabs\.co\/api/);
  assert.match(worker, /https:\/\/airlabs\.co\/api\/v9\/flight/);
});

test('preserves Airplanes.live as the aircraft position source', async () => {
  const apiClient = await readFile(new URL('../js/api-client.js', import.meta.url), 'utf8');
  assert.match(apiClient, /api\.airplanes\.live\/v2\/point/);
  assert.match(index, /Données: airplanes\.live/);
});

test('caches commercial flight lookups to protect the AirLabs quota', () => {
  assert.match(integration, /CACHE_TTL_MS = 5 \* 60 \* 1000/);
  assert.match(worker, /CACHE_SECONDS = 300/);
  assert.match(worker, /caches\.default/);
});
