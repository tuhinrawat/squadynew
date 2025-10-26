import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'

// POST /api/auctions/[id]/players/upload - Upload multiple players from Excel/CSV
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

    const { players, clearExisting = false, columnOrder } = await request.json()

    if (!Array.isArray(players) || players.length === 0) {
      return NextResponse.json({ error: 'No players data provided' }, { status: 400 })
    }

    // Validate that all players have data
    const validPlayers = players.filter(player => 
      player && typeof player === 'object' && Object.keys(player).length > 0
    )

    if (validPlayers.length === 0) {
      return NextResponse.json({ error: 'No valid player data found' }, { status: 400 })
    }

    // Extract column order from first player if not provided
    let finalColumnOrder = columnOrder || (validPlayers.length > 0 ? Object.keys(validPlayers[0]) : [])
    
    // Ensure finalColumnOrder is an array of strings
    if (!Array.isArray(finalColumnOrder)) {
      finalColumnOrder = validPlayers.length > 0 ? Object.keys(validPlayers[0]) : []
    }

    // Update column order in auction (as JSON array) - Do this early
    try {
      await prisma.auction.update({
        where: { id: params.id },
        data: { columnOrder: finalColumnOrder as any }
      })
    } catch (updateError) {
      console.error('Error updating column order:', updateError)
      // Continue anyway, column order update is not critical
    }

    // Clear existing players if requested
    if (clearExisting) {
      await prisma.player.deleteMany({
        where: {
          auctionId: params.id
        }
      })
    }

    // Check for duplicates against existing players
    const existingPlayers = await prisma.player.findMany({
      where: {
        auctionId: params.id
      },
      select: {
        data: true
      }
    })

    // Create a function to check if two player objects are duplicates
    const arePlayersDuplicate = (player1: any, player2: any): boolean => {
      const keys1 = Object.keys(player1).sort()
      const keys2 = Object.keys(player2).sort()
      
      // Must have same number of fields
      if (keys1.length !== keys2.length) return false
      
      // All field names must match
      if (!keys1.every(key => keys2.includes(key))) return false
      
      // All field values must match
      return keys1.every(key => {
        const val1 = player1[key]
        const val2 = player2[key]
        
        // Handle null/undefined
        if (val1 == null && val2 == null) return true
        if (val1 == null || val2 == null) return false
        
        // Convert to strings for comparison
        return String(val1).trim().toLowerCase() === String(val2).trim().toLowerCase()
      })
    }

    // Filter out duplicates
    const uniquePlayers = validPlayers.filter(newPlayer => {
      return !existingPlayers.some(existingPlayer => 
        arePlayersDuplicate(newPlayer, existingPlayer.data)
      )
    })

    const duplicateCount = validPlayers.length - uniquePlayers.length

    if (uniquePlayers.length === 0) {
      return NextResponse.json({ 
        error: 'All players are duplicates of existing players',
        duplicateCount,
        totalCount: validPlayers.length
      }, { status: 400 })
    }

    // Create players in batch
    const createdPlayers = await prisma.player.createMany({
      data: uniquePlayers.map(playerData => ({
        auctionId: params.id,
        data: playerData as any,
        status: 'AVAILABLE'
      }))
    })

    return NextResponse.json({ 
      message: `${createdPlayers.count} players uploaded successfully${duplicateCount > 0 ? ` (${duplicateCount} duplicates skipped)` : ''}`,
      count: createdPlayers.count,
      duplicateCount,
      totalCount: validPlayers.length,
      columnOrder: finalColumnOrder
    })
  } catch (error) {
    console.error('Error uploading players:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 })
  }
}
