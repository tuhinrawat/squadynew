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

    // OPTIMIZED: Fetch only AVAILABLE players (not all players)
    let availablePlayers = await prisma.player.findMany({
      where: {
        auctionId: params.id,
        status: 'AVAILABLE'
      },
      select: {
        id: true,
        status: true,
        isIcon: true
      }
    })
    
    // If no available players, automatically recycle UNSOLD players back to AVAILABLE
    // IMPORTANT: Only recycle UNSOLD players, NEVER recycle SOLD players
    if (availablePlayers.length === 0) {
      // OPTIMIZED: Fetch only UNSOLD players (not all players)
      const unsoldPlayers = await prisma.player.findMany({
        where: {
          auctionId: params.id,
          status: 'UNSOLD' // Explicit status check ensures SOLD players are never fetched
        },
        select: {
          id: true,
          status: true,
          isIcon: true
        }
      })
      
      // Safety check: ensure no SOLD players (shouldn't happen with status filter)
      if (unsoldPlayers.some(p => p.status !== 'UNSOLD')) {
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
        
        // OPTIMIZED: Fetch only AVAILABLE players after conversion
        availablePlayers = await prisma.player.findMany({
          where: {
            auctionId: params.id,
            status: 'AVAILABLE'
          },
          select: {
            id: true,
            status: true,
            isIcon: true
          }
        })
        
        // Broadcast players updated event to notify clients of recycled players
        triggerAuctionEvent(params.id, 'players-updated', {} as any).catch(err => console.error('Pusher error (non-critical):', err))
      }
    }
    
    let nextPlayer = null
    
    if (availablePlayers.length > 0) {
      // ICON PLAYERS MUST BE AUCTIONED FIRST
      // Only show regular players after ALL icon players have been auctioned (SOLD or UNSOLD)
      const iconPlayersAvailable = availablePlayers.filter(p => p.isIcon)
      
      let selectedPlayerId: string | null = null
      
      if (iconPlayersAvailable.length > 0) {
        // There are still icon players available - MUST select from icon players only
        // Regular players cannot be shown until all icon players are processed
        selectedPlayerId = iconPlayersAvailable[Math.floor(Math.random() * iconPlayersAvailable.length)].id
      } else {
        // All icon players have been processed (either SOLD or UNSOLD and not yet recycled)
        // Now we can show regular players
        const regularPlayersAvailable = availablePlayers.filter(p => !p.isIcon)
        if (regularPlayersAvailable.length > 0) {
          selectedPlayerId = regularPlayersAvailable[Math.floor(Math.random() * regularPlayersAvailable.length)].id
        }
      }
      
      // CRITICAL: Fetch full player data including the `data` field
      if (selectedPlayerId) {
        nextPlayer = await prisma.player.findUnique({
          where: { id: selectedPlayerId },
          select: {
            id: true,
            status: true,
            isIcon: true,
            data: true, // Include full player data
            auctionId: true
          }
        })
      }
    }

    // Fetch current bid history
    let bidHistory: any[] = []
    if (auction.bidHistory && typeof auction.bidHistory === 'object') {
      const bidHistoryData = auction.bidHistory as any
      if (Array.isArray(bidHistoryData)) {
        bidHistory = bidHistoryData
      }
    }
    
    // Remove ALL bids for this player (clean slate when marked unsold)
    // Keep bids for other players and other event types
    const cleanedHistory = bidHistory.filter(entry => {
      // Keep entries that don't belong to this player
      if (entry.playerId !== playerId) return true
      // Remove all bids and bid-undo entries for this player
      if (!entry.type || entry.type === 'bid' || entry.type === 'bid-undo') return false
      // Keep sold/unsold events for history (but there shouldn't be sold events for unsold players)
      return true
    })
    
    // Add unsold event to bid history
    const unsoldEvent = {
      type: 'unsold',
      playerId: playerId,
      playerName: playerName,
      timestamp: new Date().toISOString()
    }
    
    const updatedHistory = [unsoldEvent, ...cleanedHistory]

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

