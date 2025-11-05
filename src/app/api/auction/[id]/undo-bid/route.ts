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
    const undoneBid = bidHistory.shift()
    const bidAmount = undoneBid?.amount || 0

    // Get previous bid (if exists)
    const previousBid = bidHistory.length > 0 ? bidHistory[0] : null

    // Fetch bidder to restore purse
    const bidder = await prisma.bidder.findUnique({
      where: { id: bidderId },
      select: { id: true, remainingPurse: true }
    })

    if (!bidder) {
      return NextResponse.json({ error: 'Bidder not found' }, { status: 404 })
    }

    // Restore purse (add back the bid amount)
    const restoredPurse = bidder.remainingPurse + bidAmount

    // Update auction and bidder in parallel for better performance
    await Promise.all([
      prisma.auction.update({
        where: { id: params.id },
        data: {
          bidHistory: bidHistory as any
        }
      }),
      prisma.bidder.update({
        where: { id: bidderId },
        data: {
          remainingPurse: restoredPurse
        }
      })
    ])

    // Reset timer (non-blocking)
    const rules = auction.rules as any
    const countdownSeconds = rules?.countdownSeconds || 30
    resetTimer(params.id, countdownSeconds)

    // Broadcast bid undo event with purse update (fire and forget for speed)
    triggerAuctionEvent(params.id, 'bid-undo', {
      bidderId,
      previousBid: previousBid?.amount || null,
      currentBid: previousBid || null,
      remainingPurse: restoredPurse // Include for instant UI update
    } as any).catch(err => console.error('Pusher error (non-critical):', err))

    return NextResponse.json({ 
      success: true, 
      currentBid: previousBid || null
    })
  } catch (error) {
    console.error('Error undoing bid:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

