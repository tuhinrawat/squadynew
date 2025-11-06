import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'
import { triggerAuctionEvent } from '@/lib/pusher'
import { resetTimer } from '@/lib/auction-timer'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { bidderId } = body

    if (!bidderId) {
      return NextResponse.json({ error: 'Missing bidderId' }, { status: 400 })
    }

    // Fetch auction
    const auction = await prisma.auction.findUnique({
      where: { id: params.id }
    })

    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }

    if (auction.status !== 'LIVE') {
      return NextResponse.json({ error: 'Auction is not live' }, { status: 400 })
    }

    // Parse and filter bid history to current player context only
    let fullHistory: any[] = []
    if (auction.bidHistory && typeof auction.bidHistory === 'object') {
      const bidHistoryData = auction.bidHistory as any
      if (Array.isArray(bidHistoryData)) {
        fullHistory = bidHistoryData
      }
    }

    // Determine current player
    const currentPlayer = auction.currentPlayerId
      ? await prisma.player.findUnique({ where: { id: auction.currentPlayerId }, select: { id: true } })
      : null

    // Filter to only bids for current player (strict)
    const filteredHistory = currentPlayer?.id
      ? fullHistory.filter(b => (b.playerId === currentPlayer.id) && b.type !== 'sold' && b.type !== 'unsold')
      : []

    if (filteredHistory.length === 0) {
      return NextResponse.json({ error: 'No bids to undo for current player' }, { status: 400 })
    }

    // Validate that last bid for current player is from this bidder
    const lastBid = filteredHistory[0]
    if (lastBid.bidderId !== bidderId) {
      return NextResponse.json({ error: 'You are not the last bidder for this player' }, { status: 400 })
    }

    // Remove last bid only from the overall history (not just filtered array)
    const indexInFull = fullHistory.findIndex(b => b === lastBid)
    if (indexInFull === -1) {
      return NextResponse.json({ error: 'Bid not found in history' }, { status: 400 })
    }
    const [undoneBid] = fullHistory.splice(indexInFull, 1)

    // Determine previous bid for current player (strict)
    const previousBid = fullHistory.find(b => (currentPlayer && b.playerId === currentPlayer.id) && b.type !== 'sold' && b.type !== 'unsold') || null

    // Reset timer (non-blocking)
    const rules = auction.rules as any
    const countdownSeconds = rules?.countdownSeconds || 30
    resetTimer(params.id, countdownSeconds)

    // Broadcast bid undo event BEFORE DB update for instant real-time updates
    const undoEventData = {
      bidderId,
      currentBid: previousBid ? {
        bidderId: previousBid.bidderId,
        amount: previousBid.amount,
        bidderName: previousBid.bidderName,
        teamName: previousBid.teamName
      } : null,
      countdownSeconds
    }
    console.log('📤 Backend sending bid-undo event:', undoEventData)
    triggerAuctionEvent(params.id, 'bid-undo', undoEventData as any).catch(err => console.error('Pusher error (non-critical):', err))

    // Persist updated history; do NOT mutate purse on undo-bid (purse is adjusted on sale only)
    await prisma.auction.update({
      where: { id: params.id },
      data: {
        bidHistory: fullHistory as any
      }
    })

    return NextResponse.json({ 
      success: true, 
      currentBid: previousBid || null
    })
  } catch (error) {
    console.error('Error undoing bid:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

