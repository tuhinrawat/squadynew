import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'

// POST /api/auctions/[id]/players/batch-update - Batch update players
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || (session.user?.role !== 'ADMIN' && session.user?.role !== 'SUPER_ADMIN')) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { playerIds, updates } = await request.json()

    if (!Array.isArray(playerIds) || playerIds.length === 0) {
      return NextResponse.json(
        { error: 'playerIds must be a non-empty array' },
        { status: 400 }
      )
    }

    if (!updates || typeof updates !== 'object') {
      return NextResponse.json(
        { error: 'updates object is required' },
        { status: 400 }
      )
    }

    // Verify all players belong to this auction and user
    const existingPlayers = await prisma.player.findMany({
      where: {
        id: { in: playerIds },
        auctionId: params.id,
        auction: {
          createdById: session.user.id
        }
      }
    })

    if (existingPlayers.length !== playerIds.length) {
      return NextResponse.json(
        { error: 'Some players not found or do not belong to this auction' },
        { status: 404 }
      )
    }

    // If marking as icon players, validate the limit
    if (updates.isIcon === true) {
      const auction = await prisma.auction.findUnique({
        where: { id: params.id }
      })

      const rules = auction?.rules as any
      const maxIconPlayers = rules?.iconPlayerCount ?? 10

      // Count current icon players (excluding the ones being updated)
      const currentIconCount = await prisma.player.count({
        where: {
          auctionId: params.id,
          isIcon: true,
          id: { notIn: playerIds }
        }
      })

      // Calculate how many would be icon players after this update
      const currentlyIconInSelection = existingPlayers.filter(p => p.isIcon).length
      const newIconCount = currentIconCount + (playerIds.length - currentlyIconInSelection)

      if (newIconCount > maxIconPlayers) {
        return NextResponse.json(
          { error: `This would exceed the maximum of ${maxIconPlayers} icon players. Currently ${currentIconCount} icon players are marked.` },
          { status: 400 }
        )
      }
    }

    // Build update data
    const updateData: any = {}
    if ('status' in updates) {
      updateData.status = updates.status
    }
    if ('isIcon' in updates) {
      updateData.isIcon = updates.isIcon
    }

    // Perform batch update
    const result = await prisma.player.updateMany({
      where: {
        id: { in: playerIds }
      },
      data: updateData
    })

    return NextResponse.json({
      success: true,
      updated: result.count,
      message: `Successfully updated ${result.count} player(s)`
    })

  } catch (error) {
    console.error('Batch update error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

