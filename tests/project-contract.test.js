import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const optionalVersion = '(?:\\?v=[A-Za-z0-9._-]+)?';

test('index loads the modular application and current styles', async () => {
  const html = await read('index.html');
  assert.match(
    html,
    new RegExp(`<script type="module" src="app\\.js${optionalVersion}"><\\/script>`)
  );
  assert.match(html, new RegExp(`href="mobile\\.css${optionalVersion}"`));
  assert.match(html, /id="p-registration"/);
  assert.doesNotMatch(html, /runtime-guard\.js/);
});

test('application uses registration terminology and modular imports', async () => {
  const app = await read('app.js');
  assert.match(app, /from '\.\/data\/airports\.js'/);
  assert.match(app, /from '\.\/js\/api-client\.js'/);
  assert.match(app, /from '\.\/js\/flight-utils\.js'/);
  assert.match(app, /requestAnimationFrame\(render\)/);
  assert.match(app, /status_age/);
  assert.doesNotMatch(app, /\.country\b/);
});

test('global scan retains representative remote regions', async () => {
  const app = await read('app.js');
  for (const region of [
    'Russie (Ouest)',
    'Sibérie',
    'Pacifique (Hawaï)',
    'Alaska',
    'Atlantique Nord',
    'Chili',
  ]) {
    assert.match(app, new RegExp(region.replace(/[()]/g, '\\$&')));
  }
});
