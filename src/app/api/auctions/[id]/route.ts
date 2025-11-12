import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { generateSlug, ensureUniqueSlug } from '@/lib/slug'

// GET /api/auctions/[id] - Get auction details
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user?.role !== 'ADMIN' && session.user?.role !== 'SUPER_ADMIN') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Get auction details
    const auction = await prisma.auction.findFirst({
      where: {
        id: params.id,
        createdById: session.user.id
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

    if (!auction) {
      return NextResponse.json(
        { error: 'Auction not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      auction
    })

  } catch (error) {
    console.error('Error fetching auction:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// PUT /api/auctions/[id] - Update auction details
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user?.role !== 'ADMIN' && session.user?.role !== 'SUPER_ADMIN') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { name, description, image, rules, status, isPublished, registrationOpen, customFields, columnOrder, visibleColumns, analyticsVisibleColumns, scheduledStartDate } = await request.json()

    // Check if auction exists and belongs to user
    const existingAuction = await prisma.auction.findFirst({
      where: {
        id: params.id,
        createdById: session.user.id
      }
    })

    if (!existingAuction) {
      return NextResponse.json(
        { error: 'Auction not found' },
        { status: 404 }
      )
    }

    // Prepare update data
    const updateData: any = {}
    
    if (name) {
      updateData.name = name
      // Regenerate slug if name changes
      if (name !== existingAuction.name) {
        const baseSlug = generateSlug(name)
        const existingAuctions = await prisma.auction.findMany({
          where: {
            slug: {
              startsWith: baseSlug
            },
            id: {
              not: params.id // Exclude current auction
            }
          },
          select: {
            slug: true
          }
        })
        const existingSlugs = existingAuctions.map(a => a.slug).filter((s): s is string => s !== null)
        updateData.slug = ensureUniqueSlug(baseSlug, existingSlugs)
      }
    }
    if (description !== undefined) updateData.description = description
    if (image !== undefined) updateData.image = image
    if (rules) {
      // Merge rules with existing rules to preserve any fields not being updated
      const existingRules = (existingAuction.rules as any) || {}
      updateData.rules = { ...existingRules, ...rules } as any
    }
    if (status) updateData.status = status
    if (isPublished !== undefined) updateData.isPublished = isPublished
    if (registrationOpen !== undefined) updateData.registrationOpen = registrationOpen
    if (customFields !== undefined) updateData.customFields = customFields as any
    if (columnOrder !== undefined) updateData.columnOrder = columnOrder as any
    if (visibleColumns !== undefined) updateData.visibleColumns = visibleColumns as any
    if (analyticsVisibleColumns !== undefined) updateData.analyticsVisibleColumns = analyticsVisibleColumns as any
    
    // Handle scheduledStartDate safely - only include if column exists
    if (scheduledStartDate !== undefined) {
      try {
        // Only try to set if we have a valid date string or null
        if (scheduledStartDate === null || scheduledStartDate === '') {
          updateData.scheduledStartDate = null
        } else {
          const date = new Date(scheduledStartDate)
          if (!isNaN(date.getTime())) {
            updateData.scheduledStartDate = date
          }
        }
      } catch (dateError) {
        console.error('Error parsing scheduledStartDate:', dateError)
        // Don't include scheduledStartDate in update if parsing fails
      }
    }

    // Update auction
    let auction
    try {
      auction = await prisma.auction.update({
        where: {
          id: params.id
        },
        data: updateData,
        include: {
          _count: {
            select: {
              players: true,
              bidders: true
            }
          }
        }
      })
    } catch (updateError: any) {
      // If update fails and it's related to scheduledStartDate column not existing,
      // retry without that field
      if (updateError?.code === 'P2021' || updateError?.message?.includes('scheduledStartDate') || updateError?.message?.includes('does not exist')) {
        console.warn('scheduledStartDate column may not exist, retrying without it:', updateError.message)
        // Remove scheduledStartDate from update data and retry
        const { scheduledStartDate, ...updateDataWithoutDate } = updateData
        auction = await prisma.auction.update({
          where: {
            id: params.id
          },
          data: updateDataWithoutDate,
          include: {
            _count: {
              select: {
                players: true,
                bidders: true
              }
            }
          }
        })
      } else {
        // Re-throw if it's a different error
        throw updateError
      }
    }

    return NextResponse.json({
      message: 'Auction updated successfully',
      auction
    })

  } catch (error: any) {
    console.error('Error updating auction:', error)
    const errorMessage = error?.message || 'Internal server error'
    return NextResponse.json(
      { error: errorMessage, details: process.env.NODE_ENV === 'development' ? error?.stack : undefined },
      { status: 500 }
    )
  }
}

// DELETE /api/auctions/[id] - Delete auction (cascade delete players and bidders)
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user?.role !== 'ADMIN' && session.user?.role !== 'SUPER_ADMIN') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Check if auction exists and belongs to user
    const existingAuction = await prisma.auction.findFirst({
      where: {
        id: params.id,
        createdById: session.user.id
      }
    })

    if (!existingAuction) {
      return NextResponse.json(
        { error: 'Auction not found' },
        { status: 404 }
      )
    }

    // Delete related records first (ORDER MATTERS!)
    // 1. Delete players
    await prisma.player.deleteMany({
      where: { auctionId: params.id }
    })

    // 2. Delete fixtures (MUST be before bidders due to foreign key constraints)
    await prisma.fixture.deleteMany({
      where: { auctionId: params.id }
    })

    // 3. Get bidders for user cleanup
    const bidders = await prisma.bidder.findMany({
      where: { auctionId: params.id },
      select: { userId: true }
    })

    // 4. Delete bidders
    await prisma.bidder.deleteMany({
      where: { auctionId: params.id }
    })

    // 5. Delete associated users (only BIDDER role users)
    const bidderUserIds = bidders.map(b => b.userId)
    if (bidderUserIds.length > 0) {
      await prisma.user.deleteMany({
        where: {
          id: { in: bidderUserIds },
          role: 'BIDDER'
        }
      })
    }

    // 6. Finally delete the auction
    await prisma.auction.delete({
      where: {
        id: params.id
      }
    })

    return NextResponse.json({
      message: 'Auction deleted successfully'
    })

  } catch (error) {
    console.error('Error deleting auction:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
