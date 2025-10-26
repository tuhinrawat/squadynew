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
    const { bidderId, amount } = body

    if (!bidderId || !amount) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Fetch auction with current state
    const auction = await prisma.auction.findUnique({
      where: { id: params.id },
      include: {
        bidders: { 
          where: { id: bidderId }, 
          include: { user: true } 
        }
      }
    })

    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }

    if (auction.status !== 'LIVE') {
      return NextResponse.json({ error: 'Auction is not live' }, { status: 400 })
    }

    // Fetch current player
    const currentPlayer = auction.currentPlayerId
      ? await prisma.player.findUnique({
          where: { id: auction.currentPlayerId }
        })
      : null

    if (!currentPlayer || currentPlayer.status !== 'AVAILABLE') {
      return NextResponse.json({ error: 'Player is not available' }, { status: 400 })
    }

    const bidder = auction.bidders[0]
    if (!bidder) {
      return NextResponse.json({ error: 'Bidder not found' }, { status: 404 })
    }

    // Parse current bid from bid history
    let currentBid = 0
    let bidHistory: any[] = []
    if (auction.bidHistory && typeof auction.bidHistory === 'object') {
      const bidHistoryData = auction.bidHistory as any
      if (Array.isArray(bidHistoryData)) {
        bidHistory = bidHistoryData
      }
    }

    if (bidHistory.length > 0) {
      const lastBid = bidHistory[0]
      currentBid = lastBid.amount || 0
    }

    // Validate bid amount
    const rules = auction.rules as any
    const minIncrement = rules?.minBidIncrement || 50000

    if (amount < currentBid + minIncrement) {
      return NextResponse.json({ 
        error: `Bid must be at least ₹${(currentBid + minIncrement).toLocaleString('en-IN')}` 
      }, { status: 400 })
    }

    if (amount > bidder.remainingPurse) {
      return NextResponse.json({ 
        error: 'Insufficient remaining purse' 
      }, { status: 400 })
    }

    // Check if this bidder is already the highest bidder
    if (bidHistory.length > 0 && bidHistory[0].bidderId === bidderId) {
      return NextResponse.json({ 
        error: 'You are already the highest bidder' 
      }, { status: 400 })
    }

    // Create new bid entry
    const newBid = {
      bidderId,
      amount,
      timestamp: new Date().toISOString(),
      bidderName: bidder.user.name,
      teamName: bidder.teamName,
      bidderUsername: bidder.username
    }

    bidHistory.unshift(newBid)

    // Update auction with new bid
    await prisma.auction.update({
      where: { id: params.id },
      data: {
        bidHistory: bidHistory as any
      }
    })

    // Reset timer
    const countdownSeconds = rules?.countdownSeconds || 30
    resetTimer(params.id, countdownSeconds)

    // Broadcast new bid event
    await triggerAuctionEvent(params.id, 'new-bid', {
      bidderId,
      amount,
      timestamp: new Date().toISOString(),
      bidderName: bidder.user.name,
      teamName: bidder.teamName,
      countdownSeconds
    } as any)

    return NextResponse.json({ success: true, bid: newBid })
  } catch (error) {
    console.error('Error placing bid:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

