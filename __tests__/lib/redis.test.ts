/**
 * Unit tests for the safe Redis wrappers (src/lib/redis.ts).
 *
 * The whole contract of this module is "never throw, degrade to no-cache". The
 * @upstash/redis client is mocked so we can force missing env, thrown errors,
 * and normal values, and assert the wrappers always return the safe value.
 *
 * getRedis() memoizes on first call, so each test resets modules and re-imports
 * with the env it wants.
 */

const mockRedisInstance = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
}

jest.mock('@upstash/redis', () => ({
  Redis: jest.fn(() => mockRedisInstance),
}))

const ORIGINAL_ENV = process.env

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
  process.env = { ...ORIGINAL_ENV }
})

afterAll(() => {
  process.env = ORIGINAL_ENV
})

function withEnv() {
  process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io'
  process.env.UPSTASH_REDIS_REST_TOKEN = 'token'
}

function withoutEnv() {
  delete process.env.UPSTASH_REDIS_REST_URL
  delete process.env.UPSTASH_REDIS_REST_TOKEN
}

describe('getRedis', () => {
  it('returns null when env vars are absent (caching disabled)', () => {
    withoutEnv()
    const { getRedis } = require('@/lib/redis')
    expect(getRedis()).toBeNull()
  })

  it('constructs a client when env vars are present', () => {
    withEnv()
    const { getRedis } = require('@/lib/redis')
    expect(getRedis()).toBe(mockRedisInstance)
  })
})

describe('redisGetJSON', () => {
  it('returns undefined (not throw) when Redis is not configured', async () => {
    withoutEnv()
    const { redisGetJSON } = require('@/lib/redis')
    await expect(redisGetJSON('k')).resolves.toBeUndefined()
  })

  it('returns undefined when the client throws', async () => {
    withEnv()
    mockRedisInstance.get.mockRejectedValue(new Error('network'))
    const { redisGetJSON } = require('@/lib/redis')
    await expect(redisGetJSON('k')).resolves.toBeUndefined()
  })

  it('returns undefined on a miss (null from Redis)', async () => {
    withEnv()
    mockRedisInstance.get.mockResolvedValue(null)
    const { redisGetJSON } = require('@/lib/redis')
    await expect(redisGetJSON('k')).resolves.toBeUndefined()
  })

  it('returns the stored value on a hit', async () => {
    withEnv()
    mockRedisInstance.get.mockResolvedValue({ a: 1 })
    const { redisGetJSON } = require('@/lib/redis')
    await expect(redisGetJSON('k')).resolves.toEqual({ a: 1 })
  })
})

describe('redisSetJSON / redisDel never throw', () => {
  it('redisSetJSON is a no-op (no throw) without env', async () => {
    withoutEnv()
    const { redisSetJSON } = require('@/lib/redis')
    await expect(redisSetJSON('k', { a: 1 }, 60)).resolves.toBeUndefined()
  })

  it('redisSetJSON swallows a client error', async () => {
    withEnv()
    mockRedisInstance.set.mockRejectedValue(new Error('boom'))
    const { redisSetJSON } = require('@/lib/redis')
    await expect(redisSetJSON('k', { a: 1 }, 60)).resolves.toBeUndefined()
  })

  it('redisSetJSON passes the TTL through as { ex }', async () => {
    withEnv()
    mockRedisInstance.set.mockResolvedValue('OK')
    const { redisSetJSON } = require('@/lib/redis')
    await redisSetJSON('k', { a: 1 }, 120)
    expect(mockRedisInstance.set).toHaveBeenCalledWith('k', { a: 1 }, { ex: 120 })
  })

  it('redisDel is a no-op with no keys', async () => {
    withEnv()
    const { redisDel } = require('@/lib/redis')
    await redisDel()
    expect(mockRedisInstance.del).not.toHaveBeenCalled()
  })

  it('redisDel swallows a client error', async () => {
    withEnv()
    mockRedisInstance.del.mockRejectedValue(new Error('boom'))
    const { redisDel } = require('@/lib/redis')
    await expect(redisDel('k1', 'k2')).resolves.toBeUndefined()
  })
})
