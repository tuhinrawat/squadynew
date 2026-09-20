import { prisma } from '@/lib/prisma'
import { redisGetJSON, redisSetJSON, redisDel } from '@/lib/redis'

// Cache-aside layer over Postgres.
//
// Contract (the whole point of this file):
//  - Postgres is ALWAYS the source of truth. Every write goes to Postgres.
//  - Reads try Redis first; on a miss (or any Redis failure) they read
//    Postgres, populate Redis with a TTL, and return. A viewer therefore
//    reads from Redis "the majority of the time" without Redis ever being
//    able to serve data Postgres didn't originate.
//  - Writes invalidate the affected keys AFTER the Postgres write commits.
//    Invalidation is the fast path; the TTL on every key is the backstop for
//    any invalidation that is ever missed, so stale data self-heals.
//
// Only cache data that is SMALL and read FAR more often than it changes -
// exactly the snapshot poll's per-auction bidder purses and player-status
// list (read every few seconds by every viewer, changed only on a sale /
// unsold / advance), and static auction metadata. Per-bid state
// (current highest bid, bidHistory) is deliberately NOT cached here - it
// changes on every bid and is already collapsed by the snapshot route's
// 2-second edge cache.

// ---- TTL backstops (seconds). Invalidation is primary; these just cap how
// long a missed invalidation can serve stale data. ----
const TTL = {
  auctionMeta: 300, // static-ish fields; also invalidated on auction edit/publish
  bidders: 120, // purses; invalidated on sale / undo-sale / reset / roster change
  playerStatuses: 60, // status list; invalidated on every player-status write
} as const

// ---- Key builders (one place, so invalidation and reads can never disagree
// on the string). ----
const keys = {
  auctionMeta: (id: string) => `auction:meta:${id}`,
  slugToId: (slug: string) => `auction:slug:${slug}`,
  bidders: (auctionId: string) => `auction:bidders:${auctionId}`,
  playerStatuses: (auctionId: string) => `auction:players:status:${auctionId}`,
}

// Generic cache-aside: return the cached value if present, otherwise run the
// Postgres fetcher, cache its result, and return it. Never throws on cache
// problems - a Redis outage degrades to calling `fetcher` every time, which
// is exactly the pre-cache behaviour.
export async function cacheGetOrSet<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const cached = await redisGetJSON<T>(key)
  if (cached !== undefined) return cached

  const fresh = await fetcher()
  // Only cache non-null results; a null/absent row shouldn't be memoized as a
  // hit (avoids caching a 404 for the whole TTL right before the row appears).
  if (fresh !== null && fresh !== undefined) {
    await redisSetJSON(key, fresh, ttlSeconds)
  }
  return fresh
}

// ---------------------------------------------------------------------------
// Bidder purses - read on every snapshot poll, changed only on sale /
// undo-sale / reset / roster edits.
// ---------------------------------------------------------------------------
export type CachedBidder = { id: string; remainingPurse: number }

export async function getCachedBidderPurses(auctionId: string): Promise<CachedBidder[]> {
  return cacheGetOrSet(keys.bidders(auctionId), TTL.bidders, () =>
    prisma.bidder.findMany({
      where: { auctionId },
      select: { id: true, remainingPurse: true },
    })
  )
}

export function invalidateBidders(auctionId: string): Promise<void> {
  return redisDel(keys.bidders(auctionId))
}

// ---------------------------------------------------------------------------
// Player status list ({id,status,isIcon}) - read on every snapshot poll for
// the sold/unsold/remaining counts and the icon-phase check; changed on every
// player-status write (sale, unsold, advance, reset, roster edits).
// ---------------------------------------------------------------------------
export type CachedPlayerStatus = { id: string; status: string; isIcon: boolean }

export async function getCachedPlayerStatuses(auctionId: string): Promise<CachedPlayerStatus[]> {
  return cacheGetOrSet(keys.playerStatuses(auctionId), TTL.playerStatuses, () =>
    prisma.player.findMany({
      where: { auctionId },
      select: { id: true, status: true, isIcon: true },
    })
  )
}

export function invalidatePlayers(auctionId: string): Promise<void> {
  return redisDel(keys.playerStatuses(auctionId))
}

// ---------------------------------------------------------------------------
// Static auction metadata - the fields that don't change during live bidding
// (name/slug/rules/publish flags/UI column config). Deliberately excludes
// currentPlayerId, bidHistory and the view counters, which change constantly
// and must be read live from Postgres. Invalidated on auction edit / publish /
// status change.
// ---------------------------------------------------------------------------
export type CachedAuctionMeta = {
  id: string
  name: string
  slug: string | null
  description: string | null
  image: string | null
  rules: unknown
  isPublished: boolean
  registrationOpen: boolean
  customFields: unknown
  columnOrder: unknown
  visibleColumns: unknown
  analyticsVisibleColumns: unknown
  scheduledStartDate: Date | null
  createdById: string
}

const AUCTION_META_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  image: true,
  rules: true,
  isPublished: true,
  registrationOpen: true,
  customFields: true,
  columnOrder: true,
  visibleColumns: true,
  analyticsVisibleColumns: true,
  scheduledStartDate: true,
  createdById: true,
} as const

export async function getCachedAuctionMetaById(id: string): Promise<CachedAuctionMeta | null> {
  return cacheGetOrSet(keys.auctionMeta(id), TTL.auctionMeta, () =>
    prisma.auction.findUnique({ where: { id }, select: AUCTION_META_SELECT })
  )
}

// Slug lookups first resolve slug -> id (cached), then reuse the by-id cache,
// so the two entry points (id and slug) share one cached row instead of
// storing the auction twice under different keys.
export async function getCachedAuctionMetaBySlug(slug: string): Promise<CachedAuctionMeta | null> {
  const id = await cacheGetOrSet(keys.slugToId(slug), TTL.auctionMeta, async () => {
    const row = await prisma.auction.findUnique({ where: { slug }, select: { id: true } })
    return row?.id ?? null
  })
  if (!id) return null
  return getCachedAuctionMetaById(id)
}

export function invalidateAuctionMeta(id: string, slug?: string | null): Promise<void> {
  const toDelete = [keys.auctionMeta(id)]
  if (slug) toDelete.push(keys.slugToId(slug))
  return redisDel(...toDelete)
}

// Convenience for write routes that change several facets of one auction at
// once (e.g. a reset touches players, purses and status): clear everything
// cached for that auction in a single call. Pass the slug when known so the
// slug->id pointer is cleared too.
export function invalidateAuction(auctionId: string, slug?: string | null): Promise<void> {
  const toDelete = [
    keys.auctionMeta(auctionId),
    keys.bidders(auctionId),
    keys.playerStatuses(auctionId),
  ]
  if (slug) toDelete.push(keys.slugToId(slug))
  return redisDel(...toDelete)
}
