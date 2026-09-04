import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'
import { extractCricheroesLink, normalizeCricheroesLink } from '@/lib/cricheroes'
import { Player } from '@prisma/client'

// POST /api/auctions/[id]/players/upload-stats - Import a separate stats
// sheet (name, Cricheroes profile, Batting_*/Bowling_* columns) and merge it
// into this auction's existing players' data. Matches by Cricheroes profile
// link first (reliable, since it's a stable id rather than free text), and
// only falls back to name+contact fuzzy matching for rows with no link or
// no link match - same composite algorithm already proven in the analytics
// stats importer (src/app/api/analytics/[id]/upload-stats/route.ts).
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || (session.user?.role !== 'ADMIN' && session.user?.role !== 'SUPER_ADMIN')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const auction = await prisma.auction.findFirst({
      where: { id: params.id, createdById: session.user.id },
      include: { players: true },
    })

    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }

    const { players: uploadedPlayers } = await request.json()

    if (!Array.isArray(uploadedPlayers) || uploadedPlayers.length === 0) {
      return NextResponse.json({ error: 'No player data provided' }, { status: 400 })
    }

    const normalizeName = (name: string): string => {
      if (!name || typeof name !== 'string') return ''
      return name.toLowerCase().trim().replace(/\s+/g, ' ').replace(/[^\w\s]/g, '')
    }

    const normalizeContact = (contact: string | number): string => {
      if (!contact) return ''
      return String(contact).trim().replace(/\D/g, '')
    }

    const CONTACT_KEYS = [
      'Contact no.', 'Contact No.', 'Contact No', 'Contact',
      'Phone', 'Phone No.', 'Mobile', 'Mobile No.', 'contact', 'phone', 'mobile',
    ]
    const getContact = (row: Record<string, unknown>): string | number | undefined => {
      for (const key of CONTACT_KEYS) {
        const value = row[key]
        if (value !== undefined && value !== null && value !== '') return value as string | number
      }
      return undefined
    }

    // Name+contact composite matching - identical algorithm to the
    // analytics stats importer, used here only as a fallback when a row
    // has no Cricheroes link (or its link doesn't match anyone).
    const findPlayerByComposite = (
      uploadedName: string,
      uploadedContact: string | number | undefined
    ): { player: Player; matchScore: number; matchMethod: string } | null => {
      if (!uploadedName) return null
      const normalizedUploadedName = normalizeName(uploadedName)
      if (!normalizedUploadedName) return null
      const normalizedUploadedContact = uploadedContact ? normalizeContact(uploadedContact) : ''

      let bestMatch: { player: Player; matchScore: number; matchMethod: string } | null = null
      let bestScore = 0

      for (const player of auction.players) {
        const playerData = player.data as Record<string, unknown>
        const playerName = String(playerData?.Name || playerData?.name || '')
        if (!playerName) continue
        const normalizedPlayerName = normalizeName(playerName)
        if (!normalizedPlayerName) continue

        const playerContact = getContact(playerData)
        const normalizedPlayerContact = playerContact ? normalizeContact(playerContact) : ''

        if (normalizedUploadedContact && normalizedPlayerContact) {
          if (normalizedUploadedName === normalizedPlayerName && normalizedUploadedContact === normalizedPlayerContact) {
            return { player, matchScore: 1.0, matchMethod: 'name+contact' }
          }
          if (normalizedUploadedContact === normalizedPlayerContact) {
            if (normalizedUploadedName === normalizedPlayerName) {
              return { player, matchScore: 0.95, matchMethod: 'contact+name' }
            }
            const nameScore = Math.min(normalizedUploadedName.length, normalizedPlayerName.length) /
              Math.max(normalizedUploadedName.length, normalizedPlayerName.length)
            if (nameScore > 0.5) {
              const score = 0.9 * nameScore
              if (score > bestScore) {
                bestScore = score
                bestMatch = { player, matchScore: score, matchMethod: 'contact+similar-name' }
              }
            }
          }
        }

        if (normalizedUploadedName === normalizedPlayerName) {
          const score = normalizedUploadedContact && normalizedPlayerContact && normalizedUploadedContact !== normalizedPlayerContact
            ? 0.7
            : 0.85
          if (score > bestScore) {
            bestScore = score
            bestMatch = { player, matchScore: score, matchMethod: 'exact-name' }
          }
        }

        if (bestScore < 0.8) {
          if (normalizedUploadedName.includes(normalizedPlayerName) || normalizedPlayerName.includes(normalizedUploadedName)) {
            const score = Math.min(normalizedUploadedName.length, normalizedPlayerName.length) /
              Math.max(normalizedUploadedName.length, normalizedPlayerName.length)
            if (score > bestScore) {
              bestScore = score
              bestMatch = { player, matchScore: score, matchMethod: 'fuzzy-name' }
            }
          }

          const uploadedWords = normalizedUploadedName.split(' ').filter(w => w.length > 2)
          const playerWords = normalizedPlayerName.split(' ').filter(w => w.length > 2)
          if (uploadedWords.length > 0 && playerWords.length > 0) {
            const matchingWords = uploadedWords.filter(w => playerWords.includes(w))
            if (matchingWords.length > 0) {
              const wordScore = matchingWords.length / Math.max(uploadedWords.length, playerWords.length)
              if (wordScore > bestScore) {
                bestScore = wordScore
                bestMatch = { player, matchScore: wordScore, matchMethod: 'word-match' }
              }
            }
          }
        }
      }

      return bestScore >= 0.7 ? bestMatch : null
    }

    // Cricheroes-link lookup, built once from the current auction's players.
    const playersByLink = new Map<string, Player>()
    for (const player of auction.players) {
      const link = normalizeCricheroesLink(extractCricheroesLink(player.data as Record<string, unknown>))
      if (link && !playersByLink.has(link)) {
        playersByLink.set(link, player)
      }
    }

    const results = {
      matched: [] as Array<{ playerId: string; playerName: string; uploadedName: string; columnsUpdated: string[]; matchMethod: string }>,
      unmatched: [] as Array<{ uploadedName: string; reason: string }>,
    }

    const newColumns = new Set<string>()
    const updates: Array<{ playerId: string; data: Record<string, unknown> }> = []
    const systemFields = ['Name', 'name', 'status', 'id', 'playerId', 'soldPrice', 'soldTo']

    for (const uploadedPlayer of uploadedPlayers as Record<string, unknown>[]) {
      const uploadedName = String(uploadedPlayer.Name || uploadedPlayer.name || '')
      const uploadedLink = normalizeCricheroesLink(extractCricheroesLink(uploadedPlayer))

      let player: Player | undefined = uploadedLink ? playersByLink.get(uploadedLink) : undefined
      let matchMethod: string = player ? 'cricheroes-link' : ''

      if (!player) {
        if (!uploadedName) {
          results.unmatched.push({
            uploadedName: JSON.stringify(uploadedPlayer),
            reason: 'No Cricheroes link or name field found',
          })
          continue
        }

        const uploadedContact = getContact(uploadedPlayer)
        const match = findPlayerByComposite(uploadedName, uploadedContact)
        if (!match) {
          results.unmatched.push({
            uploadedName,
            reason: uploadedLink
              ? `Cricheroes link didn't match any player, and no name/contact match found either (name: "${uploadedName}")`
              : `No Cricheroes link in this row, and no matching player found by name${uploadedContact ? ' and contact' : ''} ("${uploadedName}")`,
          })
          continue
        }
        player = match.player
        matchMethod = match.matchMethod
      }

      const playerData = (player.data as Record<string, unknown>) || {}
      const columnsUpdated: string[] = []
      const updatedData = { ...playerData }

      for (const [key, value] of Object.entries(uploadedPlayer)) {
        if (systemFields.includes(key)) continue
        if (value !== null && value !== undefined && value !== '') {
          updatedData[key] = value
          columnsUpdated.push(key)
          newColumns.add(key)
        }
      }

      updates.push({ playerId: player.id, data: updatedData })
      results.matched.push({
        playerId: player.id,
        playerName: String(playerData?.Name || playerData?.name || 'Unknown'),
        uploadedName: uploadedName || '(matched by Cricheroes link)',
        columnsUpdated,
        matchMethod,
      })
    }

    // Independent per-player updates, not $transaction - Prisma Accelerate's
    // extension typings don't support this array form well (a known
    // limitation elsewhere in this codebase), and strict atomicity isn't
    // needed for a stats merge: a partial failure just means re-running the
    // import fixes it.
    await Promise.all(
      updates.map(update =>
        prisma.player.update({ where: { id: update.playerId }, data: { data: update.data } })
      )
    )

    return NextResponse.json({
      success: true,
      results: {
        total: uploadedPlayers.length,
        matched: results.matched.length,
        unmatched: results.unmatched.length,
        matchedDetails: results.matched,
        unmatchedDetails: results.unmatched,
        newColumns: Array.from(newColumns),
      },
    })
  } catch (error) {
    console.error('Error uploading player stats:', error)
    return NextResponse.json(
      { error: 'Failed to upload player stats', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
