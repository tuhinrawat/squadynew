import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isCuid } from '@/lib/slug'
import { isLiveStatus } from '@/lib/auction-status'
import { parseBidHistory, filterBidHistoryForCurrentPlayer } from '@/lib/auction-view-data'
import { logEventAsync, describeError } from '@/lib/observability'

// Read-only "current truth" snapshot for viewers who aren't on a live Pusher
// connection - the polling fallback for the public auction view's
// non-presenter viewers (see usePusher's `enabled` flag). Deliberately public
// and unauthenticated, mirroring the same page's own access rule: only
// published auctions are servable this way, since this endpoint exists
// specifically to feed the anonymous public view.
//
// Cache-Control is what keeps this affordable at any polling frequency: many
// viewers polling the same auction within the same couple of seconds collapse
// into effectively one real database read, because Vercel's edge network
// serves the cached response to everyone else in that window.

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const start = Date.now()
  // Set once the auction is found, so a failure logged after that point still
  // carries which auction it happened on - a genuinely unattributable error
  // (e.g. the initial lookup itself throws) logs without one instead.
  let resolvedAuctionId: string | undefined
  try {
    const idOrSlug = params.id
    const isId = isCuid(idOrSlug)

    const auction = isId
      ? await prisma.auction.findUnique({
          where: { id: idOrSlug },
          select: { id: true, status: true, currentPlayerId: true, bidHistory: true, isPublished: true },
        })
      : await prisma.auction.findUnique({
          where: { slug: idOrSlug },
          select: { id: true, status: true, currentPlayerId: true, bidHistory: true, isPublished: true },
        })

    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }
    resolvedAuctionId = auction.id

    // Same access rule as the page itself: unpublished auctions aren't
    // servable to anonymous viewers, and this endpoint only exists to feed
    // the anonymous public view.
    if (!auction.isPublished) {
      return NextResponse.json({ error: 'Not available' }, { status: 403 })
    }

    // The public view only ever reads two things off the bulk player list:
    // status and isIcon (for the sold/unsold/remaining counts and the
    // Bidder Choice phase check) - never a name, photo, or stat. Only the
    // single player currently on stage needs its full uploaded data. Fetching
    // everyone's full data on every 6-second poll from every viewer was the
    // actual driver of this endpoint's payload size (confirmed via load
    // testing - a several-MB response per poll, independent of audience
    // size), not the audience size itself.
    const [players, bidders, currentPlayerFull, recentSoldPlayers] = await Promise.all([
      prisma.player.findMany({
        where: { auctionId: auction.id },
        select: { id: true, status: true, isIcon: true },
      }),
      // Team name/username/logo never change during a live auction and are
      // already on the client from the initial page load (confirmed via load
      // testing - team logos alone were 99%+ of this endpoint's payload).
      // Only the remaining purse actually needs to travel on every poll; the
      // client merges this into its existing bidder records instead of
      // replacing them - see applySnapshot in public-auction-view.tsx.
      prisma.bidder.findMany({
        where: { auctionId: auction.id },
        select: { id: true, remainingPurse: true },
      }),
      auction.currentPlayerId
        ? prisma.player.findUnique({
            where: { id: auction.currentPlayerId },
            select: {
              id: true, auctionId: true, data: true, status: true, isIcon: true, soldTo: true, soldPrice: true,
              lastYearPrice: true, lastYearTeamName: true, lastYearBidderName: true, lastYearAuctionName: true,
            },
          })
        : Promise.resolve(null),
      // Feeds the public view's sold ticker. Bounded to 10 rows regardless of
      // roster size, unlike the bulk `players` query above - fetching each
      // one's full `data` blob here is fine at this fixed, small count (same
      // order of magnitude as the single current-player fetch above), where
      // doing it for the whole roster on every poll was the actual cause of
      // a several-MB response. soldAt can be null for anything sold before
      // this field existed - excluded rather than guessing a sale time.
      prisma.player.findMany({
        where: { auctionId: auction.id, status: 'SOLD', soldAt: { not: null } },
        orderBy: { soldAt: 'desc' },
        take: 10,
        select: { id: true, data: true, soldTo: true, soldPrice: true },
      }),
    ])

    // Defensive, read-only mirror of the same check the SSR page makes: a
    // SOLD player should never be shown as "current" even if a stale
    // currentPlayerId briefly points at one.
    const currentPlayer = currentPlayerFull && currentPlayerFull.status !== 'SOLD' ? currentPlayerFull : null

    const poolExhausted = !currentPlayer
      && (isLiveStatus(auction.status) || auction.status === 'PAUSED')
      && !players.some(p => p.status === 'AVAILABLE')

    // The polling client only ever displays the current player's bids (it
    // applies this exact same filter itself before rendering) - filtering
    // here keeps this 2-second poll's payload from growing with the
    // auction's entire history instead of just the current lot.
    const bidHistory = filterBidHistoryForCurrentPlayer(parseBidHistory(auction.bidHistory), currentPlayer?.id)

    // Same name-extraction fallback keys the client already uses for every
    // other player display - kept server-side here since only the name is
    // needed, not the rest of the uploaded data blob.
    const extractPlayerName = (data: unknown): string => {
      const record = data as Record<string, unknown> | null | undefined
      return String(record?.name || record?.Name || record?.player_name || 'Unknown Player')
    }
    const buyerIds = [...new Set(recentSoldPlayers.map(p => p.soldTo).filter((id): id is string => !!id))]
    const buyers = buyerIds.length > 0
      ? await prisma.bidder.findMany({ where: { id: { in: buyerIds } }, select: { id: true, teamName: true, username: true } })
      : []
    const recentSales = recentSoldPlayers.map(p => {
      const buyer = buyers.find(b => b.id === p.soldTo)
      return {
        id: p.id,
        name: extractPlayerName(p.data),
        price: p.soldPrice ?? 0,
        buyer: buyer?.teamName || buyer?.username || 'Unknown',
      }
    })

    const body = {
      auctionId: auction.id,
      auctionStatus: auction.status,
      currentPlayer,
      players,
      bidders,
      bidHistory,
      poolExhausted,
      recentSales,
    }

    // The one signal that would have caught today's incident before a real
    // audience ever saw it: response size. NOT logged on every poll, though -
    // at 1000 viewers polling every 6s that's ~167 requests/sec, which would
    // write over a million rows to observability_events across a 2-hour
    // auction from this endpoint alone, trading the exact "load scales with
    // viewer count" problem this session fixed for a database-write version
    // of the same problem. A 10% sample is still hundreds of data points a
    // minute at real audience sizes - plenty to catch a size regression fast
    // (a systemic bloat, like an uncompressed logo, shows up in the very
    // next sampled poll, not eventually) without multiplying writes by
    // audience size the way the un-sampled response body already did once.
    if (Math.random() < 0.1) {
      logEventAsync({
        category: 'snapshot',
        eventName: 'poll',
        auctionId: auction.id,
        success: true,
        latencyMs: Date.now() - start,
        metadata: { responseBytes: Buffer.byteLength(JSON.stringify(body), 'utf8') },
      })
    }

    // max-age=0, must-revalidate: forces a visitor's own browser cache to
    // always check back in rather than silently reusing an old copy of this
    // URL - s-maxage/stale-while-revalidate below are the ones actually
    // meant to govern freshness, but they only speak to Vercel's shared
    // edge cache, not a private browser cache, which was previously left
    // free to cache this for far longer than intended (the incident this
    // fixes: viewers stuck on a stale bid/player even through a manual
    // refresh, because the refresh still consulted that same stale
    // browser-cached response instead of hitting the network at all).
    return NextResponse.json(body, {
      headers: { 'Cache-Control': 'public, max-age=0, must-revalidate, s-maxage=2, stale-while-revalidate=5' },
    })
  } catch (error) {
    console.error('Error building auction snapshot:', error)
    const { message, metadata } = describeError(error)
    logEventAsync({
      category: 'snapshot',
      eventName: 'poll',
      auctionId: resolvedAuctionId,
      success: false,
      latencyMs: Date.now() - start,
      message,
      metadata,
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
