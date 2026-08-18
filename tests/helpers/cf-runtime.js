// Minimal stand-ins for the Cloudflare Workers runtime pieces that
// functions/api and functions/lib rely on but that don't exist in Node:
// the Cache API (`caches.default`) and a KV namespace binding.

export class FakeCache {
  constructor() {
    this.store = new Map();
  }
  #key(reqOrUrl) {
    return typeof reqOrUrl === 'string' ? reqOrUrl : reqOrUrl.url;
  }
  async match(reqOrUrl) {
    const entry = this.store.get(this.#key(reqOrUrl));
    if (!entry) return undefined;
    return new Response(entry.body, { status: entry.status, headers: entry.headers });
  }
  async put(reqOrUrl, response) {
    const body = await response.text();
    this.store.set(this.#key(reqOrUrl), { status: response.status, headers: [...response.headers], body });
  }
  async delete(reqOrUrl) {
    return this.store.delete(this.#key(reqOrUrl));
  }
}

export class FakeKV {
  constructor() {
    this.store = new Map();
  }
  async get(key, opts) {
    if (!this.store.has(key)) return null;
    const value = this.store.get(key);
    return opts?.type === 'json' ? JSON.parse(value) : value;
  }
  async put(key, value) {
    this.store.set(key, value);
  }
}

export function installFakeCaches() {
  const cache = new FakeCache();
  const previous = globalThis.caches;
  globalThis.caches = { default: cache };
  return {
    cache,
    restore() {
      globalThis.caches = previous;
    },
  };
}

export function makeContext({ request, env = {} }) {
  const waits = [];
  return {
    request,
    env,
    waitUntil(promise) {
      waits.push(promise);
    },
    async flush() {
      await Promise.all(waits);
      waits.length = 0;
    },
  };
}
