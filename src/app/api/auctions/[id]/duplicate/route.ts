import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user?.role !== 'ADMIN') {
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

    // Create new auction with "Copy of" prefix
    const newAuction = await prisma.auction.create({
      data: {
        name: `Copy of ${sourceAuction.name}`,
        description: sourceAuction.description,
        rules: sourceAuction.rules as any,
        status: 'DRAFT',
        isPublished: false,
        registrationOpen: sourceAuction.registrationOpen,
        customFields: sourceAuction.customFields as any,
        columnOrder: sourceAuction.columnOrder as any,
        createdById: session.user.id
      }
    })

    // Copy all players (without changing their status - they all start as AVAILABLE)
    for (const player of sourceAuction.players) {
      await prisma.player.create({
        data: {
          auctionId: newAuction.id,
          data: player.data as any,
          status: 'AVAILABLE', // Reset to AVAILABLE
          isIcon: (player as any).isIcon || false
        }
      })
    }

    // Copy bidders by creating new users and bidders
    const createdBidders = []
    for (const bidder of sourceAuction.bidders) {
      // Generate a unique email by appending timestamp
      const timestamp = Date.now()
      const randomSuffix = Math.floor(Math.random() * 10000)
      const newEmail = `${bidder.user.email.split('@')[0]}_copy_${timestamp}_${randomSuffix}@squady.com`
      
      // Generate a random password
      const randomPassword = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-8)
      const hashedPassword = await bcrypt.hash(randomPassword, 10)
      
      // Create new user
      const user = await prisma.user.create({
        data: {
          email: newEmail,
          name: bidder.user.name,
          password: hashedPassword,
          role: 'BIDDER'
        }
      })

      // Create the bidder with the same settings but reset purse
      const newBidder = await prisma.bidder.create({
        data: {
          userId: user.id,
          auctionId: newAuction.id,
          teamName: bidder.teamName,
          username: `${bidder.username}_copy_${timestamp}`, // Make username unique
          purseAmount: bidder.purseAmount,
          remainingPurse: bidder.purseAmount, // Reset to full purse
          logoUrl: bidder.logoUrl
        }
      })

      createdBidders.push({
        username: newBidder.username,
        password: randomPassword,
        email: newEmail,
        name: user.name,
        teamName: newBidder.teamName
      })
    }

    return NextResponse.json({
      success: true,
      auctionId: newAuction.id,
      bidders: createdBidders,
      message: 'Auction duplicated successfully with all players and bidders.'
    })
  } catch (error) {
    console.error('Error duplicating auction:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
