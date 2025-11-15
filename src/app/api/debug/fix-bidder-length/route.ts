import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'

/**
 * POST /api/debug/fix-bidder-length
 * Validates retired players and backfills missing bidders
 * This ensures database consistency - every RETIRED player should have a corresponding bidder
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || (session.user?.role !== 'ADMIN' && session.user?.role !== 'SUPER_ADMIN')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const auctionId = body.auctionId

    if (!auctionId) {
      return NextResponse.json({ error: 'auctionId is required' }, { status: 400 })
    }

    // Find auction with all retired players and existing bidders
    const auction = await prisma.auction.findUnique({
      where: { id: auctionId },
      include: {
        players: {
          where: {
            status: 'RETIRED'
          },
          select: {
            id: true,
            status: true,
            data: true
          }
        },
        bidders: {
          select: {
            id: true,
            username: true,
            teamName: true
          }
        }
      }
    })

    if (!auction) {
      return NextResponse.json({ 
        error: `Auction not found`,
      }, { status: 404 })
    }

    const rules = auction.rules as any
    const purseAmount = rules?.totalPurse || 100000

    const results = []
    let createdCount = 0
    let skippedCount = 0
    let errorCount = 0

    // Get all existing bidder usernames for quick lookup
    const existingBidderUsernames = new Set(auction.bidders.map(b => b.username))

    // Process each retired player
    for (const player of auction.players) {
      const playerData = player.data as any
      const playerName = playerData?.name || playerData?.Name || 'Retired Player'
      const teamName = playerData?.['Team Name'] || playerData?.['team name'] || playerData?.teamName || playerName
      const expectedUsername = `retired_${player.id}`

      // Check if bidder already exists
      if (existingBidderUsernames.has(expectedUsername)) {
        skippedCount++
        results.push({
          playerId: player.id,
          playerName,
          teamName,
          username: expectedUsername,
          status: 'skipped',
          reason: 'Bidder already exists'
        })
        continue
      }

      try {
        // Generate credentials
        const username = expectedUsername
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

        // Get profile photo URL for bidderPhotoUrl
        const photoKeys = ['Profile Photo', 'profile photo', 'Profile photo', 'PROFILE PHOTO', 'profile_photo', 'ProfilePhoto']
        const photoValue = photoKeys.map(key => playerData?.[key]).find(v => v && String(v).trim())
        let bidderPhotoUrl = null
        if (photoValue) {
          const photoStr = String(photoValue).trim()
          // Try multiple Google Drive URL patterns
          let match = photoStr.match(/\/d\/([a-zA-Z0-9_-]+)/)
          if (!match) {
            match = photoStr.match(/[?&]id=([a-zA-Z0-9_-]+)/)
          }
          if (!match) {
            match = photoStr.match(/file\/d\/([a-zA-Z0-9_-]+)/)
          }
          if (match && match[1]) {
            bidderPhotoUrl = `/api/proxy-image?id=${match[1]}`
          }
        }

        // Create bidder
        const newBidder = await prisma.bidder.create({
          data: {
            userId: user.id,
            auctionId: auction.id,
            teamName,
            username,
            purseAmount,
            remainingPurse: purseAmount,
            logoUrl: null, // Team logo - will be uploaded via form
            bidderPhotoUrl // Bidder photo from player profile
          }
        })

        createdCount++
        results.push({
          playerId: player.id,
          playerName,
          teamName,
          bidderId: newBidder.id,
          username: newBidder.username,
          status: 'created',
          message: 'Bidder created successfully'
        })
      } catch (error) {
        errorCount++
        results.push({
          playerId: player.id,
          playerName,
          teamName,
          username: expectedUsername,
          status: 'error',
          message: error instanceof Error ? error.message : 'Unknown error'
        })
        console.error(`Failed to create bidder for player ${player.id}:`, error)
      }
    }

    return NextResponse.json({
      success: true,
      auction: {
        id: auction.id,
        name: auction.name
      },
      summary: {
        totalRetiredPlayers: auction.players.length,
        created: createdCount,
        skipped: skippedCount,
        errors: errorCount
      },
      results
    })
  } catch (error) {
    console.error('Error fixing bidder length:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const errorStack = error instanceof Error ? error.stack : undefined
    return NextResponse.json(
      { 
        error: 'Internal server error', 
        details: errorMessage,
        stack: process.env.NODE_ENV === 'development' ? errorStack : undefined
      },
      { status: 500 }
    )
  }
}

