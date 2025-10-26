import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// POST /api/auctions/[id]/register - Register a player for auction
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { playerData } = await request.json()

    if (!playerData || typeof playerData !== 'object') {
      return NextResponse.json({ error: 'Invalid player data' }, { status: 400 })
    }

    // Check if auction exists and is open for registration
    const auction = await prisma.auction.findFirst({
      where: {
        id: params.id,
        isPublished: true,
        registrationOpen: true
      }
    })

    if (!auction) {
      return NextResponse.json({ error: 'Auction not found or registration closed' }, { status: 404 })
    }

    // Create player
    const player = await prisma.player.create({
      data: {
        auctionId: params.id,
        data: playerData as any,
        status: 'AVAILABLE'
      }
    })

    return NextResponse.json({ 
      message: 'Registration successful', 
      player: {
        id: player.id,
        status: player.status
      }
    })
  } catch (error) {
    console.error('Error registering player:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
