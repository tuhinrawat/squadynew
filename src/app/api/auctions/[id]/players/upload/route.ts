import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { cleanCricheroesLinksInPlayerData } from '@/lib/cricheroes'

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
    const validPlayers = players
      .filter(player =>
        player && typeof player === 'object' && Object.keys(player).length > 0
      )
      // Uploaded sheets often have this column as free text someone pasted
      // a link into, with junk before/after it - strip down to just the
      // https://... URL before it's stored, rather than only cleaning it up
      // at display/match time.
      .map(cleanCricheroesLinksInPlayerData)

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

    // A canonical string for a player row: same field set + same normalized
    // values (case/whitespace-insensitive) always produce the same
    // signature, regardless of key order - so "is this a duplicate" becomes
    // a Set lookup instead of comparing every uploaded row against every
    // existing player field-by-field. That O(n*m) comparison was fine for a
    // few hundred players but visibly slow re-uploading a large roster
    // against an already-large existing one. Keys/values are joined with
    // delimiters (not bare concatenation) so a different key/value split -
    // e.g. key "a" value "bc" vs key "ab" value "c" - can never collide into
    // the same signature string.
    const computeSignature = (player: Record<string, unknown>): string => {
      const keys = Object.keys(player).sort()
      return keys
        .map(key => {
          const val = player[key]
          const normalized = val == null ? '<null>' : String(val).trim().toLowerCase()
          return `${JSON.stringify(key)}=${JSON.stringify(normalized)};`
        })
        .join('')
    }

    const existingSignatures = new Set(
      existingPlayers.map(p => computeSignature(p.data as Record<string, unknown>))
    )

    // Filter out duplicates
    const uniquePlayers = validPlayers.filter(newPlayer => !existingSignatures.has(computeSignature(newPlayer)))

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
