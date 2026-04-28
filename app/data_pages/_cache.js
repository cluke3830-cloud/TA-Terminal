// Simple in-memory cache for serverless functions
// Vercel keeps lambda instances warm for ~5-15 min, so this prevents
// redundant API calls within the same warm instance.
// Per-entry TTL can be passed to setCache to override the default.

const cache = new Map();
const DEFAULT_TTL = 10 * 60 * 1000; // 10 minutes

export function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > entry.ttl) { cache.delete(key); return null; }
  return entry.data;
}

export function setCache(key, data, ttlMs = DEFAULT_TTL) {
  cache.set(key, { data, ts: Date.now(), ttl: ttlMs });
  if (cache.size > 200) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (now - v.ts > v.ttl) cache.delete(k);
    }
  }
}