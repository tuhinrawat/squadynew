import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// POST /api/analytics/[id]/upload-stats - Upload player stats and match by name
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Check for special key (same as analytics page)
    const url = new URL(request.url)
    const key = url.searchParams.get('key')
    
    if (key !== 'tushkiKILLS') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const auction = await prisma.auction.findUnique({
      where: { id: params.id },
      include: {
        players: true
      }
    })

    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }

    const { players: uploadedPlayers } = await request.json()

    if (!Array.isArray(uploadedPlayers) || uploadedPlayers.length === 0) {
      return NextResponse.json({ error: 'No player data provided' }, { status: 400 })
    }

    // Helper function to normalize player names for matching
    const normalizeName = (name: string): string => {
      if (!name || typeof name !== 'string') return ''
      return name
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ') // Multiple spaces to single space
        .replace(/[^\w\s]/g, '') // Remove special characters
    }

    // Helper function to normalize contact numbers (remove spaces, dashes, etc.)
    const normalizeContact = (contact: string | number): string => {
      if (!contact) return ''
      const contactStr = String(contact).trim()
      // Remove all non-digit characters
      return contactStr.replace(/\D/g, '')
    }

    // Helper function to find player by name and contact number (composite matching)
    const findPlayerByComposite = (
      uploadedName: string, 
      uploadedContact: string | number | undefined
    ): { player: any; matchScore: number; matchMethod: string } | null => {
      if (!uploadedName) return null
      
      const normalizedUploadedName = normalizeName(uploadedName)
      if (!normalizedUploadedName) return null
      
      const normalizedUploadedContact = uploadedContact ? normalizeContact(uploadedContact) : ''
      
      let bestMatch: { player: any; matchScore: number; matchMethod: string } | null = null
      let bestScore = 0

      for (const player of auction.players) {
        const playerData = player.data as any
        const playerName = playerData?.Name || playerData?.name || ''
        if (!playerName) continue
        
        const normalizedPlayerName = normalizeName(playerName)
        if (!normalizedPlayerName) continue

        // Get contact number from player data (try multiple possible column names)
        const playerContact = playerData?.['Contact no.'] || 
                             playerData?.['Contact No.'] || 
                             playerData?.['Contact No'] ||
                             playerData?.['Contact'] ||
                             playerData?.['Phone'] ||
                             playerData?.['Phone No.'] ||
                             playerData?.['Mobile'] ||
                             playerData?.['Mobile No.'] ||
                             playerData?.contact ||
                             playerData?.phone ||
                             playerData?.mobile ||
                             ''
        
        const normalizedPlayerContact = playerContact ? normalizeContact(playerContact) : ''

        // PRIORITY 1: Exact match on both name AND contact (100% confidence)
        if (normalizedUploadedContact && normalizedPlayerContact) {
          if (normalizedUploadedName === normalizedPlayerName && 
              normalizedUploadedContact === normalizedPlayerContact) {
            return { player, matchScore: 1.0, matchMethod: 'name+contact' }
          }
        }

        // PRIORITY 2: Contact number match (if both have contact numbers)
        if (normalizedUploadedContact && normalizedPlayerContact) {
          if (normalizedUploadedContact === normalizedPlayerContact) {
            // Contact matches, verify name similarity
            if (normalizedUploadedName === normalizedPlayerName) {
              return { player, matchScore: 0.95, matchMethod: 'contact+name' }
            }
            // Contact matches but name is different - still high confidence
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

        // PRIORITY 3: Exact name match (if no contact or contact doesn't match)
        if (normalizedUploadedName === normalizedPlayerName) {
          const score = normalizedUploadedContact && normalizedPlayerContact && 
                       normalizedUploadedContact !== normalizedPlayerContact
            ? 0.7 // Name matches but contact differs - lower confidence
            : 0.85 // Name matches, no contact info
          if (score > bestScore) {
            bestScore = score
            bestMatch = { player, matchScore: score, matchMethod: 'exact-name' }
          }
        }

        // PRIORITY 4: Fuzzy name matching (only if no exact match found)
        if (bestScore < 0.8) {
          // Check if uploaded name contains player name or vice versa
          if (normalizedUploadedName.includes(normalizedPlayerName) || 
              normalizedPlayerName.includes(normalizedUploadedName)) {
            const score = Math.min(normalizedUploadedName.length, normalizedPlayerName.length) / 
                         Math.max(normalizedUploadedName.length, normalizedPlayerName.length)
            if (score > bestScore) {
              bestScore = score
              bestMatch = { player, matchScore: score, matchMethod: 'fuzzy-name' }
            }
          }
          
          // Also check for partial word matches (e.g., "Virat Kohli" matches "Kohli")
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

      // Only return if match score is high enough (at least 70% similarity)
      return bestScore >= 0.7 ? bestMatch : null
    }

    const results = {
      matched: [] as Array<{ playerId: string; playerName: string; uploadedName: string; columnsUpdated: string[]; matchMethod: string }>,
      unmatched: [] as Array<{ uploadedName: string; reason: string }>,
      errors: [] as Array<{ uploadedName: string; error: string }>
    }

    const newColumns = new Set<string>()
    const updates: Array<{ playerId: string; data: any }> = []

    // Process each uploaded player
    for (const uploadedPlayer of uploadedPlayers) {
      const uploadedName = uploadedPlayer.Name || uploadedPlayer.name || ''
      
      if (!uploadedName) {
        results.unmatched.push({
          uploadedName: JSON.stringify(uploadedPlayer),
          reason: 'No name field found'
        })
        continue
      }

      // Get contact number from uploaded data (try multiple possible column names)
      const uploadedContact = uploadedPlayer['Contact no.'] || 
                             uploadedPlayer['Contact No.'] || 
                             uploadedPlayer['Contact No'] ||
                             uploadedPlayer['Contact'] ||
                             uploadedPlayer['Phone'] ||
                             uploadedPlayer['Phone No.'] ||
                             uploadedPlayer['Mobile'] ||
                             uploadedPlayer['Mobile No.'] ||
                             uploadedPlayer.contact ||
                             uploadedPlayer.phone ||
                             uploadedPlayer.mobile ||
                             undefined

      const match = findPlayerByComposite(uploadedName, uploadedContact)
      
      if (!match) {
        results.unmatched.push({
          uploadedName,
          reason: uploadedContact 
            ? `No matching player found (searched by name: "${uploadedName}" and contact: "${uploadedContact}")`
            : `No matching player found (searched by name: "${uploadedName}")`
        })
        continue
      }

      const { player, matchMethod } = match
      const playerData = player.data as any || {}
      const columnsUpdated: string[] = []

      // Merge uploaded data with existing player data
      // Skip name, status, and other system fields
      const systemFields = ['Name', 'name', 'status', 'id', 'playerId', 'soldPrice', 'soldTo']
      
      const updatedData = { ...playerData }
      
      for (const [key, value] of Object.entries(uploadedPlayer)) {
        if (systemFields.includes(key)) continue
        
        // Only update if value is not empty
        if (value !== null && value !== undefined && value !== '') {
          updatedData[key] = value
          columnsUpdated.push(key)
          newColumns.add(key)
        }
      }

      updates.push({
        playerId: player.id,
        data: updatedData
      })

      results.matched.push({
        playerId: player.id,
        playerName: playerData?.Name || playerData?.name || 'Unknown',
        uploadedName,
        columnsUpdated,
        matchMethod: matchMethod || 'unknown'
      })
    }

    // Update all matched players in a transaction
    if (updates.length > 0) {
      await prisma.$transaction(
        updates.map(update =>
          prisma.player.update({
            where: { id: update.playerId },
            data: { data: update.data }
          })
        )
      )
    }

    // Update analyticsVisibleColumns to include new columns
    if (newColumns.size > 0) {
      const currentColumns = (auction.analyticsVisibleColumns as string[]) || []
      const updatedColumns = Array.from(new Set([...currentColumns, ...Array.from(newColumns)]))
      
      await prisma.auction.update({
        where: { id: params.id },
        data: {
          analyticsVisibleColumns: updatedColumns
        }
      })
    }

    return NextResponse.json({
      success: true,
      results: {
        total: uploadedPlayers.length,
        matched: results.matched.length,
        unmatched: results.unmatched.length,
        matchedDetails: results.matched,
        unmatchedDetails: results.unmatched,
        newColumns: Array.from(newColumns)
      }
    })
  } catch (error) {
    console.error('Error uploading player stats:', error)
    return NextResponse.json(
      { 
        error: 'Failed to upload player stats',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

