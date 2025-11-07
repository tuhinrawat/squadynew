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
    let availablePlayers = auction.players.filter(p => p.status === 'AVAILABLE')
    let currentAuctionData = auction
    
    // If no available players, automatically recycle UNSOLD players back to AVAILABLE
    // IMPORTANT: Only recycle UNSOLD players, NEVER recycle SOLD players
    if (availablePlayers.length === 0) {
      // Explicitly filter for UNSOLD players only - SOLD players should NEVER be recycled
      const unsoldPlayers = auction.players.filter(p => p.status === 'UNSOLD')
      
      // Additional safety check: ensure no SOLD players are accidentally included
      const soldPlayers = auction.players.filter(p => p.status === 'SOLD')
      if (soldPlayers.length > 0 && unsoldPlayers.some(p => soldPlayers.find(sp => sp.id === p.id))) {
        console.error('CRITICAL: Attempted to recycle SOLD players - this should never happen!')
        return NextResponse.json({ error: 'Internal error: Cannot recycle sold players' }, { status: 500 })
      }
      
      if (unsoldPlayers.length > 0) {
        // Convert only UNSOLD players back to AVAILABLE (never SOLD players)
        await prisma.player.updateMany({
          where: {
            id: { in: unsoldPlayers.map(p => p.id) },
            auctionId: params.id,
            status: 'UNSOLD' // Explicit status check ensures SOLD players are never updated
          },
          data: {
            status: 'AVAILABLE',
            soldTo: null,
            soldPrice: null
          }
        })
        
        // Refresh auction data after conversion
        const updatedAuction = await prisma.auction.findUnique({
          where: { id: params.id },
          include: { players: true }
        })
        
        if (updatedAuction) {
          currentAuctionData = updatedAuction
          availablePlayers = updatedAuction.players.filter(p => p.status === 'AVAILABLE')
          
          // Broadcast players updated event to notify clients of recycled players
          triggerAuctionEvent(params.id, 'players-updated', {} as any).catch(err => console.error('Pusher error (non-critical):', err))
        }
      }
    }
    
    let nextPlayer = null
    
    if (availablePlayers.length > 0) {
      // ICON PLAYERS MUST BE AUCTIONED FIRST
      // Only show regular players after ALL icon players have been auctioned (SOLD or UNSOLD)
      const iconPlayersAvailable = availablePlayers.filter(p => p.isIcon)
      
      if (iconPlayersAvailable.length > 0) {
        // There are still icon players available - MUST select from icon players only
        // Regular players cannot be shown until all icon players are processed
        nextPlayer = iconPlayersAvailable[Math.floor(Math.random() * iconPlayersAvailable.length)]
      } else {
        // All icon players have been processed (either SOLD or UNSOLD and not yet recycled)
        // Now we can show regular players
        const regularPlayersAvailable = availablePlayers.filter(p => !p.isIcon)
        if (regularPlayersAvailable.length > 0) {
          nextPlayer = regularPlayersAvailable[Math.floor(Math.random() * regularPlayersAvailable.length)]
        }
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

