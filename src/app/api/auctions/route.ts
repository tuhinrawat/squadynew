import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { generateSlug, ensureUniqueSlug } from '@/lib/slug'

// GET /api/auctions - Fetch all auctions for logged-in admin user
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || (session.user?.role !== 'ADMIN' && session.user?.role !== 'SUPER_ADMIN')) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const auctions = await prisma.auction.findMany({
      where: {
        createdById: session.user.id
      },
      orderBy: {
        createdAt: 'desc'
      },
      include: {
        _count: {
          select: {
            players: true,
            bidders: true
          }
        }
      }
    })

    // Add caching headers for better performance
    const response = NextResponse.json({ auctions })
    response.headers.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=120')
    
    return response

  } catch (error) {
    console.error('Error fetching auctions:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST /api/auctions - Create new auction with rules stored in Json field
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || (session.user?.role !== 'ADMIN' && session.user?.role !== 'SUPER_ADMIN')) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { name, description, rules, isPublished, registrationOpen, scheduledStartDate } = await request.json()

    // Validate input
    if (!name || !rules) {
      return NextResponse.json(
        { error: 'Name and rules are required' },
        { status: 400 }
      )
    }

    if (!rules.minBidIncrement || !rules.countdownSeconds) {
      return NextResponse.json(
        { error: 'minBidIncrement and countdownSeconds are required' },
        { status: 400 }
      )
    }

    // Verify user exists in database
    const dbUser = await prisma.user.findUnique({
      where: { id: session.user.id }
    })

    if (!dbUser) {
      return NextResponse.json(
        { error: 'User not found. Please sign in again.' },
        { status: 404 }
      )
    }

    // Generate a unique slug from the auction name
    const baseSlug = generateSlug(name)
    const existingAuctions = await prisma.auction.findMany({
      where: {
        slug: {
          startsWith: baseSlug
        }
      },
      select: {
        slug: true
      }
    })
    const existingSlugs = existingAuctions.map(a => a.slug).filter((s): s is string => s !== null)
    const uniqueSlug = ensureUniqueSlug(baseSlug, existingSlugs)

    // Create auction
    const auctionData: any = {
      name,
      slug: uniqueSlug,
      description: description || null,
      rules: rules as any, // Store as JSON
      isPublished: isPublished || false,
      registrationOpen: registrationOpen !== false, // Default to true
      createdById: session.user.id,
      status: 'DRAFT'
    }
    
    // Only include scheduledStartDate if it's provided
    if (scheduledStartDate) {
      auctionData.scheduledStartDate = new Date(scheduledStartDate)
    }
    
    // Check if scheduledStartDate is being set and handle database schema mismatch
    // If scheduledStartDate column doesn't exist, we need to exclude it
    const auction = await prisma.auction.create({
      data: auctionData,
      include: {
        _count: {
          select: {
            players: true,
            bidders: true
          }
        }
      }
    }).catch(async (error: any) => {
      // Handle case where scheduledStartDate column doesn't exist in database
      if (error?.code === 'P2022' && (error?.meta?.column === 'scheduledStartDate' || error?.meta?.column === 'auctions.scheduledStartDate')) {
        console.error('⚠️ scheduledStartDate column does not exist in database.')
        console.error('📝 Please run this command to add the column: npx prisma db push')
        console.error('📝 Or apply the migration: npx prisma migrate deploy')
        
        // Remove scheduledStartDate and try again
        const { scheduledStartDate: _, ...dataWithoutDate } = auctionData
        return await prisma.auction.create({
          data: dataWithoutDate,
          include: {
            _count: {
              select: {
                players: true,
                bidders: true
              }
            }
          }
        })
      }
      throw error
    })

    return NextResponse.json({
      message: 'Auction created successfully',
      auction
    })

  } catch (error) {
    console.error('Error creating auction:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
