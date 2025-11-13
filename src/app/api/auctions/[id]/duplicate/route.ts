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

    // Create new auction with "Copy of" prefix - copy all relevant fields
    const newAuction = await prisma.auction.create({
      data: {
        name: `Copy of ${sourceAuction.name}`,
        description: sourceAuction.description,
        image: sourceAuction.image, // Copy auction image
        rules: sourceAuction.rules as any,
        status: 'DRAFT',
        isPublished: false,
        registrationOpen: sourceAuction.registrationOpen,
        customFields: sourceAuction.customFields as any,
        columnOrder: sourceAuction.columnOrder as any,
        visibleColumns: sourceAuction.visibleColumns as any,
        analyticsVisibleColumns: sourceAuction.analyticsVisibleColumns as any,
        scheduledStartDate: sourceAuction.scheduledStartDate, // Copy scheduled start date
        createdById: session.user.id
      }
    })

    // Copy all players - preserve RETIRED status for retired players, reset others to AVAILABLE
    const playerMap = new Map<string, string>() // Map old player ID to new player ID
    for (const player of sourceAuction.players) {
      const newPlayer = await prisma.player.create({
        data: {
          auctionId: newAuction.id,
          data: player.data as any,
          status: player.status === 'RETIRED' ? 'RETIRED' : 'AVAILABLE', // Keep RETIRED status, reset others
          isIcon: (player as any).isIcon || false
        }
      })
      playerMap.set(player.id, newPlayer.id)
    }

    // Copy bidders by reusing existing users (bidders are unique per auction)
    // For retired player bidders, we need to update their username to point to the new player ID
    const createdBidders = []
    const failedBidders = []
    
    for (const bidder of sourceAuction.bidders) {
      try {
        // Check if this is a retired player bidder
        const isRetiredPlayerBidder = bidder.username?.startsWith('retired_')
        let newUsername = bidder.username
        
        if (isRetiredPlayerBidder) {
          // Extract old player ID from username (format: retired_<playerId>)
          const playerIdMatch = bidder.username.match(/retired_(.+)/)
          if (playerIdMatch) {
            const oldPlayerId = playerIdMatch[1]
            const newPlayerId = playerMap.get(oldPlayerId)
            if (newPlayerId) {
              // Update username to point to new player ID
              newUsername = `retired_${newPlayerId}`
            }
          }
        }

        // Create new bidder record with the same user, reset purse
        const newBidder = await prisma.bidder.create({
          data: {
            userId: bidder.userId, // Reuse the same user
            auctionId: newAuction.id,
            teamName: bidder.teamName,
            username: newUsername, // Updated username for retired players, same for others
            purseAmount: bidder.purseAmount,
            remainingPurse: bidder.purseAmount, // Reset to full purse
            logoUrl: bidder.logoUrl, // Copy team logo
            bidderPhotoUrl: bidder.bidderPhotoUrl // Copy bidder photo (for retired players)
          }
        })
        createdBidders.push(newBidder)
      } catch (error: any) {
        console.error(`Failed to duplicate bidder ${bidder.id} (${bidder.username}):`, error)
        failedBidders.push({
          bidderId: bidder.id,
          username: bidder.username,
          teamName: bidder.teamName,
          error: error.message || 'Unknown error'
        })
      }
    }

    return NextResponse.json({
      success: true,
      auctionId: newAuction.id,
      message: `Auction duplicated successfully. ${createdBidders.length} bidders copied${failedBidders.length > 0 ? `, ${failedBidders.length} failed` : ''}. All bidders retain their original credentials and can access the new auction.`,
      stats: {
        playersCopied: sourceAuction.players.length,
        biddersCopied: createdBidders.length,
        biddersFailed: failedBidders.length
      },
      failedBidders: failedBidders.length > 0 ? failedBidders : undefined
    })
  } catch (error) {
    console.error('Error duplicating auction:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
