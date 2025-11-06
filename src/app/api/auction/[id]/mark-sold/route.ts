import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { triggerAuctionEvent } from '@/lib/pusher'

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
    const { playerId } = body

    if (!playerId) {
      return NextResponse.json({ error: 'Player ID required' }, { status: 400 })
    }

    // Fetch auction
    const auction = await prisma.auction.findUnique({
      where: { id: params.id },
      include: {
        players: true,
        bidders: true
      }
    })

    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }

    // Fetch current player and bid history
    const currentPlayer = await prisma.player.findUnique({
      where: { id: playerId }
    })

    if (!currentPlayer || currentPlayer.auctionId !== params.id) {
      return NextResponse.json({ error: 'Invalid player' }, { status: 400 })
    }

    // Parse bid history to get current highest bid (filter for current player only)
    let bidHistory: any[] = []
    if (auction.bidHistory && typeof auction.bidHistory === 'object') {
      const bidHistoryData = auction.bidHistory as any
      if (Array.isArray(bidHistoryData)) {
        bidHistory = bidHistoryData
      }
    }

    // CRITICAL: Filter bid history to only include bids for the current player (strict)
    // This prevents using bids from other players or legacy untagged bids
    const currentPlayerBidHistory = bidHistory
      .filter(bid => bid.playerId === currentPlayer.id)
      .filter(bid => bid.type !== 'sold' && bid.type !== 'unsold')

    if (currentPlayerBidHistory.length === 0) {
      return NextResponse.json({ error: 'No bids on this player' }, { status: 400 })
    }

    // Get the highest bid for this specific player
    const highestBid = currentPlayerBidHistory[0]
    const winningBidderId = auction.bidders.find(b => b.id === highestBid.bidderId)?.id

    if (!winningBidderId) {
      return NextResponse.json({ error: 'Winning bidder not found' }, { status: 404 })
    }

    // Fetch winning bidder with user relation (fresh from database to ensure correct purse)
    const winningBidder = await prisma.bidder.findUnique({
      where: { id: winningBidderId },
      include: { user: true }
    })

    if (!winningBidder) {
      return NextResponse.json({ error: 'Winning bidder not found' }, { status: 404 })
    }

    // Check if bidder has sufficient remaining purse for the bid amount
    if (winningBidder.remainingPurse < highestBid.amount) {
      return NextResponse.json({
        error: `Insufficient funds. Bidder has ₹${winningBidder.remainingPurse.toLocaleString('en-IN')} remaining, but bid amount is ₹${highestBid.amount.toLocaleString('en-IN')}.`
      }, { status: 400 })
    }

    // Enforce purse and squad-size feasibility at sale time as a safety net
    const rules = auction.rules as any
    const mandatoryTeamSize = Number(rules?.mandatoryTeamSize) || null
    const maxTeamSize = rules?.maxTeamSize ? Number(rules.maxTeamSize) : null
    const minPerPlayerReserve = Number(rules?.minPerPlayerReserve) || Number(rules?.minBidIncrement) || 0

    // Count already-bought players
    const playersBoughtByBidder = await prisma.player.count({
      where: { auctionId: params.id, soldTo: winningBidder.id }
    })

    if (maxTeamSize && playersBoughtByBidder + 1 > maxTeamSize) {
      return NextResponse.json({
        error: `Team size limit reached (max ${maxTeamSize}). Cannot acquire more players.`
      }, { status: 400 })
    }

    if (mandatoryTeamSize) {
      const remainingSlotsAfterThis = Math.max(mandatoryTeamSize - (playersBoughtByBidder + 1), 0)
      const requiredReserve = remainingSlotsAfterThis * minPerPlayerReserve
      const remainingAfterBid = winningBidder.remainingPurse - highestBid.amount
      if (remainingAfterBid < requiredReserve) {
        return NextResponse.json({
          error: `Sale would leave insufficient purse to complete mandatory squad of ${mandatoryTeamSize}. Required reserve: ₹${requiredReserve.toLocaleString('en-IN')}, remaining after sale: ₹${Math.max(remainingAfterBid, 0).toLocaleString('en-IN')}.`
        }, { status: 400 })
      }
    }

    // Calculate new remaining purse
    const newRemainingPurse = winningBidder.remainingPurse - highestBid.amount

    // Broadcast player sold event IMMEDIATELY for instant real-time updates (before DB writes)
    const playerName = currentPlayer.data ? (currentPlayer.data as any).name || (currentPlayer.data as any).Name : 'Player'
    triggerAuctionEvent(params.id, 'player-sold', {
      playerId: currentPlayer.id,
      bidderId: winningBidder.id,
      amount: highestBid.amount,
      playerName: playerName,
      bidderName: winningBidder.user?.name || winningBidder.username,
      teamName: winningBidder.teamName,
      bidderRemainingPurse: newRemainingPurse,
      updatedBidders: [{ id: winningBidder.id, remainingPurse: newRemainingPurse }]
    } as any).catch(err => console.error('Pusher error (non-critical):', err))

    // Update player and bidder in parallel for better performance
    await Promise.all([
      prisma.player.update({
        where: { id: playerId },
        data: {
          status: 'SOLD',
          soldTo: winningBidder.id,
          soldPrice: highestBid.amount
        }
      }),
      // Deduct from bidder's remaining purse
      prisma.bidder.update({
        where: { id: winningBidder.id },
        data: {
          remainingPurse: newRemainingPurse
        }
      })
    ])

    // Get next available player
    const nextPlayer = await prisma.player.findFirst({
      where: {
        auctionId: params.id,
        status: 'AVAILABLE'
      },
      orderBy: {
        createdAt: 'asc'
      }
    })

    // Add sold event to bid history
    const soldEvent = {
      type: 'sold',
      playerId: currentPlayer.id,
      playerName: playerName,
      bidderId: winningBidder.id,
      bidderName: winningBidder.user?.name || winningBidder.username,
      teamName: winningBidder.teamName,
      amount: highestBid.amount,
      timestamp: new Date().toISOString()
    }
    
    // Add sold event to the full bid history (not just current player's history)
    const updatedHistory = [soldEvent, ...bidHistory]

    // Update auction
    await prisma.auction.update({
      where: { id: params.id },
      data: {
        currentPlayerId: nextPlayer?.id || null,
        bidHistory: updatedHistory as any
      }
    })

    // Broadcast new player if exists
    if (nextPlayer) {
      await triggerAuctionEvent(params.id, 'new-player', {
        player: nextPlayer
      } as any)

    // Reset timer
      const countdownSeconds = rules?.countdownSeconds || 30
      await triggerAuctionEvent(params.id, 'timer-update', {
        seconds: countdownSeconds
      } as any)
    }

    // Broadcast players updated event with data to avoid fetch (fire and forget)
    triggerAuctionEvent(params.id, 'players-updated', {
      players: [{
        ...currentPlayer,
        status: 'SOLD',
        soldTo: winningBidder.id,
        soldPrice: highestBid.amount
      }],
      bidders: [{ id: winningBidder.id, remainingPurse: newRemainingPurse }]
    } as any).catch(err => console.error('Pusher error (non-critical):', err))

    return NextResponse.json({ 
      success: true,
      nextPlayer,
      updatedBidder: {
        ...winningBidder,
        remainingPurse: winningBidder.remainingPurse - highestBid.amount
      }
    })
  } catch (error) {
    console.error('Error marking player as sold:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

