import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'
import { triggerAuctionEvent } from '@/lib/pusher'
import { isLiveStatus } from '@/lib/auction-status'

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

    // Can only start mock run from DRAFT or PAUSED status
    if (auction.status === 'LIVE') {
      return NextResponse.json({ error: 'Auction is already live. Please pause it first.' }, { status: 400 })
    }

    if (auction.status === 'COMPLETED') {
      return NextResponse.json({ error: 'Cannot start mock run for completed auction' }, { status: 400 })
    }

    if (auction.status === 'MOCK_RUN') {
      return NextResponse.json({ error: 'Mock run is already active' }, { status: 400 })
    }

    // Pick random available player
    // ICON PLAYERS MUST BE AUCTIONED FIRST
    // Only show regular players after ALL icon players have been auctioned (SOLD or UNSOLD)
    const availablePlayers = auction.players.filter(p => p.status === 'AVAILABLE')
    if (availablePlayers.length === 0) {
      return NextResponse.json({ error: 'No available players' }, { status: 400 })
    }

    // ICON PLAYERS MUST BE AUCTIONED FIRST
    // Only show regular players after ALL icon players have been auctioned (SOLD or UNSOLD)
    const iconPlayersAvailable = availablePlayers.filter(p => p.isIcon)
    
    let randomPlayer

    if (iconPlayersAvailable.length > 0) {
      // There are still icon players available - MUST select from icon players only
      // Regular players cannot be shown until all icon players are processed
      randomPlayer = iconPlayersAvailable[Math.floor(Math.random() * iconPlayersAvailable.length)]
    } else {
      // All icon players have been processed (either SOLD or UNSOLD and not yet recycled)
      // Now we can show regular players
      const regularPlayersAvailable = availablePlayers.filter(p => !p.isIcon)
      if (regularPlayersAvailable.length > 0) {
        randomPlayer = regularPlayersAvailable[Math.floor(Math.random() * regularPlayersAvailable.length)]
      }
    }
    
    if (!randomPlayer) {
      return NextResponse.json({ error: 'No available players' }, { status: 400 })
    }

    // Update auction status to MOCK_RUN and set current player
    // If coming from PAUSED, preserve bid history; otherwise start fresh
    const updateData: any = {
      status: 'MOCK_RUN',
      currentPlayerId: randomPlayer.id
    }
    
    if (auction.status !== 'PAUSED') {
      updateData.bidHistory = []
    }
    
    await prisma.auction.update({
      where: { id: params.id },
      data: updateData
    })

    // Broadcast player-sold event
    await triggerAuctionEvent(params.id, 'new-player', { player: randomPlayer })

    return NextResponse.json({ success: true, player: randomPlayer })
  } catch (error) {
    console.error('Error starting mock run:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

