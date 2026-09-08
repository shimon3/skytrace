import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const integration = await readFile(
  new URL('../js/flight-status-integration.js', import.meta.url),
  'utf8'
);
const flightStatusWorker = await readFile(
  new URL('../functions/api/flight-status.js', import.meta.url),
  'utf8'
);
const aircraftWorker = await readFile(
  new URL('../functions/api/aircraft.js', import.meta.url),
  'utf8'
);
const apiClient = await readFile(new URL('../js/api-client.js', import.meta.url), 'utf8');

const forbiddenSecretPatterns = [
  /AIRLABS_API_KEY\s*=\s*['"][^'"]+['"]/,
  /api_key=[A-Za-z0-9_-]{12,}/,
];
const optionalVersion = '(?:\\?v=[A-Za-z0-9._-]+)?';

test('keeps the aircraft application and loads AirLabs as an additive module', () => {
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
  assert.match(flightStatusWorker, /context\.env\.AIRLABS_API_KEY/);
  assert.doesNotMatch(index, /AIRLABS_API_KEY/);
  assert.doesNotMatch(integration, /AIRLABS_API_KEY/);
  for (const pattern of forbiddenSecretPatterns) {
    assert.doesNotMatch(flightStatusWorker, pattern);
    assert.doesNotMatch(integration, pattern);
  }
});

test('queries AirLabs only through the same-origin Cloudflare endpoint', () => {
  assert.match(integration, /new URL\('\/api\/flight-status', location\.origin\)/);
  assert.doesNotMatch(integration, /airlabs\.co\/api/);
  assert.match(flightStatusWorker, /https:\/\/airlabs\.co\/api\/v9\/flight/);
});

test('keeps aircraft providers behind the same-origin proxy', () => {
  assert.match(apiClient, /const AIRCRAFT_API = '\/api\/aircraft'/);
  assert.doesNotMatch(apiClient, /opendata\.adsb\.fi/);
  assert.doesNotMatch(apiClient, /api\.airplanes\.live\/v2\/point/);
  assert.doesNotMatch(apiClient, /api\.adsb\.lol\/v2\/point/);
  assert.match(aircraftWorker, /https:\/\/opendata\.adsb\.fi\/api\/v3/);
  assert.match(aircraftWorker, /https:\/\/api\.airplanes\.live\/v2\/point/);
  assert.match(aircraftWorker, /https:\/\/api\.adsb\.lol\/v2\/point/);
  assert.doesNotMatch(aircraftWorker, /adsb\.one/);
  assert.match(index, /Données live[\s\S]*adsb\.fi[\s\S]*adsb\.lol/);
});

test('caches commercial flight lookups to protect the AirLabs quota', () => {
  assert.match(integration, /CACHE_TTL_MS = 5 \* 60 \* 1000/);
  assert.match(flightStatusWorker, /CACHE_SECONDS = 300/);
  assert.match(flightStatusWorker, /caches\.default/);
});
