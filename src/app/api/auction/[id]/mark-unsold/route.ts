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
      where: { id: params.id }
    })

    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }

    // Fetch current player
    const currentPlayer = await prisma.player.findUnique({
      where: { id: playerId }
    })

    // Update player status to UNSOLD
    await prisma.player.update({
      where: { id: playerId },
      data: {
        status: 'UNSOLD',
        soldTo: null,
        soldPrice: null
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

    // Add unsold event to bid history
    const playerName = currentPlayer?.data ? (currentPlayer.data as any).name || (currentPlayer.data as any).Name : 'Player'
    const unsoldEvent = {
      type: 'unsold',
      playerId: playerId,
      playerName: playerName,
      timestamp: new Date().toISOString()
    }
    
    // Fetch current bid history
    let bidHistory: any[] = []
    if (auction.bidHistory && typeof auction.bidHistory === 'object') {
      const bidHistoryData = auction.bidHistory as any
      if (Array.isArray(bidHistoryData)) {
        bidHistory = bidHistoryData
      }
    }
    
    const updatedHistory = [unsoldEvent, ...bidHistory]

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
      nextPlayer
    })
  } catch (error) {
    console.error('Error marking player as unsold:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

