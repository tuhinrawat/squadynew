import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/auctions/[id]/public - Get auction data without authentication
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auction = await prisma.auction.findUnique({
      where: { id: params.id },
      include: {
        players: true,
        bidders: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true
              }
            }
          }
        }
      }
    })

    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }

    // Get current player if exists and validate it's not SOLD
    let currentPlayer = null
    if (auction.currentPlayerId) {
      const fetchedPlayer = await prisma.player.findUnique({
        where: { id: auction.currentPlayerId }
      })
      
      // CRITICAL: If current player is SOLD, clear it to prevent showing SOLD players
      if (fetchedPlayer && fetchedPlayer.status === 'SOLD') {
        // Clear the invalid currentPlayerId
        await prisma.auction.update({
          where: { id: auction.id },
          data: { currentPlayerId: null }
        })
        currentPlayer = null
      } else {
        currentPlayer = fetchedPlayer
      }
    }

    // Calculate stats (excluding RETIRED players)
    const activePlayers = auction.players.filter((p: any) => p.status !== 'RETIRED')
    const totalPlayers = activePlayers.length
    const soldPlayers = activePlayers.filter((p: any) => p.status === 'SOLD').length
    const unsoldPlayers = activePlayers.filter((p: any) => p.status === 'UNSOLD').length
    const availablePlayers = activePlayers.filter((p: any) => p.status === 'AVAILABLE').length

    const stats = {
      total: totalPlayers,
      sold: soldPlayers,
      unsold: unsoldPlayers,
      remaining: availablePlayers
    }

    // Parse bid history
    let bidHistory: any[] = []
    if (auction.bidHistory && typeof auction.bidHistory === 'object') {
      const bidHistoryData = auction.bidHistory as any
      if (Array.isArray(bidHistoryData)) {
        bidHistory = bidHistoryData
      }
    }

    return NextResponse.json({ 
      auction,
      currentPlayer,
      stats,
      bidHistory,
      bidders: auction.bidders
    })
  } catch (error) {
    console.error('Error fetching public auction:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
