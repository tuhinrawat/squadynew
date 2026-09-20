import { Redis } from '@upstash/redis'

// Upstash Redis over its REST API - the right client for Vercel's serverless
// functions (stateless HTTP per call, no long-lived TCP socket to leak across
// invocations the way ioredis would). Credentials come from the standard
// Upstash env vars:
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
//
// Redis here is a CACHE and a coordination layer, never a source of truth.
// Postgres remains authoritative for every write. If Redis is unreachable,
// misconfigured, or slow, the app must degrade to reading straight from
// Postgres - never error. That "fail open to Postgres" contract is enforced
// by the safe wrappers below and by lib/cache.ts, not by callers.

let client: Redis | null = null
let triedInit = false

// Returns the shared Redis client, or null when Upstash env vars are absent
// (local dev without Redis, preview deploys, etc.). Callers must treat null
// as "cache unavailable, use Postgres" rather than throwing - see cache.ts.
export function getRedis(): Redis | null {
  if (triedInit) return client
  triedInit = true

  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[redis] UPSTASH_REDIS_REST_URL/TOKEN not set - caching disabled, reads fall through to Postgres')
    }
    client = null
    return null
  }

  try {
    client = new Redis({ url, token })
  } catch (error) {
    console.error('[redis] failed to initialize client - caching disabled', error)
    client = null
  }
  return client
}

// GET a JSON value. Returns undefined on miss OR on any Redis failure - the
// caller cannot tell the difference and must not need to: both mean "go ask
// Postgres". Never throws.
export async function redisGetJSON<T>(key: string): Promise<T | undefined> {
  const redis = getRedis()
  if (!redis) return undefined
  try {
    // @upstash/redis auto-deserializes JSON it stored via set(), so a value
    // written with redisSetJSON comes back already parsed as T.
    const value = await redis.get<T>(key)
    return value === null || value === undefined ? undefined : value
  } catch (error) {
    console.error('[redis] GET failed, falling back to source', key, error)
    return undefined
  }
}

// SET a JSON value with a required TTL (seconds). TTL is mandatory so a cache
// entry can never outlive its data indefinitely if an invalidation is ever
// missed - the TTL is the backstop, explicit invalidation is the fast path.
// Never throws; a failed write just means the next read is a cache miss.
export async function redisSetJSON(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  try {
    await redis.set(key, value, { ex: ttlSeconds })
  } catch (error) {
    console.error('[redis] SET failed (non-fatal)', key, error)
  }
}

// Delete one or more keys. Used by write paths to invalidate stale cache
// entries immediately after the authoritative Postgres write commits. Never
// throws - a missed delete only means readers see stale data until the TTL
// backstop expires it, never a broken write.
export async function redisDel(...keys: string[]): Promise<void> {
  if (keys.length === 0) return
  const redis = getRedis()
  if (!redis) return
  try {
    await redis.del(...keys)
  } catch (error) {
    console.error('[redis] DEL failed (non-fatal)', keys, error)
  }
}
