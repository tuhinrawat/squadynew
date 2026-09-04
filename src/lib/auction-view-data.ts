// Shared shaping logic for "what does the live/public auction view need to
// render" - originally lived only in the SSR page (page.tsx), extracted here
// so the snapshot polling endpoint (for viewers not on live Pusher) computes
// stats and bid history the exact same way the initial server-rendered page
// does. Two implementations of this logic drifting apart would mean a
// polled viewer's numbers silently disagreeing with a freshly-loaded page's.

export type AuctionStats = {
  total: number
  sold: number
  unsold: number
  remaining: number
}

export type AuctionBidHistoryRecord = {
  bidderId: string
  amount: number
  timestamp: Date
  bidderName: string
  teamName?: string
  type?: 'bid' | 'sold' | 'unsold'
  playerId?: string
  playerName?: string
}

export function calculateAuctionStats(players: Array<{ status?: string | null }>): AuctionStats {
  const activePlayers = players.filter(player => player.status !== 'RETIRED')

  return activePlayers.reduce<AuctionStats>(
    (stats, player) => {
      const status = player.status ?? 'AVAILABLE'

      if (status === 'SOLD') {
        stats.sold += 1
      } else if (status === 'UNSOLD') {
        stats.unsold += 1
      } else if (status === 'AVAILABLE') {
        stats.remaining += 1
      }

      stats.total += 1
      return stats
    },
    { total: 0, sold: 0, unsold: 0, remaining: 0 }
  )
}

export function normalizeTimestamp(value: unknown): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed
    }
  }

  return new Date(0)
}

export function parseBidHistory(rawHistory: unknown): AuctionBidHistoryRecord[] {
  if (!Array.isArray(rawHistory)) {
    return []
  }

  return rawHistory.reduce<AuctionBidHistoryRecord[]>((entries, item) => {
    if (typeof item !== 'object' || item === null) {
      return entries
    }

    const record = item as Record<string, unknown>
    const playerId = typeof record.playerId === 'string' ? record.playerId : undefined
    const amount = typeof record.amount === 'number' ? record.amount : undefined
    const bidderId = typeof record.bidderId === 'string' ? record.bidderId : undefined
    const bidderName = typeof record.bidderName === 'string' ? record.bidderName : undefined
    const teamName = typeof record.teamName === 'string' ? record.teamName : undefined
    const playerName = typeof record.playerName === 'string' ? record.playerName : undefined
    const type = typeof record.type === 'string' ? record.type : undefined

    if (typeof amount !== 'number' || Number.isNaN(amount)) {
      return entries
    }

    entries.push({
      amount,
      bidderId: bidderId ?? 'unknown',
      bidderName: bidderName ?? 'Unknown Bidder',
      teamName,
      timestamp: normalizeTimestamp(record.timestamp),
      playerId,
      playerName,
      type: type === 'bid' || type === 'sold' || type === 'unsold' ? type : undefined
    })

    return entries
  }, [])
}
