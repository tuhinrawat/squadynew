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

    // Get current player if exists
    let currentPlayer = null
    if (auction.currentPlayerId) {
      currentPlayer = await prisma.player.findUnique({
        where: { id: auction.currentPlayerId }
      })
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
