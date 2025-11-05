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

    // Get the source auction
    const sourceAuction = await prisma.auction.findUnique({
      where: { id: params.id, createdById: session.user.id },
      include: {
        players: true,
        bidders: {
          include: {
            user: true
          }
        }
      }
    })

    if (!sourceAuction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }

    // Create new auction with "Copy of" prefix
    const newAuction = await prisma.auction.create({
      data: {
        name: `Copy of ${sourceAuction.name}`,
        description: sourceAuction.description,
        rules: sourceAuction.rules as any,
        status: 'DRAFT',
        isPublished: false,
        registrationOpen: sourceAuction.registrationOpen,
        customFields: sourceAuction.customFields as any,
        columnOrder: sourceAuction.columnOrder as any,
        createdById: session.user.id
      }
    })

    // Copy all players (without changing their status - they all start as AVAILABLE)
    for (const player of sourceAuction.players) {
      await prisma.player.create({
        data: {
          auctionId: newAuction.id,
          data: player.data as any,
          status: 'AVAILABLE', // Reset to AVAILABLE
          isIcon: (player as any).isIcon || false
        }
      })
    }

    // Copy bidders by reusing existing users (bidders are unique per auction)
    for (const bidder of sourceAuction.bidders) {
      // Create new bidder record with the same user, reset purse
      await prisma.bidder.create({
        data: {
          userId: bidder.userId, // Reuse the same user
          auctionId: newAuction.id,
          teamName: bidder.teamName,
          username: bidder.username, // Keep the same username
          purseAmount: bidder.purseAmount,
          remainingPurse: bidder.purseAmount, // Reset to full purse
          logoUrl: bidder.logoUrl
        }
      })
    }

    return NextResponse.json({
      success: true,
      auctionId: newAuction.id,
      message: 'Auction duplicated successfully. All bidders retain their original credentials and can access the new auction.'
    })
  } catch (error) {
    console.error('Error duplicating auction:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
