/**
 * Unit tests for the cache-aside layer (src/lib/cache.ts).
 *
 * The Redis wrappers and Prisma are mocked so these assert the LOGIC:
 *  - a cache hit returns the cached value without touching Postgres
 *  - a cache miss falls through to Postgres and populates the cache
 *  - a null/absent row is never memoized as a hit
 *  - Redis being unavailable degrades to always calling Postgres (never throws)
 *  - every invalidator deletes exactly the right key(s)
 */

// Mock the Redis wrappers so we drive hit/miss/failure deterministically.
jest.mock('@/lib/redis', () => ({
  redisGetJSON: jest.fn(),
  redisSetJSON: jest.fn(),
  redisDel: jest.fn(),
}))

// Mock Prisma - only the models cache.ts reads.
jest.mock('@/lib/prisma', () => ({
  prisma: {
    bidder: { findMany: jest.fn() },
    player: { findMany: jest.fn() },
    auction: { findUnique: jest.fn() },
  },
}))

import {
  cacheGetOrSet,
  getCachedBidderPurses,
  getCachedPlayerStatuses,
  invalidateBidders,
  invalidatePlayers,
  invalidateAuctionMeta,
  invalidateAuction,
} from '@/lib/cache'
import { redisGetJSON, redisSetJSON, redisDel } from '@/lib/redis'
import { prisma } from '@/lib/prisma'

const mockGet = redisGetJSON as jest.Mock
const mockSet = redisSetJSON as jest.Mock
const mockDel = redisDel as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
})

describe('cacheGetOrSet', () => {
  it('returns the cached value and does NOT call the fetcher on a hit', async () => {
    mockGet.mockResolvedValue([{ id: 'a', remainingPurse: 100 }])
    const fetcher = jest.fn()

    const result = await cacheGetOrSet('k', 60, fetcher)

    expect(result).toEqual([{ id: 'a', remainingPurse: 100 }])
    expect(fetcher).not.toHaveBeenCalled()
    expect(mockSet).not.toHaveBeenCalled()
  })

  it('calls the fetcher and populates the cache on a miss', async () => {
    mockGet.mockResolvedValue(undefined)
    const fetcher = jest.fn().mockResolvedValue([{ id: 'b' }])

    const result = await cacheGetOrSet('k', 60, fetcher)

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(mockSet).toHaveBeenCalledWith('k', [{ id: 'b' }], 60)
    expect(result).toEqual([{ id: 'b' }])
  })

  it('does NOT cache a null result (avoids memoizing a 404)', async () => {
    mockGet.mockResolvedValue(undefined)
    const fetcher = jest.fn().mockResolvedValue(null)

    const result = await cacheGetOrSet('k', 60, fetcher)

    expect(result).toBeNull()
    expect(mockSet).not.toHaveBeenCalled()
  })

  it('falls through to the fetcher when Redis is unavailable (get returns undefined)', async () => {
    // redisGetJSON already swallows Redis errors and returns undefined, so a
    // miss and an outage look identical here - either way Postgres is queried.
    mockGet.mockResolvedValue(undefined)
    const fetcher = jest.fn().mockResolvedValue(['fresh'])

    const result = await cacheGetOrSet('k', 60, fetcher)

    expect(result).toEqual(['fresh'])
    expect(fetcher).toHaveBeenCalled()
  })
})

describe('entity read helpers', () => {
  it('getCachedBidderPurses reads {id,remainingPurse} from Postgres on a miss', async () => {
    mockGet.mockResolvedValue(undefined)
    ;(prisma.bidder.findMany as jest.Mock).mockResolvedValue([{ id: 'b1', remainingPurse: 500 }])

    const result = await getCachedBidderPurses('auc1')

    expect(prisma.bidder.findMany).toHaveBeenCalledWith({
      where: { auctionId: 'auc1' },
      select: { id: true, remainingPurse: true },
    })
    expect(result).toEqual([{ id: 'b1', remainingPurse: 500 }])
  })

  it('getCachedPlayerStatuses reads {id,status,isIcon} from Postgres on a miss', async () => {
    mockGet.mockResolvedValue(undefined)
    ;(prisma.player.findMany as jest.Mock).mockResolvedValue([{ id: 'p1', status: 'SOLD', isIcon: false }])

    const result = await getCachedPlayerStatuses('auc1')

    expect(prisma.player.findMany).toHaveBeenCalledWith({
      where: { auctionId: 'auc1' },
      select: { id: true, status: true, isIcon: true },
    })
    expect(result).toEqual([{ id: 'p1', status: 'SOLD', isIcon: false }])
  })

  it('does NOT hit Postgres when the value is cached', async () => {
    mockGet.mockResolvedValue([{ id: 'b1', remainingPurse: 500 }])

    await getCachedBidderPurses('auc1')

    expect(prisma.bidder.findMany).not.toHaveBeenCalled()
  })
})

describe('invalidators delete the correct keys', () => {
  it('invalidateBidders clears only the bidders key', async () => {
    await invalidateBidders('auc1')
    expect(mockDel).toHaveBeenCalledWith('auction:bidders:auc1')
  })

  it('invalidatePlayers clears only the player-status key', async () => {
    await invalidatePlayers('auc1')
    expect(mockDel).toHaveBeenCalledWith('auction:players:status:auc1')
  })

  it('invalidateAuctionMeta clears meta (and slug pointer when given)', async () => {
    await invalidateAuctionMeta('auc1', 'my-slug')
    expect(mockDel).toHaveBeenCalledWith('auction:meta:auc1', 'auction:slug:my-slug')
  })

  it('invalidateAuctionMeta without a slug clears only the meta key', async () => {
    await invalidateAuctionMeta('auc1')
    expect(mockDel).toHaveBeenCalledWith('auction:meta:auc1')
  })

  it('invalidateAuction clears every facet (+ slug pointer)', async () => {
    await invalidateAuction('auc1', 'my-slug')
    expect(mockDel).toHaveBeenCalledWith(
      'auction:meta:auc1',
      'auction:bidders:auc1',
      'auction:players:status:auc1',
      'auction:slug:my-slug'
    )
  })
})
