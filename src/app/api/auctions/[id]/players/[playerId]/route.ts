import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'

// GET /api/auctions/[id]/players/[playerId] - Get specific player
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; playerId: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user?.role !== 'ADMIN' && session.user?.role !== 'SUPER_ADMIN') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const player = await prisma.player.findFirst({
      where: {
        id: params.playerId,
        auctionId: params.id,
        auction: {
          createdById: session.user.id
        }
      }
    })

    if (!player) {
      return NextResponse.json(
        { error: 'Player not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ player })
  } catch (error) {
    console.error('Error fetching player:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// PUT /api/auctions/[id]/players/[playerId] - Update player
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string; playerId: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user?.role !== 'ADMIN' && session.user?.role !== 'SUPER_ADMIN') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { data, name, status, isIcon } = await request.json()

    // Check if player exists and belongs to user's auction
    const existingPlayer = await prisma.player.findFirst({
      where: {
        id: params.playerId,
        auctionId: params.id,
        auction: {
          createdById: session.user.id
        }
      }
    })

    if (!existingPlayer) {
      return NextResponse.json(
        { error: 'Player not found' },
        { status: 404 }
      )
    }

    // Validate icon player count if trying to mark as icon
    if (isIcon === true) {
      // Get auction rules to check icon player count
      const auction = await prisma.auction.findUnique({
        where: { id: params.id }
      })

      const rules = auction?.rules as any
      const maxIconPlayers = rules?.iconPlayerCount || 10

      // Count current icon players
      const currentIconCount = await prisma.player.count({
        where: {
          auctionId: params.id,
          isIcon: true
        }
      })

      // If the player is already an icon player, allow the update
      // Otherwise, check if we can add one more
      if (!existingPlayer.isIcon && currentIconCount >= maxIconPlayers) {
        return NextResponse.json(
          { error: `Maximum ${maxIconPlayers} icon players allowed for this auction. Please unmark another icon player first.` },
          { status: 400 }
        )
      }
    }

    // Update player - only include isIcon if it exists in the schema
    const updateData: any = {
      ...(name && { name }),
      ...(data && { data: data as any }),
      ...(status && { status }),
    }
    
    // Add isIcon if it's defined and the field exists in the database
    if (isIcon !== undefined) {
      try {
        updateData.isIcon = isIcon
      } catch (e) {
        // Field might not exist yet in database
        console.warn('isIcon field might not exist in database yet')
      }
    }

    const player = await prisma.player.update({
      where: {
        id: params.playerId
      },
      data: updateData
    })

    return NextResponse.json({
      message: 'Player updated successfully',
      player
    })
  } catch (error) {
    console.error('Error updating player:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// DELETE /api/auctions/[id]/players/[playerId] - Delete player
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; playerId: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user?.role !== 'ADMIN' && session.user?.role !== 'SUPER_ADMIN') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Check if player exists and belongs to user's auction
    const existingPlayer = await prisma.player.findFirst({
      where: {
        id: params.playerId,
        auctionId: params.id,
        auction: {
          createdById: session.user.id
        }
      }
    })

    if (!existingPlayer) {
      return NextResponse.json(
        { error: 'Player not found' },
        { status: 404 }
      )
    }

    // Delete player
    await prisma.player.delete({
      where: {
        id: params.playerId
      }
    })

    return NextResponse.json({ message: 'Player deleted successfully' })
  } catch (error) {
    console.error('Error deleting player:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}