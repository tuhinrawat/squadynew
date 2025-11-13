import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import bcrypt from 'bcryptjs'

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

    // Validate Bidder Choice count if trying to mark as Bidder Choice
    if (isIcon === true) {
      // Get auction rules to check Bidder Choice count
      const auction = await prisma.auction.findUnique({
        where: { id: params.id }
      })

      const rules = auction?.rules as any
      const maxIconPlayers = rules?.iconPlayerCount ?? 10

      // Count current Bidder Choice players
      const currentIconCount = await prisma.player.count({
        where: {
          auctionId: params.id,
          isIcon: true
        }
      })

      // If the player is already a Bidder Choice, allow the update
      // Otherwise, check if we can add one more
      if (!existingPlayer.isIcon && currentIconCount >= maxIconPlayers) {
        return NextResponse.json(
          { error: `Maximum ${maxIconPlayers} Bidder Choice players allowed for this auction. Please unmark another Bidder Choice player first.` },
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

    // If retiring player, create a bidder record for them
    if (status === 'RETIRED' && existingPlayer.status !== 'RETIRED') {
      const playerData = player.data as any
      const playerName = playerData?.name || playerData?.Name || 'Retired Player'
      const teamName = playerData?.['Team Name'] || playerData?.['team name'] || playerData?.teamName || playerName
      
      // Check if bidder already exists
      const existingBidder = await prisma.bidder.findFirst({
        where: {
          auctionId: params.id,
          username: `retired_${player.id}`
        }
      })

      if (!existingBidder) {
        // Get auction to get purse amount
        const auction = await prisma.auction.findUnique({
          where: { id: params.id }
        })
        const rules = auction?.rules as any
        const purseAmount = rules?.totalPurse || 100000

        // Generate credentials
        const username = `retired_${player.id}`
        const email = `${username}@retired.player`
        const password = Math.random().toString(36).substring(2, 10)
        const hashedPassword = await bcrypt.hash(password, 10)

        // Create or get user
        let user = await prisma.user.findUnique({ where: { email } })
        if (!user) {
          user = await prisma.user.create({
            data: {
              email,
              name: playerName,
              password: hashedPassword,
            }
          })
        }

        // Update user role to BIDDER
        if (user.role !== 'BIDDER') {
          user = await prisma.user.update({
            where: { id: user.id },
            data: { role: 'BIDDER' }
          })
        }

        // Get profile photo URL for bidderPhotoUrl (NOT logoUrl - logoUrl is for team logo from form upload)
        const photoKeys = ['Profile Photo', 'profile photo', 'Profile photo', 'PROFILE PHOTO', 'profile_photo', 'ProfilePhoto']
        const photoValue = photoKeys.map(key => playerData?.[key]).find(v => v && String(v).trim())
        let bidderPhotoUrl = null
        if (photoValue) {
          const photoStr = String(photoValue).trim()
          const match = photoStr.match(/\/d\/([a-zA-Z0-9_-]+)/)
          if (match && match[1]) {
            bidderPhotoUrl = `/api/proxy-image?id=${match[1]}`
          }
        }

        // Create bidder
        // logoUrl should be null initially - admin will upload team logo separately via form
        await prisma.bidder.create({
          data: {
            userId: user.id,
            auctionId: params.id,
            teamName,
            username,
            purseAmount,
            remainingPurse: purseAmount,
            logoUrl: null, // Team logo - will be uploaded via form
            bidderPhotoUrl // Bidder photo from player profile
          }
        })
      }
    }

    // If un-retiring player, delete bidder record
    if (status !== 'RETIRED' && existingPlayer.status === 'RETIRED') {
      await prisma.bidder.deleteMany({
        where: {
          auctionId: params.id,
          username: `retired_${player.id}`
        }
      })
    }

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