import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
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
      select: {
        id: true,
        status: true,
        currentPlayerId: true,
        rules: true,
        bidHistory: true,
      }
    })

    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }

    if (auction.status !== 'LIVE') {
      return NextResponse.json({ error: 'Auction is not live' }, { status: 400 })
    }

    // Fetch current player and bidder in parallel for better performance
    const [currentPlayer, bidder] = await Promise.all([
      auction.currentPlayerId
        ? prisma.player.findUnique({
            where: { id: auction.currentPlayerId },
            select: {
              id: true,
              status: true,
              data: true
            }
          })
        : null,
      prisma.bidder.findUnique({
        where: { id: bidderId },
        select: {
          id: true,
          userId: true,
          username: true,
          teamName: true,
          remainingPurse: true,
          user: {
            select: {
              id: true,
              name: true
            }
          }
        }
      })
    ])

    if (!currentPlayer || currentPlayer.status !== 'AVAILABLE') {
      return NextResponse.json({ error: 'Player is not available' }, { status: 400 })
    }

    if (!bidder) {
      return NextResponse.json({ error: 'Bidder not found' }, { status: 404 })
    }

    // Parse current bid from bid history - only for CURRENT player
    let currentBid = 0
    let bidHistory: any[] = []
    if (auction.bidHistory && typeof auction.bidHistory === 'object') {
      const bidHistoryData = auction.bidHistory as any
      if (Array.isArray(bidHistoryData)) {
        bidHistory = bidHistoryData
      }
    }

    // Filter bids for current player only
    // Include bids without playerId (legacy bids) as they belong to the current player being auctioned
    const currentPlayerBidHistory = currentPlayer?.id 
      ? bidHistory.filter(bid => !bid.playerId || bid.playerId === currentPlayer.id)
      : []
  
    logger.log('Filtering bids for current player', {
      currentPlayerId: currentPlayer?.id,
      totalBidHistoryLength: bidHistory.length,
      filteredLength: currentPlayerBidHistory.length,
      latestBid: currentPlayerBidHistory[0]
    })

    if (currentPlayerBidHistory.length > 0) {
      const lastBid = currentPlayerBidHistory[0]
      currentBid = lastBid.amount || 0
    }

    // Validate bid amount and roster constraints
    const rules = auction.rules as any
    const minIncrement = rules?.minBidIncrement || 1000
    const mandatoryTeamSize = Number(rules?.mandatoryTeamSize) || null
    const maxTeamSize = rules?.maxTeamSize ? Number(rules.maxTeamSize) : null
    const minPerPlayerReserve = Number(rules?.minPerPlayerReserve) || Number(minIncrement) || 0
    
    logger.log('Bid validation', { 
      currentBid, 
      minIncrement, 
      amount, 
      required: currentBid + minIncrement,
      check: amount <= currentBid + minIncrement - 1
    })

    if (amount <= currentBid + minIncrement - 1) {
      return NextResponse.json({ 
        error: `Bid must be at least ₹${(currentBid + minIncrement).toLocaleString('en-IN')} (₹${minIncrement.toLocaleString('en-IN')} more than current bid)` 
      }, { status: 400 })
    }

    if (amount > bidder.remainingPurse) {
      return NextResponse.json({ 
        error: 'Insufficient remaining purse' 
      }, { status: 400 })
    }

    // Enforce roster-size financial feasibility: ensure enough purse remains
    // to reach mandatoryTeamSize with at least minPerPlayerReserve per remaining slot
    if (mandatoryTeamSize) {
      // Count players already bought by this bidder in this auction
      const playersBoughtByBidder = await prisma.player.count({
        where: { auctionId: params.id, soldTo: bidder.id }
      })

      // If maxTeamSize is set, prevent bidding that would exceed it after winning
      if (maxTeamSize && playersBoughtByBidder + 1 > maxTeamSize) {
        return NextResponse.json({
          error: `Team size limit reached (max ${maxTeamSize}). Cannot acquire more players.`
        }, { status: 400 })
      }

      const remainingSlotsAfterThis = Math.max(mandatoryTeamSize - (playersBoughtByBidder + 1), 0)
      const requiredReserve = remainingSlotsAfterThis * minPerPlayerReserve
      const remainingAfterBid = bidder.remainingPurse - amount
      if (remainingAfterBid < requiredReserve) {
        return NextResponse.json({
          error: `This bid would leave insufficient purse to complete the mandatory squad of ${mandatoryTeamSize}. Required reserve: ₹${requiredReserve.toLocaleString('en-IN')}, remaining after bid: ₹${Math.max(remainingAfterBid, 0).toLocaleString('en-IN')}.`
        }, { status: 400 })
      }
    }

    // Check if this bidder is already the highest bidder (for current player only)
    logger.log('Checking if already highest bidder', {
      currentPlayerBidHistoryLength: currentPlayerBidHistory.length,
      latestBidId: currentPlayerBidHistory[0]?.bidderId,
      biddingBidderId: bidderId,
      latestBid: currentPlayerBidHistory[0]
    })
    
    if (currentPlayerBidHistory.length > 0 && currentPlayerBidHistory[0].bidderId === bidderId) {
      return NextResponse.json({ 
        error: 'You are already the highest bidder' 
      }, { status: 400 })
    }

    // Calculate the actual bid amount (not cumulative, just store the total bid)
    // The 'amount' parameter is the TOTAL bid amount for the current player
    const actualBidAmount = amount

    // Create new bid entry with player ID to track which player this bid is for
    logger.log('Creating new bid entry', {
      currentPlayerId: currentPlayer?.id,
      currentPlayerName: currentPlayer?.data
    })
    
    const newBid = {
      bidderId,
      amount: actualBidAmount,
      timestamp: new Date().toISOString(),
      bidderName: bidder.user.name,
      teamName: bidder.teamName,
      bidderUsername: bidder.username,
      playerId: currentPlayer?.id // Associate bid with current player
    }
    
    logger.log('New bid created with playerId', newBid.playerId)

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
    logger.error('Error placing bid:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

