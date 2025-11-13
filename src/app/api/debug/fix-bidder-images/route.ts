import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'

/**
 * POST /api/debug/fix-bidder-images
 * Backfills logoUrl for bidders created from retired players
 * This fixes the issue where logoUrl was null when players were retired
 * 
 * NOTE: This endpoint works on published auctions since it only updates logoUrl
 * (a data correction, not a structural change that would affect auction integrity)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || (session.user?.role !== 'ADMIN' && session.user?.role !== 'SUPER_ADMIN')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const auctionId = body.auctionId
    const auctionName = body.auctionName || 'APL Mock Run 2'

    // Find auction
    const auction = auctionId
      ? await prisma.auction.findUnique({
          where: { id: auctionId },
          include: {
            bidders: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true
                  }
                }
              }
            },
            players: {
              // Get ALL players to find the original retired players
              select: {
                id: true,
                status: true,
                data: true
              }
            }
          }
        })
      : await prisma.auction.findFirst({
          where: {
            name: {
              contains: auctionName,
              mode: 'insensitive'
            }
          },
          include: {
            bidders: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true
                  }
                }
              }
            },
            players: {
              select: {
                id: true,
                status: true,
                data: true
              }
            }
          }
        })

    if (!auction) {
      return NextResponse.json({ 
        error: `Auction not found`,
      }, { status: 404 })
    }

    // Log auction status for debugging
    console.log(`Fixing bidder images for auction: ${auction.id}, Published: ${auction.isPublished}, Status: ${(auction as any).status}`)

    const results = []
    let fixedCount = 0
    let skippedCount = 0
    let errorCount = 0

    // Process each bidder
    for (const bidder of auction.bidders) {
      // Process ALL retired player bidders, even if they already have a logoUrl
      // This ensures we replace team logos with bidder photos
      const isRetired = bidder.username?.startsWith('retired_') || false
      
      // Debug logging
      console.log(`Bidder ${bidder.id}: username="${bidder.username}", isRetired=${isRetired}, currentLogoUrl="${bidder.logoUrl}"`)
      
      // Skip non-retired bidders
      if (!isRetired) {
        skippedCount++
        results.push({
          bidderId: bidder.id,
          username: bidder.username,
          teamName: bidder.teamName,
          status: 'skipped',
          reason: 'Not a retired player bidder',
          logoUrl: bidder.logoUrl
        })
        continue
      }

      try {
        // Extract player ID from username (format: retired_<playerId>)
        const playerIdMatch = bidder.username.match(/retired_(.+)/)
        if (!playerIdMatch) {
          errorCount++
          results.push({
            bidderId: bidder.id,
            username: bidder.username,
            status: 'error',
            message: 'Could not extract player ID from username'
          })
          continue
        }

        const playerId = playerIdMatch[1]

        // Find the player (even if status is not RETIRED anymore)
        const player = auction.players.find(p => p.id === playerId)

        if (!player) {
          errorCount++
          results.push({
            bidderId: bidder.id,
            username: bidder.username,
            playerId,
            status: 'error',
            message: 'Player not found in auction'
          })
          continue
        }

        // Extract photo from player data
        const playerData = player.data as any
        const photoKeys = ['Profile Photo', 'profile photo', 'Profile photo', 'PROFILE PHOTO', 'profile_photo', 'ProfilePhoto']
        const photoValue = photoKeys.map(key => playerData?.[key]).find(v => v && String(v).trim())

        if (!photoValue) {
          errorCount++
          results.push({
            bidderId: bidder.id,
            username: bidder.username,
            playerId,
            status: 'error',
            message: 'No profile photo found in player data',
            debug: { availableKeys: Object.keys(playerData || {}) }
          })
          continue
        }

        // Convert to proxy URL - try multiple patterns
        const photoStr = String(photoValue).trim()
        let fileId: string | null = null
        
        // Try pattern 1: /d/FILE_ID
        let match = photoStr.match(/\/d\/([a-zA-Z0-9_-]+)/)
        if (match && match[1]) {
          fileId = match[1]
        }
        
        // Try pattern 2: ?id=FILE_ID or &id=FILE_ID
        if (!fileId) {
          match = photoStr.match(/[?&]id=([a-zA-Z0-9_-]+)/)
          if (match && match[1]) {
            fileId = match[1]
          }
        }
        
        // Try pattern 3: Direct Google Drive URL with file/d/FILE_ID
        if (!fileId) {
          match = photoStr.match(/file\/d\/([a-zA-Z0-9_-]+)/)
          if (match && match[1]) {
            fileId = match[1]
          }
        }
        
        if (!fileId) {
          errorCount++
          results.push({
            bidderId: bidder.id,
            username: bidder.username,
            playerId,
            status: 'error',
            message: 'Could not extract Google Drive file ID from photo URL',
            debug: { photoValue: photoStr.substring(0, 100) } // First 100 chars for debugging
          })
          continue
        }

        const bidderPhotoUrl = `/api/proxy-image?id=${fileId}`

        // Check if bidderPhotoUrl is different from current (to avoid unnecessary updates)
        const currentBidderPhotoUrl = bidder.bidderPhotoUrl || null
        const isDifferent = bidderPhotoUrl !== currentBidderPhotoUrl

        // Update bidder with bidderPhotoUrl (NOT logoUrl - logoUrl is for team logo from form upload)
        // This works for published auctions since we're only updating bidderPhotoUrl (data correction, not structural change)
        try {
          await prisma.bidder.update({
            where: { id: bidder.id },
            data: { bidderPhotoUrl }
          })
          
          fixedCount++
          results.push({
            bidderId: bidder.id,
            username: bidder.username,
            playerId,
            teamName: bidder.teamName,
            oldBidderPhotoUrl: currentBidderPhotoUrl,
            newBidderPhotoUrl: bidderPhotoUrl,
            teamLogoUrl: bidder.logoUrl, // Keep team logo separate
            wasUpdated: isDifferent,
            status: isDifferent ? 'fixed' : 'already-correct'
          })
        } catch (updateError) {
          // If update fails, log the error and continue
          console.error(`Failed to update bidder ${bidder.id}:`, updateError)
          errorCount++
          results.push({
            bidderId: bidder.id,
            username: bidder.username,
            playerId,
            status: 'error',
            message: `Database update failed: ${updateError instanceof Error ? updateError.message : 'Unknown error'}`
          })
          continue
        }
      } catch (error) {
        errorCount++
        results.push({
          bidderId: bidder.id,
          username: bidder.username,
          status: 'error',
          message: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }

    return NextResponse.json({
      success: true,
      auction: {
        id: auction.id,
        name: auction.name
      },
      summary: {
        totalBidders: auction.bidders.length,
        fixed: fixedCount,
        skipped: skippedCount,
        errors: errorCount
      },
      results
    })
  } catch (error) {
    console.error('Error fixing bidder images:', error)
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

