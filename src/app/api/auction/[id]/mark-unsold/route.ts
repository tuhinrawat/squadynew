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

    // Fetch auction with players
    const auction = await prisma.auction.findUnique({
      where: { id: params.id },
      include: { players: true }
    })

    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }

    // Fetch current player
    const currentPlayer = await prisma.player.findUnique({
      where: { id: playerId }
    })

    const playerName = currentPlayer?.data ? (currentPlayer.data as any).name || (currentPlayer.data as any).Name : 'Player'

    // Broadcast unsold event IMMEDIATELY for instant real-time updates (before DB writes)
    triggerAuctionEvent(params.id, 'player-unsold', {
      playerId: playerId,
      playerName: playerName
    } as any).catch(err => console.error('Pusher error (non-critical):', err))

    // Update player status to UNSOLD
    await prisma.player.update({
      where: { id: playerId },
      data: {
        status: 'UNSOLD',
        soldTo: null,
        soldPrice: null
      }
    })

    // Pick next random available player
    // Prioritize icon players if they haven't all been auctioned yet
    const availablePlayers = auction.players.filter(p => p.status === 'AVAILABLE')
    
    let nextPlayer = null
    
    if (availablePlayers.length > 0) {
      // Get auction rules
      const rules = auction.rules as any
      const iconPlayerCount = rules?.iconPlayerCount ?? 10
      
      // Check how many icon players have been auctioned (status is not AVAILABLE)
      const iconPlayersAuctioned = auction.players.filter(p => p.isIcon && p.status !== 'AVAILABLE').length
      
      // If icon players haven't all been auctioned yet, prioritize them
      if (iconPlayersAuctioned < iconPlayerCount) {
        const iconPlayersAvailable = availablePlayers.filter(p => p.isIcon)
        if (iconPlayersAvailable.length > 0) {
          // Randomly select from available icon players
          nextPlayer = iconPlayersAvailable[Math.floor(Math.random() * iconPlayersAvailable.length)]
        } else {
          // No icon players available, pick from regular players
          nextPlayer = availablePlayers[Math.floor(Math.random() * availablePlayers.length)]
        }
      } else {
        // All icon players have been auctioned, pick from remaining players
        nextPlayer = availablePlayers[Math.floor(Math.random() * availablePlayers.length)]
      }
    }

    // Add unsold event to bid history
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

