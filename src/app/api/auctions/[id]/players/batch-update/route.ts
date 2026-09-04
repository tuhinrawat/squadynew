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

    // If marking as Bidder Choice players, validate the limit
    if (updates.isIcon === true) {
      const auction = await prisma.auction.findUnique({
        where: { id: params.id }
      })

      const rules = auction?.rules as any
      const maxIconPlayers = rules?.iconPlayerCount ?? 10

      // Count current Bidder Choice players (excluding the ones being updated)
      const currentIconCount = await prisma.player.count({
        where: {
          auctionId: params.id,
          isIcon: true,
          id: { notIn: playerIds }
        }
      })

      // Calculate how many would be Bidder Choice players after this update
      const currentlyIconInSelection = existingPlayers.filter(p => p.isIcon).length
      const newIconCount = currentIconCount + (playerIds.length - currentlyIconInSelection)

      if (newIconCount > maxIconPlayers) {
        return NextResponse.json(
          { error: `This would exceed the maximum of ${maxIconPlayers} Bidder Choice players. Currently ${currentIconCount} Bidder Choice players are marked.` },
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

    // If retiring players, create bidder records for them. Batched instead
    // of one-at-a-time: the previous version did up to 5 sequential DB calls
    // plus a bcrypt hash per player inside a for-loop, which timed out for
    // any large batch of retirements.
    if (updates.status === 'RETIRED') {
      const auction = await prisma.auction.findUnique({
        where: { id: params.id },
        select: { rules: true }
      })
      const rules = auction?.rules as any
      const purseAmount = rules?.totalPurse || 100000

      const playersToRetire = existingPlayers.filter(p => p.status !== 'RETIRED')

      if (playersToRetire.length > 0) {
        const usernames = playersToRetire.map(p => `retired_${p.id}`)
        const emails = usernames.map(u => `${u}@retired.player`)

        // One query each for bidders/users that might already exist, instead
        // of a findFirst + findUnique per player.
        const [existingBidders, existingUsers] = await Promise.all([
          prisma.bidder.findMany({
            where: { auctionId: params.id, username: { in: usernames } },
            select: { username: true }
          }),
          prisma.user.findMany({
            where: { email: { in: emails } },
            select: { id: true, email: true, role: true }
          })
        ])

        const existingBidderUsernames = new Set(existingBidders.map(b => b.username))
        const existingUserByEmail = new Map(existingUsers.map(u => [u.email, u]))

        // Only players that don't already have a bidder record need anything below.
        const playersNeedingBidder = playersToRetire.filter(
          p => !existingBidderUsernames.has(`retired_${p.id}`)
        )

        // Among those, figure out which need a brand-new User row (vs. reusing
        // one from a previous retire/un-retire cycle for the same player).
        const newUserSpecs = playersNeedingBidder
          .filter(p => !existingUserByEmail.has(`retired_${p.id}@retired.player`))
          .map(p => {
            const playerData = p.data as any
            const playerName = playerData?.name || playerData?.Name || 'Retired Player'
            return {
              email: `retired_${p.id}@retired.player`,
              name: playerName,
            }
          })

        // Hash all new passwords concurrently (bcrypt releases the event
        // loop, so this runs genuinely in parallel rather than one-at-a-time).
        const hashedNewUsers = await Promise.all(newUserSpecs.map(async spec => ({
          ...spec,
          password: await bcrypt.hash(Math.random().toString(36).substring(2, 10), 10)
        })))

        if (hashedNewUsers.length > 0) {
          await prisma.user.createMany({
            data: hashedNewUsers.map(u => ({
              email: u.email,
              name: u.name,
              password: u.password,
              role: 'BIDDER' as const
            })),
            skipDuplicates: true
          })
        }

        // Promote any pre-existing (non-BIDDER) user to BIDDER role in one batched update.
        const usersNeedingRoleChange = playersNeedingBidder
          .map(p => existingUserByEmail.get(`retired_${p.id}@retired.player`))
          .filter((u): u is NonNullable<typeof u> => u !== undefined && u.role !== 'BIDDER')
        if (usersNeedingRoleChange.length > 0) {
          await prisma.user.updateMany({
            where: { id: { in: usersNeedingRoleChange.map(u => u.id) } },
            data: { role: 'BIDDER' }
          })
        }

        // Re-fetch (new + pre-existing) users by email in one query to get
        // their ids for the bidder rows below.
        const allEmails = playersNeedingBidder.map(p => `retired_${p.id}@retired.player`)
        const allUsers = await prisma.user.findMany({
          where: { email: { in: allEmails } },
          select: { id: true, email: true }
        })
        const userIdByEmail = new Map(allUsers.map(u => [u.email, u.id]))

        const bidderRows = playersNeedingBidder
          .map(p => {
            const playerData = p.data as any
            const playerName = playerData?.name || playerData?.Name || 'Retired Player'
            const teamName = playerData?.['Team Name'] || playerData?.['team name'] || playerData?.teamName || playerName
            const username = `retired_${p.id}`
            const userId = userIdByEmail.get(`${username}@retired.player`)
            if (!userId) return null

            // Get profile photo URL for bidderPhotoUrl (NOT logoUrl - logoUrl is for team logo from form upload)
            const photoKeys = ['Profile Photo', 'profile photo', 'Profile photo', 'PROFILE PHOTO', 'profile_photo', 'ProfilePhoto']
            const photoValue = photoKeys.map(key => playerData?.[key]).find(v => v && String(v).trim())
            let bidderPhotoUrl: string | null = null
            if (photoValue) {
              const photoStr = String(photoValue).trim()
              const match = photoStr.match(/\/d\/([a-zA-Z0-9_-]+)/)
              if (match && match[1]) {
                bidderPhotoUrl = `/api/proxy-image?id=${match[1]}`
              }
            }

            return {
              userId,
              auctionId: params.id,
              teamName,
              username,
              purseAmount,
              remainingPurse: purseAmount,
              logoUrl: null, // Team logo - will be uploaded via form
              bidderPhotoUrl // Bidder photo from player profile
            }
          })
          .filter((row): row is NonNullable<typeof row> => row !== null)

        if (bidderRows.length > 0) {
          await prisma.bidder.createMany({ data: bidderRows })
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

