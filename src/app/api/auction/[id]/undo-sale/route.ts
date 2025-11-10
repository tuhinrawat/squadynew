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

    if (!session || session.user?.role !== 'ADMIN' && session.user?.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const auction = await prisma.auction.findUnique({
      where: { id: params.id },
      include: {
        players: true
      }
    })

    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }

    // Parse bid history to find the most recent sale
    let bidHistory: any[] = []
    if (auction.bidHistory && typeof auction.bidHistory === 'object') {
      const bidHistoryData = auction.bidHistory as any
      if (Array.isArray(bidHistoryData)) {
        bidHistory = bidHistoryData
      }
    }

    // Find the most recent 'sold' event in bid history
    const soldEvents = bidHistory.filter((bid: any) => bid.type === 'sold' && bid.playerId)
    if (soldEvents.length === 0) {
      return NextResponse.json({ error: 'No sold players to undo' }, { status: 400 })
    }

    // Sort by timestamp (most recent first) - timestamps are ISO strings or Date objects
    soldEvents.sort((a: any, b: any) => {
      const timeA = typeof a.timestamp === 'string' ? new Date(a.timestamp).getTime() : (a.timestamp?.getTime?.() || 0)
      const timeB = typeof b.timestamp === 'string' ? new Date(b.timestamp).getTime() : (b.timestamp?.getTime?.() || 0)
      return timeB - timeA // Most recent first
    })

    const mostRecentSale = soldEvents[0]
    const lastSoldPlayerId = mostRecentSale.playerId

    // Get the last sold player
    let lastSoldPlayer = await prisma.player.findUnique({
      where: { id: lastSoldPlayerId }
    })

    // Fallback: if player not found or not sold, get any sold player
    if (!lastSoldPlayer || lastSoldPlayer.status !== 'SOLD') {
      const soldPlayers = auction.players.filter(p => p.status === 'SOLD')
      if (soldPlayers.length === 0) {
        return NextResponse.json({ error: 'No sold players to undo' }, { status: 400 })
      }
      // Get the last one from the array (assuming they're in order)
      const fallbackPlayer = soldPlayers[soldPlayers.length - 1]
      if (!fallbackPlayer) {
        return NextResponse.json({ error: 'No sold players to undo' }, { status: 400 })
      }
      const foundPlayer = await prisma.player.findUnique({
        where: { id: fallbackPlayer.id }
      })
      if (!foundPlayer || foundPlayer.status !== 'SOLD') {
        return NextResponse.json({ error: 'Player not found or not sold' }, { status: 404 })
      }
      lastSoldPlayer = foundPlayer
    }

    if (!lastSoldPlayer.soldTo) {
      return NextResponse.json({ error: 'Player has no buyer assigned' }, { status: 400 })
    }

    if (!lastSoldPlayer.soldPrice || lastSoldPlayer.soldPrice <= 0) {
      return NextResponse.json({ error: 'Invalid sale price' }, { status: 400 })
    }

    // Get the bidder who purchased
    const bidder = await prisma.bidder.findUnique({
      where: { id: lastSoldPlayer.soldTo }
    })

    if (!bidder) {
      return NextResponse.json({ error: 'Bidder not found' }, { status: 404 })
    }

    // Ensure remainingPurse is a valid number
    if (typeof bidder.remainingPurse !== 'number' || isNaN(bidder.remainingPurse)) {
      return NextResponse.json({ error: 'Invalid bidder purse amount' }, { status: 400 })
    }

    // Calculate the refund amount
    const refundAmount = lastSoldPlayer.soldPrice
    const newPurseAmount = bidder.remainingPurse + refundAmount

    // Remove all bids for this player from bid history so bidding starts fresh
    const clearedBidHistory = bidHistory.filter((bid: any) => 
      bid.playerId !== lastSoldPlayer.id
    )

    // Revert the sale in a transaction
    await prisma.$transaction([
      prisma.player.update({
        where: { id: lastSoldPlayer.id },
        data: {
          status: 'AVAILABLE',
          soldTo: null,
          soldPrice: null
        }
      }),
      prisma.bidder.update({
        where: { id: bidder.id },
        data: {
          remainingPurse: newPurseAmount
        }
      }),
      prisma.auction.update({
        where: { id: params.id },
        data: {
          currentPlayerId: lastSoldPlayer.id,
          // Clear bid history for this player so bidding starts fresh from base price
          bidHistory: clearedBidHistory as any
        }
      })
    ])

    // Get updated player and bidder data after undo
    const updatedPlayer = await prisma.player.findUnique({
      where: { id: lastSoldPlayer.id }
    })

    const updatedBidder = await prisma.bidder.findUnique({
      where: { id: bidder.id }
    })

    if (!updatedPlayer) {
      return NextResponse.json({ error: 'Player not found after undo' }, { status: 404 })
    }

    if (!updatedBidder) {
      return NextResponse.json({ error: 'Bidder not found after undo' }, { status: 404 })
    }

    // Broadcast sale undo event with full data for real-time updates
    await triggerAuctionEvent(params.id, 'sale-undo', {
      playerId: lastSoldPlayer.id,
      player: updatedPlayer,
      bidderId: bidder.id,
      refundedAmount: refundAmount,
      bidderRemainingPurse: updatedBidder.remainingPurse,
      updatedBidders: [{ id: bidder.id, remainingPurse: updatedBidder.remainingPurse }]
    })

    return NextResponse.json({ 
      success: true,
      player: updatedPlayer,
      bidder: updatedBidder
    })
  } catch (error) {
    console.error('Error undoing sale:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const errorStack = error instanceof Error ? error.stack : undefined
    console.error('Error details:', { errorMessage, errorStack })
    return NextResponse.json({ 
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? errorMessage : undefined
    }, { status: 500 })
  }
}

