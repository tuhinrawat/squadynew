import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'

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

    // If retiring players, create bidder records for them
    if (updates.status === 'RETIRED') {
      const auction = await prisma.auction.findUnique({
        where: { id: params.id }
      })
      const rules = auction?.rules as any
      const purseAmount = rules?.totalPurse || 10000000

      for (const player of existingPlayers) {
        if (player.status !== 'RETIRED') { // Only create bidder if not already retired
          const playerData = player.data as any
          const playerName = playerData?.name || playerData?.Name || player.name || 'Retired Player'
          const teamName = playerData?.['Team Name'] || playerData?.['team name'] || playerData?.teamName || playerName
          
          // Check if bidder already exists
          const existingBidder = await prisma.bidder.findFirst({
            where: {
              auctionId: params.id,
              username: `retired_${player.id}`
            }
          })

          if (!existingBidder) {
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

            // Get profile photo URL
            const photoKeys = ['Profile Photo', 'profile photo', 'Profile photo', 'PROFILE PHOTO', 'profile_photo', 'ProfilePhoto']
            const photoValue = photoKeys.map(key => playerData?.[key]).find(v => v && String(v).trim())
            let logoUrl = null
            if (photoValue) {
              const photoStr = String(photoValue).trim()
              const match = photoStr.match(/\/d\/([a-zA-Z0-9_-]+)/)
              if (match && match[1]) {
                logoUrl = `/api/proxy-image?id=${match[1]}`
              }
            }

            // Create bidder
            await prisma.bidder.create({
              data: {
                userId: user.id,
                auctionId: params.id,
                teamName,
                username,
                purseAmount,
                remainingPurse: purseAmount,
                logoUrl
              }
            })
          }
        }
      }
    }

    // If un-retiring players, delete bidder records
    if (updates.status === 'AVAILABLE' || updates.status === 'UNSOLD') {
      await prisma.bidder.deleteMany({
        where: {
          auctionId: params.id,
          username: { in: playerIds.map(id => `retired_${id}`) }
        }
      })
    }

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

