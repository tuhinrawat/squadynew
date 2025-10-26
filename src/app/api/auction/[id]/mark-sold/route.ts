import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'
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

    // Parse bid history to get current highest bid
    let bidHistory: any[] = []
    if (auction.bidHistory && typeof auction.bidHistory === 'object') {
      const bidHistoryData = auction.bidHistory as any
      if (Array.isArray(bidHistoryData)) {
        bidHistory = bidHistoryData
      }
    }

    if (bidHistory.length === 0) {
      return NextResponse.json({ error: 'No bids on this player' }, { status: 400 })
    }

    const highestBid = bidHistory[0]
    const winningBidderId = auction.bidders.find(b => b.id === highestBid.bidderId)?.id

    if (!winningBidderId) {
      return NextResponse.json({ error: 'Winning bidder not found' }, { status: 404 })
    }

    // Fetch winning bidder with user relation
    const winningBidder = await prisma.bidder.findUnique({
      where: { id: winningBidderId },
      include: { user: true }
    })

    if (!winningBidder) {
      return NextResponse.json({ error: 'Winning bidder not found' }, { status: 404 })
    }

    // Mark player as sold
    await prisma.player.update({
      where: { id: playerId },
      data: {
        status: 'SOLD',
        soldTo: winningBidder.id,
        soldPrice: highestBid.amount
      }
    })

    // Deduct from bidder's remaining purse
    await prisma.bidder.update({
      where: { id: winningBidder.id },
      data: {
        remainingPurse: winningBidder.remainingPurse - highestBid.amount
      }
    })

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
    const playerName = currentPlayer.data ? (currentPlayer.data as any).name || (currentPlayer.data as any).Name : 'Player'
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
    
    const updatedHistory = [soldEvent, ...bidHistory]

    // Update auction
    await prisma.auction.update({
      where: { id: params.id },
      data: {
        currentPlayerId: nextPlayer?.id || null,
        bidHistory: updatedHistory as any
      }
    })

    // Broadcast player sold event
    await triggerAuctionEvent(params.id, 'player-sold', {
      playerId: currentPlayer.id,
      bidderId: winningBidder.id,
      amount: highestBid.amount,
      playerName: currentPlayer.data ? (currentPlayer.data as any).name || (currentPlayer.data as any).Name : 'Player'
    } as any)

    // Broadcast new player if exists
    if (nextPlayer) {
      await triggerAuctionEvent(params.id, 'new-player', {
        player: nextPlayer
      } as any)

      // Reset timer
      const rules = auction.rules as any
      const countdownSeconds = rules?.countdownSeconds || 30
      await triggerAuctionEvent(params.id, 'timer-update', {
        seconds: countdownSeconds
      } as any)
    }

    // Broadcast players updated event
    await triggerAuctionEvent(params.id, 'players-updated', {})

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

