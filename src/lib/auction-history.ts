import { prisma } from '@/lib/prisma'
import { extractCricheroesLink, normalizeCricheroesLink } from '@/lib/cricheroes'

interface LastYearMatch {
  price: number
  teamName: string | null
  bidderName: string
  auctionName: string
}

// Recomputes every player's lastYear* snapshot fields for `auctionId` from
// its currently linked previous auctions (see AuctionLink). Call this any
// time the set of linked auctions changes - it's a full recompute, not an
// incremental patch, since a completed auction's data doesn't change once
// linked and re-deriving everything from scratch is simpler than tracking
// what changed.
//
// Matching is Cricheroes-link only, by design: a player with no link on
// either side just gets no match, rather than risking a false match on a
// common name.
export async function computeLastYearMatches(
  auctionId: string,
  linkedAuctionIds: string[]
): Promise<{ matchedCount: number; totalPlayers: number }> {
  const currentPlayers = await prisma.player.findMany({
    where: { auctionId },
    select: { id: true, data: true },
  })

  if (linkedAuctionIds.length === 0) {
    // No linked auctions (or all links just removed) - clear any stale
    // snapshot data rather than leaving last year's numbers on screen for
    // an auction that's no longer actually linked to anything.
    await prisma.player.updateMany({
      where: { auctionId },
      data: {
        lastYearPrice: null,
        lastYearTeamName: null,
        lastYearBidderName: null,
        lastYearAuctionName: null,
      },
    })
    return { matchedCount: 0, totalPlayers: currentPlayers.length }
  }

  const linkedAuctions = await prisma.auction.findMany({
    where: { id: { in: linkedAuctionIds } },
    select: {
      id: true,
      name: true,
      scheduledStartDate: true,
      createdAt: true,
      players: {
        where: { status: 'SOLD' },
        select: { data: true, soldTo: true, soldPrice: true },
      },
      bidders: {
        select: { id: true, teamName: true, username: true, user: { select: { name: true } } },
      },
    },
  })

  // Most recent auction first, so a player who appears in multiple linked
  // years resolves to the latest one - matches the "Last Year Price" label,
  // not a full multi-year history.
  const orderedAuctions = [...linkedAuctions].sort((a, b) => {
    const aTime = (a.scheduledStartDate ?? a.createdAt).getTime()
    const bTime = (b.scheduledStartDate ?? b.createdAt).getTime()
    return bTime - aTime
  })

  const auctionLookups = orderedAuctions.map(auction => {
    const biddersById = new Map(auction.bidders.map(b => [b.id, b]))
    const lookup = new Map<string, LastYearMatch>()
    for (const player of auction.players) {
      const link = normalizeCricheroesLink(extractCricheroesLink(player.data as Record<string, unknown>))
      if (!link || player.soldPrice == null || !player.soldTo) continue
      const bidder = biddersById.get(player.soldTo)
      if (!bidder) continue
      // First (most recently sold, given the players array's natural order)
      // wins on a duplicate link within one auction - shouldn't happen, but
      // stay defensive rather than overwrite silently.
      if (!lookup.has(link)) {
        lookup.set(link, {
          price: player.soldPrice,
          teamName: bidder.teamName,
          bidderName: bidder.user?.name || bidder.username,
          auctionName: auction.name,
        })
      }
    }
    return lookup
  })

  let matchedCount = 0
  const updates = currentPlayers.map(player => {
    const link = normalizeCricheroesLink(extractCricheroesLink(player.data as Record<string, unknown>))
    let match: LastYearMatch | undefined
    if (link) {
      for (const lookup of auctionLookups) {
        const found = lookup.get(link)
        if (found) {
          match = found
          break
        }
      }
    }
    if (match) matchedCount++

    return prisma.player.update({
      where: { id: player.id },
      data: {
        lastYearPrice: match?.price ?? null,
        lastYearTeamName: match?.teamName ?? null,
        lastYearBidderName: match?.bidderName ?? null,
        lastYearAuctionName: match?.auctionName ?? null,
      },
    })
  })

  // A player-by-player batch, not a single UPDATE - each player can match a
  // different linked auction/price. Plain Promise.all rather than
  // $transaction: Prisma Accelerate's extension typings don't support a
  // timeout on the array form (a known limitation elsewhere in this
  // codebase), and strict atomicity isn't needed here - a partial failure
  // just means re-running the link action fixes it.
  await Promise.all(updates)

  return { matchedCount, totalPlayers: currentPlayers.length }
}
