/**
 * Simple in-memory TTL cache.
 * Works in both Node.js and Vercel serverless (per-instance).
 */

const store = new Map();

const DEFAULT_TTL = 900; // 15 minutes

function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

function set(key, value, ttlSeconds) {
  const ttl = ttlSeconds ?? parseInt(process.env.CACHE_TTL || DEFAULT_TTL, 10);
  store.set(key, {
    value,
    expiresAt: Date.now() + ttl * 1000,
  });
}

function clear() {
  store.clear();
}

module.exports = { get, set, clear };
