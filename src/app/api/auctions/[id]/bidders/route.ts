import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import bcrypt from 'bcryptjs'

// GET /api/auctions/[id]/bidders - Fetch all bidders for an auction
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user?.role !== 'ADMIN' && session.user?.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const auction = await prisma.auction.findFirst({
      where: {
        id: params.id,
        createdById: session.user.id
      }
    })

    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }

    const bidders = await prisma.bidder.findMany({
      where: {
        auctionId: params.id
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
      },
      orderBy: {
        createdAt: 'desc'
      }
    })

    return NextResponse.json({ bidders })
  } catch (error) {
    console.error('Error fetching bidders:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/auctions/[id]/bidders - Create a new bidder
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user?.role !== 'ADMIN' && session.user?.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const auction = await prisma.auction.findFirst({
      where: {
        id: params.id,
        createdById: session.user.id
      }
    })

    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }

    const body = await request.json()
    const { name, teamName, email, username, password, purseAmount, logoUrl } = body

    // Validate required fields (only name and teamName are required)
    if (!name || !teamName) {
      return NextResponse.json(
        { error: 'Bidder Name and Team Name are required' },
        { status: 400 }
      )
    }

    // Validate password length if provided
    if (password && password.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters' },
        { status: 400 }
      )
    }

    // Generate defaults for optional fields
    const finalUsername = username || `bidder_${Date.now()}_${Math.random().toString(36).substring(7)}`
    const finalEmail = email || `${finalUsername}@noemail.com`
    const finalPassword = password || Math.random().toString(36).substring(2, 10)
    const finalPurseAmount = purseAmount || 100000

    // Check if username is unique for this auction
    const existingBidder = await prisma.bidder.findUnique({
      where: {
        auctionId_username: {
          auctionId: params.id,
          username: finalUsername
        }
      }
    })

    if (existingBidder) {
      return NextResponse.json(
        { error: 'Username already exists for this auction' },
        { status: 400 }
      )
    }

    // Check if email already exists
    let user = await prisma.user.findUnique({
      where: { email: finalEmail }
    })

    if (!user) {
      // Hash password
      const hashedPassword = await bcrypt.hash(finalPassword, 10)

      // Create user
      user = await prisma.user.create({
        data: {
          email: finalEmail,
          name,
          password: hashedPassword,
          // role defaults to ADMIN in schema, but we want BIDDER
        }
      })
    }

    // Update user role to BIDDER if not already
    if (user.role !== 'BIDDER') {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { role: 'BIDDER' }
      })
    }

    // Create bidder
    const bidder = await prisma.bidder.create({
      data: {
        userId: user.id,
        auctionId: params.id,
        teamName: teamName,
        username: finalUsername,
        purseAmount: Number(finalPurseAmount),
        remainingPurse: Number(finalPurseAmount),
        logoUrl: logoUrl || null
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

    return NextResponse.json({
      message: 'Bidder created successfully',
      bidder: {
        ...bidder,
        username: finalUsername,
        password: finalPassword // Return password so admin can share it
      }
    })
  } catch (error) {
    console.error('Error creating bidder:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
