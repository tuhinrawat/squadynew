// Shared shape + localStorage plumbing for the offline auction fallback.
// The live admin console writes a snapshot here on every state change (see
// the mirror effect in admin-auction-view.tsx); the standalone offline page
// (src/app/auction/[id]/offline) reads it and writes back pending results
// entirely client-side, with no network calls, so it keeps working even if
// the server itself is unreachable.

export interface OfflinePlayerSnapshot {
  id: string
  data: Record<string, unknown>
  status: 'AVAILABLE' | 'SOLD' | 'UNSOLD' | 'RETIRED'
  isIcon: boolean
  soldTo: string | null
  soldPrice: number | null
}

export interface OfflineBidderSnapshot {
  id: string
  username: string
  teamName: string | null
  name: string | null
  remainingPurse: number
}

export interface OfflineAuctionSnapshot {
  auctionId: string
  auctionName: string
  savedAt: string
  players: OfflinePlayerSnapshot[]
  bidders: OfflineBidderSnapshot[]
}

export interface OfflineResult {
  id: string // client-generated, used for idempotent replay
  playerId: string
  playerName: string
  status: 'SOLD' | 'UNSOLD'
  bidderId?: string
  bidderName?: string
  amount?: number
  recordedAt: string
}

const snapshotKey = (auctionId: string) => `squady-offline-snapshot-${auctionId}`
const pendingKey = (auctionId: string) => `squady-offline-pending-${auctionId}`
const currentPlayerKey = (auctionId: string) => `squady-offline-current-${auctionId}`

export function saveOfflineSnapshot(snapshot: OfflineAuctionSnapshot) {
  try {
    localStorage.setItem(snapshotKey(snapshot.auctionId), JSON.stringify(snapshot))
  } catch {
    // Storage can fail (private browsing, quota) - mirroring is a
    // best-effort safety net, not something that should ever break the
    // live console if it fails.
  }
}

export function loadOfflineSnapshot(auctionId: string): OfflineAuctionSnapshot | null {
  try {
    const raw = localStorage.getItem(snapshotKey(auctionId))
    return raw ? (JSON.parse(raw) as OfflineAuctionSnapshot) : null
  } catch {
    return null
  }
}

export function loadPendingResults(auctionId: string): OfflineResult[] {
  try {
    const raw = localStorage.getItem(pendingKey(auctionId))
    return raw ? (JSON.parse(raw) as OfflineResult[]) : []
  } catch {
    return []
  }
}

export function savePendingResults(auctionId: string, results: OfflineResult[]) {
  try {
    localStorage.setItem(pendingKey(auctionId), JSON.stringify(results))
  } catch {
    // Same rationale as saveOfflineSnapshot.
  }
}

export function clearPendingResults(auctionId: string) {
  try {
    localStorage.removeItem(pendingKey(auctionId))
  } catch {
    // Same rationale as saveOfflineSnapshot.
  }
}

// Which player is "on the block" right now in the offline console - the
// auction decides this, not the admin (see pickRandomPlayer below), so it's
// persisted the same way the pending queue is: it has to survive this page
// staying open, untouched, for however long an outage lasts.
export function saveCurrentOfflinePlayer(auctionId: string, playerId: string | null) {
  try {
    if (playerId) localStorage.setItem(currentPlayerKey(auctionId), playerId)
    else localStorage.removeItem(currentPlayerKey(auctionId))
  } catch {
    // Same rationale as saveOfflineSnapshot.
  }
}

export function loadCurrentOfflinePlayer(auctionId: string): string | null {
  try {
    return localStorage.getItem(currentPlayerKey(auctionId))
  } catch {
    return null
  }
}

// Mirrors the exact rule the live auction's mark-sold/next-player routes
// use server-side (see src/app/api/auction/[id]/mark-sold/route.ts): icon
// ("Bidder Choice") players are auctioned first as a group, in random order;
// only once none remain does the pool open up to regular players, also in
// random order. An admin picking whichever player they like off a list -
// the offline console's original behavior - isn't an auction, it's a
// negotiation; this keeps the same random, icon-first rule offline that the
// live app enforces online, so which mode you're in doesn't change how a
// player's turn comes up.
export function pickRandomPlayer<T extends { isIcon: boolean }>(available: T[]): T | null {
  if (available.length === 0) return null
  const iconPlayers = available.filter(p => p.isIcon)
  const pool = iconPlayers.length > 0 ? iconPlayers : available.filter(p => !p.isIcon)
  if (pool.length === 0) return null
  return pool[Math.floor(Math.random() * pool.length)]
}
