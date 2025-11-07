import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'

// GET /api/auctions/[id] - Get auction details
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user?.role !== 'ADMIN' && session.user?.role !== 'SUPER_ADMIN') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Get auction details
    const auction = await prisma.auction.findFirst({
      where: {
        id: params.id,
        createdById: session.user.id
      },
      include: {
        _count: {
          select: {
            players: true,
            bidders: true
          }
        }
      }
    })

    if (!auction) {
      return NextResponse.json(
        { error: 'Auction not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      auction
    })

  } catch (error) {
    console.error('Error fetching auction:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// PUT /api/auctions/[id] - Update auction details
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user?.role !== 'ADMIN' && session.user?.role !== 'SUPER_ADMIN') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { name, description, rules, status, isPublished, registrationOpen, customFields, columnOrder, visibleColumns, analyticsVisibleColumns } = await request.json()

    // Check if auction exists and belongs to user
    const existingAuction = await prisma.auction.findFirst({
      where: {
        id: params.id,
        createdById: session.user.id
      }
    })

    if (!existingAuction) {
      return NextResponse.json(
        { error: 'Auction not found' },
        { status: 404 }
      )
    }

    // Update auction
    const auction = await prisma.auction.update({
      where: {
        id: params.id
      },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(rules && { rules: rules as any }),
        ...(status && { status }),
        ...(isPublished !== undefined && { isPublished }),
        ...(registrationOpen !== undefined && { registrationOpen }),
        ...(customFields !== undefined && { customFields: customFields as any }),
        ...(columnOrder !== undefined && { columnOrder: columnOrder as any }),
        ...(visibleColumns !== undefined && { visibleColumns: visibleColumns as any }),
        ...(analyticsVisibleColumns !== undefined && { analyticsVisibleColumns: analyticsVisibleColumns as any })
      },
      include: {
        _count: {
          select: {
            players: true,
            bidders: true
          }
        }
      }
    })

    return NextResponse.json({
      message: 'Auction updated successfully',
      auction
    })

  } catch (error) {
    console.error('Error updating auction:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// DELETE /api/auctions/[id] - Delete auction (cascade delete players and bidders)
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user?.role !== 'ADMIN' && session.user?.role !== 'SUPER_ADMIN') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Check if auction exists and belongs to user
    const existingAuction = await prisma.auction.findFirst({
      where: {
        id: params.id,
        createdById: session.user.id
      }
    })

    if (!existingAuction) {
      return NextResponse.json(
        { error: 'Auction not found' },
        { status: 404 }
      )
    }

    // Delete related records first
    // Delete players
    await prisma.player.deleteMany({
      where: { auctionId: params.id }
    })

    // Delete bidders and associated users
    const bidders = await prisma.bidder.findMany({
      where: { auctionId: params.id },
      select: { userId: true }
    })

    // Delete bidders
    await prisma.bidder.deleteMany({
      where: { auctionId: params.id }
    })

    // Delete associated users (only BIDDER role users)
    const bidderUserIds = bidders.map(b => b.userId)
    if (bidderUserIds.length > 0) {
      await prisma.user.deleteMany({
        where: {
          id: { in: bidderUserIds },
          role: 'BIDDER'
        }
      })
    }

    // Finally delete the auction
    await prisma.auction.delete({
      where: {
        id: params.id
      }
    })

    return NextResponse.json({
      message: 'Auction deleted successfully'
    })

  } catch (error) {
    console.error('Error deleting auction:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
