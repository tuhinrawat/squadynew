import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const auctionName = searchParams.get('name') || 'APL Mock Run 2'

    // Find auction by name
    const auction = await prisma.auction.findFirst({
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
          // Get ALL players to find the original retired players (they might have been deleted or status changed)
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
        error: `Auction "${auctionName}" not found`,
        availableAuctions: await prisma.auction.findMany({
          select: { id: true, name: true },
          take: 10
        })
      }, { status: 404 })
    }

    // Analyze bidders and their images
    const bidderAnalysis = auction.bidders.map(bidder => {
      const isRetiredPlayer = bidder.username?.startsWith('retired_')
      let retiredPlayerMatch = null
      
      if (isRetiredPlayer) {
        const playerIdMatch = bidder.username.match(/retired_(.+)/)
        if (playerIdMatch) {
          retiredPlayerMatch = auction.players.find(p => p.id === playerIdMatch[1])
        }
      }

      // Extract photo from retired player data if exists
      let photoFromPlayerData = null
      if (retiredPlayerMatch) {
        const playerData = retiredPlayerMatch.data as any
        const photoKeys = ['Profile Photo', 'profile photo', 'Profile photo', 'PROFILE PHOTO', 'profile_photo', 'ProfilePhoto']
        const photoValue = photoKeys.map(key => playerData?.[key]).find(v => v && String(v).trim())
        if (photoValue) {
          const photoStr = String(photoValue).trim()
          const match = photoStr.match(/\/d\/([a-zA-Z0-9_-]+)/)
          if (match && match[1]) {
            photoFromPlayerData = `/api/proxy-image?id=${match[1]}`
          }
        }
      }

      return {
        bidderId: bidder.id,
        username: bidder.username,
        teamName: bidder.teamName,
        bidderName: bidder.user?.name || bidder.username,
        logoUrl: bidder.logoUrl,
        isRetiredPlayer,
        retiredPlayerMatch: retiredPlayerMatch ? {
          playerId: retiredPlayerMatch.id,
          hasPhotoInData: !!photoFromPlayerData,
          photoUrl: photoFromPlayerData
        } : null,
        hasLogoUrl: !!bidder.logoUrl,
        shouldShowPhoto: !!bidder.logoUrl || !!photoFromPlayerData
      }
    })

    return NextResponse.json({
      auction: {
        id: auction.id,
        name: auction.name,
        totalBidders: auction.bidders.length,
        retiredPlayers: auction.players.length
      },
      bidders: bidderAnalysis,
      summary: {
        totalBidders: auction.bidders.length,
        biddersWithLogoUrl: bidderAnalysis.filter(b => b.hasLogoUrl).length,
        retiredPlayerBidders: bidderAnalysis.filter(b => b.isRetiredPlayer).length,
        retiredBiddersWithPhoto: bidderAnalysis.filter(b => b.isRetiredPlayer && b.shouldShowPhoto).length,
        biddersThatShouldShowPhoto: bidderAnalysis.filter(b => b.shouldShowPhoto).length
      }
    })
  } catch (error) {
    console.error('Error checking auction bidders:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

