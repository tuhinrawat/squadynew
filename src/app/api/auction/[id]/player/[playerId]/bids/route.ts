import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/auction/[id]/player/[playerId]/bids - Public: return bid history for a player in an auction
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; playerId: string } }
) {
  try {
    const auction = await prisma.auction.findUnique({
      where: { id: params.id },
      select: { bidHistory: true }
    })

    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }

    let history: any[] = []
    if (auction.bidHistory && typeof auction.bidHistory === 'object') {
      const data = auction.bidHistory as any
      if (Array.isArray(data)) history = data
    }

    const filtered = history.filter(h => h.playerId === params.playerId)
    return NextResponse.json({ bids: filtered })
  } catch (e) {
    console.error('Error fetching player bids:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}


