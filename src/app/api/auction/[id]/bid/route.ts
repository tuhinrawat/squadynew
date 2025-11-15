import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { triggerAuctionEvent } from '@/lib/pusher'
import { resetTimer } from '@/lib/auction-timer'

// Helper function to broadcast bid error and return error response
function broadcastBidError(auctionId: string, errorMessage: string, bidderName?: string, bidderId?: string) {
  // Broadcast error via Pusher (non-blocking)
  triggerAuctionEvent(auctionId, 'bid-error', {
    message: errorMessage,
    bidderName,
    bidderId
  } as any).catch(err => console.error('Failed to broadcast bid error:', err))
  
  return NextResponse.json({ error: errorMessage }, { status: 400 })
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session) {
      return NextResponse.json({ error: 'Please log in to place a bid' }, { status: 401 })
    }

    const body = await request.json()
    const { bidderId, amount } = body

    if (!bidderId || !amount) {
      return NextResponse.json({ error: 'Invalid bid data' }, { status: 400 })
    }

    // Validate bid amount is a multiple of 1000
    if (amount % 1000 !== 0) {
      return NextResponse.json({ 
        error: 'Bid must be in multiples of ₹1K' 
      }, { status: 400 })
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

    const { isLiveStatus } = await import('@/lib/auction-status')
    if (!isLiveStatus(auction.status)) {
      return NextResponse.json({ error: 'Auction is not active' }, { status: 400 })
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
          auctionId: true, // Include auctionId for validation
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
      return NextResponse.json({ error: 'Player not available for bidding' }, { status: 400 })
    }

    if (!bidder) {
      return NextResponse.json({ error: 'Bidder not found' }, { status: 404 })
    }

    // Security: Ensure bidder belongs to this auction
    if (bidder.auctionId !== params.id) {
      return NextResponse.json({ 
        error: 'Bidder does not belong to this auction' 
      }, { status: 403 })
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

    // Filter bids for the CURRENT player only (strict). Exclude sold/unsold/bid-undo entries.
    const currentPlayerBidHistory = currentPlayer?.id 
      ? bidHistory.filter(bid => 
          bid.playerId === currentPlayer.id && 
          bid.type !== 'sold' && 
          bid.type !== 'unsold' && 
          bid.type !== 'bid-undo'
        )
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
    const baseIncrement = Number(rules?.minBidIncrement) || 1000
    // Always use base increment (1000)
    const minIncrement = baseIncrement
    const mandatoryTeamSize = Number(rules?.mandatoryTeamSize) || null
    // Use maxTeamSize if set, otherwise fall back to mandatoryTeamSize (for existing auctions)
    const maxTeamSize = rules?.maxTeamSize ? Number(rules.maxTeamSize) : (rules?.mandatoryTeamSize ? Number(rules.mandatoryTeamSize) : null)
    // Auction purchases exclude the bidder (team size includes captain/bidder)
    const targetAuctionPlayers = mandatoryTeamSize ? Math.max(mandatoryTeamSize - 1, 0) : null
    const maxAuctionPlayers = maxTeamSize ? Math.max(maxTeamSize - 1, 0) : null
    const minPerPlayerReserve = Number(rules?.minPerPlayerReserve) || baseIncrement
    
    logger.log('Bid validation', { 
      currentBid, 
      minIncrement, 
      amount, 
      required: currentBid + minIncrement,
      check: amount <= currentBid + minIncrement - 1
    })

    if (amount <= currentBid + minIncrement - 1) {
      return broadcastBidError(
        params.id,
        `Minimum bid: ₹${(currentBid + minIncrement).toLocaleString('en-IN')}`,
        bidder.user?.name || bidder.username,
        bidder.id
      )
    }

    if (amount > bidder.remainingPurse) {
      return broadcastBidError(
        params.id,
        'Insufficient purse balance',
        bidder.user?.name || bidder.username,
        bidder.id
      )
    }

    // CRITICAL: Check team size limit FIRST, before any other validations
    // This prevents teams from bidding when they've reached max team size
    if (maxTeamSize !== null) {
      const playersBoughtByBidder = await prisma.player.count({
        where: { 
          auctionId: params.id, 
          soldTo: bidder.id,
          status: 'SOLD' // Add status filter for faster query
        }
      })
      
      // Team size includes the bidder, so if they've bought (maxTeamSize - 1) players,
      // their team is full. Check BEFORE allowing the bid.
      if (playersBoughtByBidder >= maxTeamSize - 1) {
        return broadcastBidError(
          params.id,
          `Team is full (max ${maxTeamSize} players including you). Cannot bid on more players.`,
          bidder.user?.name || bidder.username,
          bidder.id
        )
      }
    }

    // Enforce roster-size financial feasibility: ensure enough purse remains
    // to reach mandatoryTeamSize with at least minPerPlayerReserve per remaining slot
    // OPTIMIZED: Only check if mandatoryTeamSize is set (skip if null)
    if (targetAuctionPlayers !== null) {
      // OPTIMIZED: Count players in parallel with other operations if possible
      // For now, keep sequential but use indexed query
      const playersBoughtByBidder = await prisma.player.count({
        where: { 
          auctionId: params.id, 
          soldTo: bidder.id,
          status: 'SOLD' // Add status filter for faster query
        }
      })

      const remainingSlotsAfterThis = Math.max(targetAuctionPlayers - (playersBoughtByBidder + 1), 0)
      
      // If no remaining slots needed, allow bidding all remaining money
      if (remainingSlotsAfterThis === 0) {
        // Allow bidding all remaining purse - no reserve needed
      } else {
        // Calculate required reserve for remaining slots
        const requiredReserve = remainingSlotsAfterThis * minPerPlayerReserve
        const remainingAfterBid = bidder.remainingPurse - amount
        
        // Allow bidding if remaining after bid is exactly 0 AND only one slot left
        // (meaning they can bid all money on this player, then have 0 for the last slot)
        const canBidAllMoney = remainingSlotsAfterThis === 1 && remainingAfterBid === 0
        
        if (!canBidAllMoney && remainingAfterBid < requiredReserve) {
          const bidderName = bidder.user?.name || bidder.username
          const teamName = bidder.teamName || 'No Team'
          return broadcastBidError(
            params.id,
            `${bidderName} (${teamName}): This bid would leave insufficient purse to complete the mandatory squad of ${mandatoryTeamSize}. Required reserve: ₹${requiredReserve.toLocaleString('en-IN')}, remaining after bid: ₹${Math.max(remainingAfterBid, 0).toLocaleString('en-IN')}.`,
            bidder.user?.name || bidder.username,
            bidder.id
          )
        }
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
      return broadcastBidError(
        params.id,
        'You are already the highest bidder',
        bidder.user?.name || bidder.username,
        bidder.id
      )
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

    // Calculate new remaining purse (optimistic - will be confirmed by DB)
    const newRemainingPurse = bidder.remainingPurse - amount

    // Reset timer (non-blocking)
    const countdownSeconds = rules?.countdownSeconds || 30
    resetTimer(params.id, countdownSeconds)

    // Broadcast new bid event IMMEDIATELY (before DB write) for instant real-time updates
    // Fire-and-forget: clients get the update while DB write happens in parallel
    triggerAuctionEvent(params.id, 'new-bid', {
      bidderId,
      amount,
      timestamp: new Date().toISOString(),
      bidderName: bidder.user.name,
      teamName: bidder.teamName,
      countdownSeconds
    } as any).catch(err => console.error('Pusher error (non-critical):', err))

    // Persist bid history; do NOT mutate purse here. Purse is deducted on sale.
    await prisma.auction.update({
      where: { id: params.id },
      data: {
        bidHistory: bidHistory as any
      }
    })

    return NextResponse.json({ 
      success: true, 
      bid: newBid,
      // Purse is unchanged at bid time
    })
  } catch (error) {
    logger.error('Error placing bid:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

