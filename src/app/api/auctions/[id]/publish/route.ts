import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user?.role !== 'ADMIN' && session.user?.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const auctionId = params.id

    const auction = await prisma.auction.findUnique({
      where: { id: auctionId, createdById: session.user.id },
      include: {
        players: true,
        bidders: true
      }
    })

    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }

    const rules = auction.rules as any
    
    // Validate icon players
    if (rules?.iconPlayerCount) {
      const iconPlayersCount = auction.players.filter(p => (p as any).isIcon).length
      const requiredIconCount = rules.iconPlayerCount
      
      if (iconPlayersCount !== requiredIconCount) {
        return NextResponse.json({ 
          error: `Please mark exactly ${requiredIconCount} players as icon players. Currently marked: ${iconPlayersCount}` 
        }, { status: 400 })
      }
    }

    // Validate bidder count
    if (rules?.bidderCount) {
      const bidderCount = auction.bidders.length
      const requiredBidderCount = rules.bidderCount
      
      if (bidderCount < requiredBidderCount) {
        return NextResponse.json({ 
          error: `Please add at least ${requiredBidderCount} bidders. Currently added: ${bidderCount}` 
        }, { status: 400 })
      }
    }

    await prisma.auction.update({
      where: { id: auctionId },
      data: { isPublished: true }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error publishing auction:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

