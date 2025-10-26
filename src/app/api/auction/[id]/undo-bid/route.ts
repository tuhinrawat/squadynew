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

    // Parse bid history
    let bidHistory: any[] = []
    if (auction.bidHistory && typeof auction.bidHistory === 'object') {
      const bidHistoryData = auction.bidHistory as any
      if (Array.isArray(bidHistoryData)) {
        bidHistory = bidHistoryData
      }
    }

    if (bidHistory.length === 0) {
      return NextResponse.json({ error: 'No bids to undo' }, { status: 400 })
    }

    // Validate that last bid is from this bidder
    const lastBid = bidHistory[0]
    if (lastBid.bidderId !== bidderId) {
      return NextResponse.json({ error: 'You are not the last bidder' }, { status: 400 })
    }

    // Remove last bid
    bidHistory.shift()

    // Get previous bid (if exists)
    const previousBid = bidHistory.length > 0 ? bidHistory[0] : null

    // Update auction
    await prisma.auction.update({
      where: { id: params.id },
      data: {
        bidHistory: bidHistory as any
      }
    })

    // Reset timer
    const rules = auction.rules as any
    const countdownSeconds = rules?.countdownSeconds || 30
    resetTimer(params.id, countdownSeconds)

    // Broadcast bid undo event
    await triggerAuctionEvent(params.id, 'bid-undo', {
      bidderId,
      previousBid: previousBid?.amount || null,
      currentBid: previousBid || null
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

