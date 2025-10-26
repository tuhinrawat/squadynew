import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import bcrypt from 'bcryptjs'

// GET /api/auctions/[id]/bidders/[bidderId] - Get a specific bidder
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; bidderId: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user?.role !== 'ADMIN' && session.user?.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const bidder = await prisma.bidder.findFirst({
      where: {
        id: params.bidderId,
        auctionId: params.id,
        auction: {
          createdById: session.user.id
        }
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            createdAt: true
          }
        }
      }
    })

    if (!bidder) {
      return NextResponse.json({ error: 'Bidder not found' }, { status: 404 })
    }

    return NextResponse.json({ bidder })
  } catch (error) {
    console.error('Error fetching bidder:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/auctions/[id]/bidders/[bidderId] - Update a bidder
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string; bidderId: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user?.role !== 'ADMIN' && session.user?.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { name, teamName, email, username, password, purseAmount } = body

    // Check if bidder exists
    const existingBidder = await prisma.bidder.findFirst({
      where: {
        id: params.bidderId,
        auctionId: params.id,
        auction: {
          createdById: session.user.id
        }
      }
    })

    if (!existingBidder) {
      return NextResponse.json({ error: 'Bidder not found' }, { status: 404 })
    }

    // Check username uniqueness if changed
    if (username && username !== existingBidder.username) {
      const duplicateBidder = await prisma.bidder.findUnique({
        where: {
          auctionId_username: {
            auctionId: params.id,
            username
          }
        }
      })

      if (duplicateBidder) {
        return NextResponse.json(
          { error: 'Username already exists for this auction' },
          { status: 400 }
        )
      }
    }

    const updateData: any = {}

    // Update bidder fields
    if (teamName !== undefined) updateData.teamName = teamName || null
    if (username !== undefined) updateData.username = username
    if (purseAmount !== undefined) {
      updateData.purseAmount = Number(purseAmount)
      updateData.remainingPurse = Number(purseAmount) // Reset remaining purse
    }

    // Update user fields
    const userUpdateData: any = {}
    if (name !== undefined) userUpdateData.name = name
    if (email !== undefined) userUpdateData.email = email
    if (password !== undefined) {
      if (password.length < 6) {
        return NextResponse.json(
          { error: 'Password must be at least 6 characters' },
          { status: 400 }
        )
      }
      userUpdateData.password = await bcrypt.hash(password, 10)
    }

    // Update bidder
    if (Object.keys(updateData).length > 0) {
      await prisma.bidder.update({
        where: { id: params.bidderId },
        data: updateData
      })
    }

    // Update user
    if (Object.keys(userUpdateData).length > 0) {
      await prisma.user.update({
        where: { id: existingBidder.userId },
        data: userUpdateData
      })
    }

    // Fetch updated bidder
    const updatedBidder = await prisma.bidder.findUnique({
      where: { id: params.bidderId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            createdAt: true
          }
        }
      }
    })

    return NextResponse.json({
      message: 'Bidder updated successfully',
      bidder: updatedBidder
    })
  } catch (error) {
    console.error('Error updating bidder:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/auctions/[id]/bidders/[bidderId] - Delete a bidder
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; bidderId: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user?.role !== 'ADMIN' && session.user?.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const bidder = await prisma.bidder.findFirst({
      where: {
        id: params.bidderId,
        auctionId: params.id,
        auction: {
          createdById: session.user.id
        }
      }
    })

    if (!bidder) {
      return NextResponse.json({ error: 'Bidder not found' }, { status: 404 })
    }

    // Delete bidder (cascades to user if no other relations)
    await prisma.bidder.delete({
      where: { id: params.bidderId }
    })

    return NextResponse.json({ message: 'Bidder deleted successfully' })
  } catch (error) {
    console.error('Error deleting bidder:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
