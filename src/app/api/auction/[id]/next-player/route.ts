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
      include: { players: true }
    })

    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }

    if (auction.status !== 'LIVE') {
      return NextResponse.json({ error: 'Auction is not live' }, { status: 400 })
    }

    // Mark current player as UNSOLD if it's still AVAILABLE
    if (auction.currentPlayerId) {
      const currentPlayer = auction.players.find(p => p.id === auction.currentPlayerId)
      if (currentPlayer && currentPlayer.status === 'AVAILABLE') {
        await prisma.player.update({
          where: { id: currentPlayer.id },
          data: { status: 'UNSOLD' }
        })
      }
    }

    // Pick next random available player
    // Prioritize icon players if they haven't all been auctioned yet
    const availablePlayers = auction.players.filter(p => p.status === 'AVAILABLE')
    if (availablePlayers.length === 0) {
      return NextResponse.json({ error: 'No more players available' }, { status: 400 })
    }

    // Get auction rules
    const rules = auction.rules as any
    const iconPlayerCount = rules?.iconPlayerCount ?? 10

    // Check how many icon players have been auctioned (status is not AVAILABLE)
    const iconPlayersAuctioned = auction.players.filter(p => p.isIcon && p.status !== 'AVAILABLE').length

    let randomPlayer

    // If icon players haven't all been auctioned yet, prioritize them
    if (iconPlayersAuctioned < iconPlayerCount) {
      const iconPlayersAvailable = availablePlayers.filter(p => p.isIcon)
      if (iconPlayersAvailable.length > 0) {
        // Randomly select from available icon players
        randomPlayer = iconPlayersAvailable[Math.floor(Math.random() * iconPlayersAvailable.length)]
      } else {
        // No icon players available, pick from regular players
        randomPlayer = availablePlayers[Math.floor(Math.random() * availablePlayers.length)]
      }
    } else {
      // All icon players have been auctioned, pick from remaining players
      randomPlayer = availablePlayers[Math.floor(Math.random() * availablePlayers.length)]
    }

    // Update auction with new current player
    await prisma.auction.update({
      where: { id: params.id },
      data: {
        currentPlayerId: randomPlayer.id,
        bidHistory: []
      }
    })

    // Timer is now managed client-side only for urgency display
    // No automatic sale when timer expires - admin decides

    // Broadcast new player event
    await triggerAuctionEvent(params.id, 'new-player', { player: randomPlayer })

    return NextResponse.json({ success: true, player: randomPlayer })
  } catch (error) {
    console.error('Error moving to next player:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}


