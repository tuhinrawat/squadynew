import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isCuid } from '@/lib/slug'
import { isLiveStatus } from '@/lib/auction-status'
import { parseBidHistory, filterBidHistoryForCurrentPlayer } from '@/lib/auction-view-data'

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

    // Same access rule as the page itself: unpublished auctions aren't
    // servable to anonymous viewers, and this endpoint only exists to feed
    // the anonymous public view.
    if (!auction.isPublished) {
      return NextResponse.json({ error: 'Not available' }, { status: 403 })
    }

    const [players, bidders] = await Promise.all([
      prisma.player.findMany({
        where: { auctionId: auction.id },
        select: {
          id: true, auctionId: true, data: true, status: true, isIcon: true, soldTo: true, soldPrice: true,
          lastYearPrice: true, lastYearTeamName: true, lastYearBidderName: true, lastYearAuctionName: true,
        },
      }),
      prisma.bidder.findMany({
        where: { auctionId: auction.id },
        select: { id: true, teamName: true, username: true, remainingPurse: true, logoUrl: true },
      }),
    ])

    let currentPlayer = auction.currentPlayerId
      ? players.find(p => p.id === auction.currentPlayerId) ?? null
      : null
    // Defensive, read-only mirror of the same check the SSR page makes: a
    // SOLD player should never be shown as "current" even if a stale
    // currentPlayerId briefly points at one.
    if (currentPlayer && currentPlayer.status === 'SOLD') {
      currentPlayer = null
    }

    const poolExhausted = !currentPlayer
      && (isLiveStatus(auction.status) || auction.status === 'PAUSED')
      && !players.some(p => p.status === 'AVAILABLE')

    // The polling client only ever displays the current player's bids (it
    // applies this exact same filter itself before rendering) - filtering
    // here keeps this 2-second poll's payload from growing with the
    // auction's entire history instead of just the current lot.
    const bidHistory = filterBidHistoryForCurrentPlayer(parseBidHistory(auction.bidHistory), currentPlayer?.id)

    return NextResponse.json(
      {
        auctionId: auction.id,
        auctionStatus: auction.status,
        currentPlayer,
        players,
        bidders,
        bidHistory,
        poolExhausted,
      },
      { headers: { 'Cache-Control': 'public, s-maxage=2, stale-while-revalidate=5' } }
    )
  } catch (error) {
    console.error('Error building auction snapshot:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
