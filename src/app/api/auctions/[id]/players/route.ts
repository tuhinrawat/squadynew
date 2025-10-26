import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'

// GET /api/auctions/[id]/players - Fetch all players for auction
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || session.user?.role !== 'ADMIN' && session.user?.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const auction = await prisma.auction.findFirst({
      where: {
        id: params.id,
        createdById: session.user.id
      }
    })

    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }

    const players = await prisma.player.findMany({
      where: {
        auctionId: params.id
      },
      orderBy: {
        createdAt: 'asc'
      }
    })

    return NextResponse.json({ players })
  } catch (error) {
    console.error('Error fetching players:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/auctions/[id]/players - Create single player manually
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || session.user?.role !== 'ADMIN' && session.user?.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const auction = await prisma.auction.findFirst({
      where: {
        id: params.id,
        createdById: session.user.id
      }
    })

    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }

    const { data } = await request.json()

    if (!data || typeof data !== 'object') {
      return NextResponse.json({ error: 'Invalid player data' }, { status: 400 })
    }

    const player = await prisma.player.create({
      data: {
        auctionId: params.id,
        data: data as any,
        status: 'AVAILABLE'
      }
    })

    return NextResponse.json({ 
      message: 'Player created successfully', 
      player 
    })
  } catch (error) {
    console.error('Error creating player:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
