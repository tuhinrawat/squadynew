import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { extractCricheroesLink, normalizeCricheroesLink } from '@/lib/cricheroes'
import { extractPlayerName, normalizeName } from '@/lib/player-name'

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
// Matching tries a Cricheroes link first, then falls back to a normalized
// full-name match (link OR name - either is enough). The link-first order
// isn't just a preference: different years' sheets have used genuinely
// incompatible link formats (a direct cricheroes.com/player-profile/<id>
// link one year, an opaque chshare.link/player/<code> short-link the next),
// so for many rosters a link match is simply never available and name is
// the only path to a match at all. Within one linked auction, a name that
// belongs to more than one player is treated as ambiguous and excluded
// from the name lookup entirely - guessing between two different people
// who share a name is worse than leaving both unmatched, especially since
// the Manage Players page lets an admin fix any wrong or missing match by
// hand afterward via the editable Last Year Price column.
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

  // AMBIGUOUS marks a name lookup entry that collided with a second player
  // in the same auction - excluded from matching rather than picking one
  // of two same-named players arbitrarily.
  const AMBIGUOUS = Symbol('ambiguous')

  const auctionLookups = orderedAuctions.map(auction => {
    const biddersById = new Map(auction.bidders.map(b => [b.id, b]))
    const linkLookup = new Map<string, LastYearMatch>()
    const nameLookup = new Map<string, LastYearMatch | typeof AMBIGUOUS>()
    for (const player of auction.players) {
      if (player.soldPrice == null || !player.soldTo) continue
      const bidder = biddersById.get(player.soldTo)
      if (!bidder) continue
      const playerData = player.data as Record<string, unknown>
      const match: LastYearMatch = {
        price: player.soldPrice,
        teamName: bidder.teamName,
        bidderName: bidder.user?.name || bidder.username,
        auctionName: auction.name,
      }

      const link = normalizeCricheroesLink(extractCricheroesLink(playerData))
      // First (most recently sold, given the players array's natural order)
      // wins on a duplicate link within one auction - shouldn't happen, but
      // stay defensive rather than overwrite silently.
      if (link && !linkLookup.has(link)) {
        linkLookup.set(link, match)
      }

      const name = normalizeName(extractPlayerName(playerData))
      if (name) {
        nameLookup.set(name, nameLookup.has(name) ? AMBIGUOUS : match)
      }
    }
    return { linkLookup, nameLookup }
  })

  let matchedCount = 0
  const rows = currentPlayers.map(player => {
    const playerData = player.data as Record<string, unknown>
    const link = normalizeCricheroesLink(extractCricheroesLink(playerData))
    let match: LastYearMatch | undefined

    if (link) {
      for (const { linkLookup } of auctionLookups) {
        const found = linkLookup.get(link)
        if (found) {
          match = found
          break
        }
      }
    }

    // Falls back to a name match only when no link match was found - link
    // is the more certain signal when both are available.
    if (!match) {
      const name = normalizeName(extractPlayerName(playerData))
      if (name) {
        for (const { nameLookup } of auctionLookups) {
          const found = nameLookup.get(name)
          if (found && found !== AMBIGUOUS) {
            match = found
            break
          }
        }
      }
    }

    if (match) matchedCount++

    return Prisma.sql`(${player.id}::text, ${match?.price ?? null}::double precision, ${match?.teamName ?? null}::text, ${match?.bidderName ?? null}::text, ${match?.auctionName ?? null}::text)`
  })

  // A single batched UPDATE...FROM(VALUES...) instead of one
  // prisma.player.update per player - each player can match a different
  // linked auction/price, so this can't collapse into one WHERE-scoped
  // updateMany, but it can still be one round-trip to Postgres instead of
  // one per player (which meant 1000+ round-trips for a large roster).
  if (rows.length > 0) {
    await prisma.$executeRaw`
      UPDATE players AS p
      SET "lastYearPrice" = v.price,
          "lastYearTeamName" = v.team_name,
          "lastYearBidderName" = v.bidder_name,
          "lastYearAuctionName" = v.auction_name
      FROM (VALUES ${Prisma.join(rows)}) AS v(id, price, team_name, bidder_name, auction_name)
      WHERE p.id = v.id
    `
  }

  return { matchedCount, totalPlayers: currentPlayers.length }
}
