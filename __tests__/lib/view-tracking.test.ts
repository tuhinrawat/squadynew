/**
 * Unit tests for Redis-backed view/viewer tracking (src/lib/view-tracking.ts).
 *
 * Focus is the "won't break" guarantees:
 *  - when Redis is unavailable every function returns null, signalling the
 *    route to fall back to its original Postgres path
 *  - when Redis is available, counters are seeded from Postgres (numbers
 *    continue, don't reset) and incremented atomically
 *  - viewerLeave never reports a negative count
 */

const mockRedis = {
  set: jest.fn(),
  get: jest.fn(),
  incr: jest.fn(),
  decr: jest.fn(),
}

jest.mock('@/lib/redis', () => ({
  getRedis: jest.fn(),
}))

jest.mock('@/lib/prisma', () => ({
  prisma: {
    auction: { findUnique: jest.fn(), update: jest.fn() },
  },
}))

import {
  recordView,
  recordTimerView,
  viewerJoin,
  viewerLeave,
  viewerGet,
} from '@/lib/view-tracking'
import { getRedis } from '@/lib/redis'
import { prisma } from '@/lib/prisma'

const mockGetRedis = getRedis as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  // Default: Redis available and healthy.
  mockGetRedis.mockReturnValue(mockRedis)
  mockRedis.set.mockResolvedValue('OK')
  mockRedis.get.mockResolvedValue(0)
  mockRedis.incr.mockResolvedValue(1)
  mockRedis.decr.mockResolvedValue(0)
  ;(prisma.auction.findUnique as jest.Mock).mockResolvedValue({
    totalViews: 10,
    uniqueVisitors: 4,
    timerViews: 2,
    peakViewers: 3,
  })
  // Keep the sampled flush out of these assertions.
  jest.spyOn(Math, 'random').mockReturnValue(0.99)
})

afterEach(() => {
  ;(Math.random as jest.Mock).mockRestore?.()
})

describe('fallback when Redis is unavailable', () => {
  beforeEach(() => mockGetRedis.mockReturnValue(null))

  it('recordView returns null (caller falls back to Postgres)', async () => {
    await expect(recordView('auc1', true)).resolves.toBeNull()
  })
  it('recordTimerView returns null', async () => {
    await expect(recordTimerView('auc1')).resolves.toBeNull()
  })
  it('viewerJoin / viewerLeave / viewerGet return null', async () => {
    await expect(viewerJoin('auc1')).resolves.toBeNull()
    await expect(viewerLeave('auc1')).resolves.toBeNull()
    await expect(viewerGet('auc1')).resolves.toBeNull()
  })
})

describe('recordView', () => {
  it('seeds counters from Postgres on first touch, then increments', async () => {
    // First caller wins the seed claim (SET NX -> truthy).
    mockRedis.set.mockResolvedValue('OK')
    mockRedis.incr.mockResolvedValueOnce(11) // total after incr

    const result = await recordView('auc1', true)

    // Seeded from the Postgres row.
    expect(prisma.auction.findUnique).toHaveBeenCalled()
    // total came back from INCR.
    expect(result).toEqual({ totalViews: 11, uniqueVisitors: 1 })
  })

  it('increments unique only for a new visitor', async () => {
    mockRedis.incr.mockResolvedValueOnce(11) // total
    mockRedis.get.mockResolvedValue(4) // existing unique count read for a returning visitor

    const result = await recordView('auc1', false)

    expect(result).toEqual({ totalViews: 11, uniqueVisitors: 4 })
  })

  it('returns null if a Redis op throws mid-way (caller falls back)', async () => {
    mockRedis.incr.mockRejectedValue(new Error('boom'))
    await expect(recordView('auc1', true)).resolves.toBeNull()
  })
})

describe('recordTimerView', () => {
  it('returns the incremented timer count', async () => {
    mockRedis.incr.mockResolvedValueOnce(3)
    await expect(recordTimerView('auc1')).resolves.toBe(3)
  })
})

describe('live viewer count', () => {
  it('viewerJoin increments and returns the count', async () => {
    mockRedis.incr.mockResolvedValueOnce(5)
    mockRedis.get.mockResolvedValue(3) // current peak
    await expect(viewerJoin('auc1')).resolves.toBe(5)
  })

  it('viewerLeave floors at 0 and never returns negative', async () => {
    mockRedis.decr.mockResolvedValueOnce(-1)
    const result = await viewerLeave('auc1')
    expect(result).toBe(0)
    // Also resets the counter back to 0 in Redis.
    expect(mockRedis.set).toHaveBeenCalledWith('views:live:auc1', 0)
  })

  it('viewerGet returns the current count', async () => {
    mockRedis.get.mockResolvedValue(7)
    await expect(viewerGet('auc1')).resolves.toBe(7)
  })
})
