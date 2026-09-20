import { prisma } from '@/lib/prisma'
import { getRedis } from '@/lib/redis'

// Redis-backed view/viewer counters.
//
// Why: totalViews, uniqueVisitors, timerViews and peakViewers were all written
// straight onto the single `auctions` row - the SAME row live bidding writes
// (bidHistory, currentPlayerId). Every viewer's page-view therefore took a
// row-level write lock on the hot auction row and serialized against actual
// bids. Live viewer count was worse: it lived in a per-process in-memory Map,
// so on Vercel's many function instances it was fragmented and wrong.
//
// This module moves the counters into Redis (atomic INCR/DECR, no Postgres
// row lock on the hot path) and flushes them back to Postgres periodically,
// so:
//  - Postgres stays the durable home of these numbers (the dashboard, tables
//    and analytics keep reading auction.totalViews etc. exactly as before).
//  - The per-viewer write no longer contends with bidding.
//  - Live viewer count is correct across all serverless instances.
//
// BEHAVIOUR IS PRESERVED: counters are SEEDED from the current Postgres values
// on first touch, so numbers continue from where they are today instead of
// resetting to zero. Uniqueness is still decided by the durable AuctionView
// rows (see track-view route), not by Redis. Response shapes are unchanged.
//
// Redis unavailable => every function here falls back to the previous
// Postgres-only behaviour, so the feature degrades, never breaks.

const keys = {
  total: (id: string) => `views:total:${id}`,
  unique: (id: string) => `views:unique:${id}`,
  timer: (id: string) => `views:timer:${id}`,
  peak: (id: string) => `views:peak:${id}`,
  live: (id: string) => `views:live:${id}`,
  seeded: (id: string) => `views:seeded:${id}`,
}

// Per-instance memo of which auctions this process has already seeded, so the
// seed check (below) is a cheap in-memory short-circuit after the first hit on
// a warm instance instead of a Redis round-trip every request.
const seededThisInstance = new Set<string>()

// Copy the current Postgres counter values into Redis exactly once per auction
// (guarded by a Redis SETNX flag so concurrent requests and multiple instances
// don't double-seed). This is what makes the switch invisible: the Redis
// counters start at today's real numbers, not zero.
async function ensureSeeded(auctionId: string): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  if (seededThisInstance.has(auctionId)) return

  try {
    // Claim the seed for this auction; only the first caller across all
    // instances gets `true` back and does the Postgres read + seed writes.
    const won = await redis.set(keys.seeded(auctionId), '1', { nx: true })
    if (won) {
      const auction = await prisma.auction.findUnique({
        where: { id: auctionId },
        select: { totalViews: true, uniqueVisitors: true, timerViews: true, peakViewers: true },
      })
      if (auction) {
        // NX on each so a racing INCR that already created the key isn't
        // clobbered back down to the seed value.
        await Promise.all([
          redis.set(keys.total(auctionId), auction.totalViews, { nx: true }),
          redis.set(keys.unique(auctionId), auction.uniqueVisitors, { nx: true }),
          redis.set(keys.timer(auctionId), auction.timerViews, { nx: true }),
          redis.set(keys.peak(auctionId), auction.peakViewers, { nx: true }),
        ])
      }
    }
    seededThisInstance.add(auctionId)
  } catch (error) {
    console.error('[view-tracking] seed failed (non-fatal)', auctionId, error)
  }
}

// Flush Redis counters back into the durable Postgres row. Sampled from the
// hot path so the auction-row write happens rarely (not per viewer), and also
// safe to call from a cron. Uses plain assignment of the authoritative Redis
// values (not increment) so it's idempotent and can't double-count.
export async function flushViewStats(auctionId: string): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  try {
    const [total, unique, timer, peak] = await Promise.all([
      redis.get<number>(keys.total(auctionId)),
      redis.get<number>(keys.unique(auctionId)),
      redis.get<number>(keys.timer(auctionId)),
      redis.get<number>(keys.peak(auctionId)),
    ])
    const data: Record<string, number> = {}
    if (typeof total === 'number') data.totalViews = total
    if (typeof unique === 'number') data.uniqueVisitors = unique
    if (typeof timer === 'number') data.timerViews = timer
    if (typeof peak === 'number') data.peakViewers = peak
    if (Object.keys(data).length > 0) {
      await prisma.auction.update({ where: { id: auctionId }, data })
    }
  } catch (error) {
    console.error('[view-tracking] flush failed (non-fatal)', auctionId, error)
  }
}

// ~5% of writes also flush, so Postgres stays current for the dashboard while
// the auction-row write happens on roughly 1 in 20 views instead of every one.
const FLUSH_SAMPLE_RATE = 0.05

// Record a page view. `isNewVisitor` is decided by the caller from the durable
// AuctionView rows (unchanged), so uniqueness semantics are identical to
// before. Returns the running totals for the response.
//
// Returns null when Redis is unavailable, signalling the caller to fall back
// to the original Postgres increment path so the numbers still move.
export async function recordView(
  auctionId: string,
  isNewVisitor: boolean
): Promise<{ totalViews: number; uniqueVisitors: number } | null> {
  const redis = getRedis()
  if (!redis) return null
  try {
    await ensureSeeded(auctionId)
    const totalViews = await redis.incr(keys.total(auctionId))
    const uniqueVisitors = isNewVisitor
      ? await redis.incr(keys.unique(auctionId))
      : ((await redis.get<number>(keys.unique(auctionId))) ?? 0)

    if (Math.random() < FLUSH_SAMPLE_RATE) {
      // Fire-and-forget - the response doesn't wait on the Postgres sync.
      void flushViewStats(auctionId)
    }
    return { totalViews, uniqueVisitors }
  } catch (error) {
    console.error('[view-tracking] recordView failed, caller should fall back', auctionId, error)
    return null
  }
}

// Record a countdown-timer page view. Returns the running total, or null when
// Redis is unavailable (caller falls back to the Postgres increment).
export async function recordTimerView(auctionId: string): Promise<number | null> {
  const redis = getRedis()
  if (!redis) return null
  try {
    await ensureSeeded(auctionId)
    const timerViews = await redis.incr(keys.timer(auctionId))
    if (Math.random() < FLUSH_SAMPLE_RATE) void flushViewStats(auctionId)
    return timerViews
  } catch (error) {
    console.error('[view-tracking] recordTimerView failed, caller should fall back', auctionId, error)
    return null
  }
}

// Live viewer count. INCR/DECR a Redis counter shared across all instances -
// same join/leave/get contract the in-memory Map had, but correct on
// serverless. Peak is tracked in Redis and flushed to Postgres. Returns null
// when Redis is unavailable so the caller can preserve the old response.
export async function viewerJoin(auctionId: string): Promise<number | null> {
  const redis = getRedis()
  if (!redis) return null
  try {
    await ensureSeeded(auctionId)
    const count = await redis.incr(keys.live(auctionId))
    // New peak? Record it in Redis and flush the peak to Postgres.
    const peak = (await redis.get<number>(keys.peak(auctionId))) ?? 0
    if (count > peak) {
      await redis.set(keys.peak(auctionId), count)
      void flushViewStats(auctionId)
    }
    return count
  } catch (error) {
    console.error('[view-tracking] viewerJoin failed', auctionId, error)
    return null
  }
}

export async function viewerLeave(auctionId: string): Promise<number | null> {
  const redis = getRedis()
  if (!redis) return null
  try {
    const count = await redis.decr(keys.live(auctionId))
    // Never report or persist a negative live count (a leave without a
    // matching join, e.g. after a redeploy reset the counter).
    if (count < 0) {
      await redis.set(keys.live(auctionId), 0)
      return 0
    }
    return count
  } catch (error) {
    console.error('[view-tracking] viewerLeave failed', auctionId, error)
    return null
  }
}

export async function viewerGet(auctionId: string): Promise<number | null> {
  const redis = getRedis()
  if (!redis) return null
  try {
    return (await redis.get<number>(keys.live(auctionId))) ?? 0
  } catch (error) {
    console.error('[view-tracking] viewerGet failed', auctionId, error)
    return null
  }
}
