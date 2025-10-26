import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'

// DELETE /api/auctions/[id]/players/clear - Clear all players for an auction
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || session.user?.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if auction exists and belongs to user
    const auction = await prisma.auction.findFirst({
      where: {
        id: params.id,
        createdById: session.user.id
      }
    })

    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }

    // Delete all players for this auction
    const result = await prisma.player.deleteMany({
      where: {
        auctionId: params.id
      }
    })

    return NextResponse.json({ 
      message: `${result.count} players deleted successfully`,
      count: result.count
    })
  } catch (error) {
    console.error('Error clearing players:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
