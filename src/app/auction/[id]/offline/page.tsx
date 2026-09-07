'use client'

// Offline fallback console. Deliberately makes ZERO network calls except the
// one explicit "Sync to Live Auction" action - it has to keep working even
// if the Squady server itself is unreachable, which means it can only ever
// read/write this browser's localStorage (see src/lib/offline-auction-store.ts).
//
// This only works if the tab was already open (or at least loaded once)
// before the outage started - a dead server can't serve this page fresh
// either. The operational habit this is built around: open this page in a
// second tab at the start of every auction, and never refresh it.

import { useEffect, useMemo, useRef, useState } from 'react'
import PlayerCard from '@/components/player-card'
import {
  OfflineAuctionSnapshot,
  OfflineResult,
  loadOfflineSnapshot,
  loadPendingResults,
  savePendingResults
} from '@/lib/offline-auction-store'
import { useConnectivityBeacon } from '@/hooks/use-connectivity-beacon'

type PlayerData = Record<string, unknown> | null | undefined

function extractName(data: PlayerData): string {
  return (data?.name as string) || (data?.Name as string) || (data?.player_name as string) || 'Unknown Player'
}

function extractImageUrl(data: PlayerData): string | undefined {
  const keys = ['Profile Photo', 'profile photo', 'Profile photo', 'PROFILE PHOTO', 'profile_photo', 'ProfilePhoto']
  const value = keys.map(key => data?.[key]).find(v => v && String(v).trim())
  if (!value) return undefined
  const photoStr = String(value).trim()
  let match = photoStr.match(/\/d\/([a-zA-Z0-9_-]+)/)
  if (match?.[1]) return `/api/proxy-image?id=${match[1]}`
  match = photoStr.match(/[?&]id=([a-zA-Z0-9_-]+)/)
  if (match?.[1]) return `/api/proxy-image?id=${match[1]}`
  if (photoStr.startsWith('http://') || photoStr.startsWith('https://')) return photoStr
  return undefined
}

function extractFields(data: PlayerData) {
  const essentials: Array<{ label: string; value: string }> = []
  const add = (label: string, keys: string[]) => {
    for (const key of keys) {
      const v = data?.[key]
      if (v) {
        essentials.push({ label, value: String(v) })
        return
      }
    }
  }
  add('Batting', ['Batting', 'batting', 'Batting Type', 'batting type', 'BAT', 'Bat'])
  add('Bowling', ['Bowling', 'bowling', 'Bowling Type', 'bowling type', 'BOWL', 'Bowl'])
  add('Speciality', ['Speciality', 'speciality', 'Specialty', 'specialty', 'Role', 'role'])
  add('Wicket Keeper', ['Wicket Keeper', 'wicket keeper', 'WicketKeeper', 'wicketKeeper', 'WK', 'wk'])
  return essentials
}

export default function OfflineAuctionPage({ params }: { params: { id: string } }) {
  const auctionId = params.id
  const [snapshot, setSnapshot] = useState<OfflineAuctionSnapshot | null>(null)
  const [pending, setPending] = useState<OfflineResult[]>([])
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null)
  const [saleMode, setSaleMode] = useState(false)
  const [selectedBidderId, setSelectedBidderId] = useState<string | null>(null)
  const [amountInput, setAmountInput] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)

  useEffect(() => {
    setSnapshot(loadOfflineSnapshot(auctionId))
    setPending(loadPendingResults(auctionId))
  }, [auctionId])

  const persistPending = (next: OfflineResult[]) => {
    setPending(next)
    savePendingResults(auctionId, next)
  }

  // Purses and player outcomes as of "the last known server state plus
  // whatever's been recorded here" - the snapshot itself is never mutated,
  // pending results are the delta on top of it.
  const purseByBidder = useMemo(() => {
    const map = new Map<string, number>()
    snapshot?.bidders.forEach(b => map.set(b.id, b.remainingPurse))
    pending.forEach(r => {
      if (r.status === 'SOLD' && r.bidderId && r.amount != null) {
        map.set(r.bidderId, (map.get(r.bidderId) ?? 0) - r.amount)
      }
    })
    return map
  }, [snapshot, pending])

  const resolvedPlayerIds = useMemo(() => new Set(pending.map(r => r.playerId)), [pending])

  const availablePlayers = useMemo(() => {
    if (!snapshot) return []
    return snapshot.players.filter(p => p.status === 'AVAILABLE' && !resolvedPlayerIds.has(p.id))
  }, [snapshot, resolvedPlayerIds])

  const groupedBidders = useMemo(() => {
    if (!snapshot) return []
    const sorted = snapshot.bidders.slice().sort((a, b) =>
      (a.name || a.username).localeCompare(b.name || b.username)
    )
    const groups: { letter: string; bidders: typeof sorted }[] = []
    sorted.forEach(b => {
      const letter = (b.name || b.username).charAt(0).toUpperCase() || '#'
      const last = groups[groups.length - 1]
      if (last && last.letter === letter) last.bidders.push(b)
      else groups.push({ letter, bidders: [b] })
    })
    return groups
  }, [snapshot])

  const selectedPlayer = snapshot?.players.find(p => p.id === selectedPlayerId) || null
  const selectedBidder = snapshot?.bidders.find(b => b.id === selectedBidderId) || null

  const resetPicker = () => {
    setSelectedPlayerId(null)
    setSaleMode(false)
    setSelectedBidderId(null)
    setAmountInput('')
  }

  const recordUnsold = () => {
    if (!selectedPlayer) return
    const entry: OfflineResult = {
      id: crypto.randomUUID(),
      playerId: selectedPlayer.id,
      playerName: extractName(selectedPlayer.data),
      status: 'UNSOLD',
      recordedAt: new Date().toISOString()
    }
    persistPending([entry, ...pending])
    resetPicker()
  }

  const recordSale = () => {
    if (!selectedPlayer || !selectedBidder) return
    const amount = parseInt(amountInput.replace(/[^0-9]/g, ''), 10)
    if (!amount || amount <= 0) return
    const entry: OfflineResult = {
      id: crypto.randomUUID(),
      playerId: selectedPlayer.id,
      playerName: extractName(selectedPlayer.data),
      status: 'SOLD',
      bidderId: selectedBidder.id,
      bidderName: selectedBidder.name || selectedBidder.username,
      amount,
      recordedAt: new Date().toISOString()
    }
    persistPending([entry, ...pending])
    resetPicker()
  }

  const removePending = (id: string) => {
    persistPending(pending.filter(r => r.id !== id))
  }

  const syncNow = async () => {
    if (pending.length === 0) return
    setSyncing(true)
    setSyncMessage(null)
    try {
      const response = await fetch(`/api/auction/${auctionId}/reconcile-offline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          results: pending.map(r => ({
            id: r.id,
            playerId: r.playerId,
            status: r.status,
            bidderId: r.bidderId,
            amount: r.amount
          }))
        })
      })
      if (!response.ok) {
        setSyncMessage('Still unreachable - keep recording offline, then try again.')
        return
      }
      const data = await response.json()
      const outcomes: Array<{ id: string; outcome: string; message?: string }> = data.outcomes || []
      const resolvedIds = new Set(
        outcomes.filter(o => o.outcome === 'applied' || o.outcome === 'applied_with_warning' || o.outcome === 'skipped').map(o => o.id)
      )
      const stillPending = pending.filter(r => !resolvedIds.has(r.id))
      persistPending(stillPending)
      const needsReview = outcomes.filter(o => o.outcome === 'conflict' || o.outcome === 'error')
      setSyncMessage(
        stillPending.length === 0
          ? `Synced. All ${outcomes.length} results applied.`
          : `Synced ${resolvedIds.size} of ${outcomes.length}. ${needsReview.length} need manual review (kept below) - check: ${needsReview.map(o => o.message).join(' ')}`
      )
    } catch {
      setSyncMessage('Still unreachable - keep recording offline, then try again.')
    } finally {
      setSyncing(false)
    }
  }

  // Proactive connectivity check, independent of whatever the admin is
  // doing here - the same beacon the live console uses. The moment it says
  // we're back online and there's something waiting, push it automatically
  // instead of relying on the admin to remember to tap Sync. Safe to retry
  // on its own: reconcile-offline/route.ts is idempotent (a result already
  // applied comes back "skipped," never re-applied) and never silently
  // overwrites a conflicting outcome.
  const { isOnline } = useConnectivityBeacon(auctionId)
  const syncNowRef = useRef(syncNow)
  syncNowRef.current = syncNow

  useEffect(() => {
    if (isOnline && pending.length > 0 && !syncing) {
      syncNowRef.current()
    }
  }, [isOnline, pending.length, syncing])

  if (!snapshot) {
    return (
      <div className="min-h-screen bg-[#05070a] text-white flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-3">
          <div className="text-amber-400 font-black uppercase tracking-wider text-sm">No Offline Snapshot Found</div>
          <p className="text-gray-400 text-sm">
            Open the live admin console for this auction at least once first - it mirrors a
            snapshot to this browser automatically. Then reopen this page (ideally in its
            own tab, before anything goes wrong) so it&rsquo;s ready if the app becomes unreachable.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#05070a] text-white">
      <div className="sticky top-0 z-10 bg-red-900/90 backdrop-blur-sm border-b border-red-500/30 px-4 py-2 text-center space-y-0.5">
        <div className="text-[11px] font-black uppercase tracking-widest text-red-200">
          Offline Fallback Mode &middot; Do not refresh this tab
        </div>
        <div className={`text-[10px] font-bold uppercase tracking-wide ${isOnline ? 'text-emerald-300' : 'text-red-300/80'}`}>
          {isOnline
            ? (pending.length > 0 ? 'Connection detected - syncing automatically…' : 'Connection detected')
            : 'Checking for connection every few seconds…'}
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-black uppercase text-lg">{snapshot.auctionName}</div>
            <div className="text-gray-500 text-xs">Snapshot from {new Date(snapshot.savedAt).toLocaleTimeString()}</div>
          </div>
          <div className="text-right text-xs text-gray-400">
            {availablePlayers.length} available &middot; {pending.length} recorded offline
          </div>
        </div>

        {!selectedPlayer && (
          <div>
            <div className="text-[11px] font-black uppercase tracking-widest text-gray-400 mb-2">
              Pick the player on the block
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {availablePlayers.map(p => (
                <button
                  key={p.id}
                  onClick={() => setSelectedPlayerId(p.id)}
                  className="text-left p-2.5 rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
                >
                  <div className="font-bold text-sm truncate">{extractName(p.data)}</div>
                </button>
              ))}
              {availablePlayers.length === 0 && (
                <div className="col-span-full text-gray-500 text-sm">No players left to auction.</div>
              )}
            </div>
          </div>
        )}

        {selectedPlayer && !saleMode && (
          <div className="space-y-3">
            <PlayerCard
              name={extractName(selectedPlayer.data)}
              imageUrl={extractImageUrl(selectedPlayer.data)}
              basePrice={Number(selectedPlayer.data?.['Base Price'] ?? selectedPlayer.data?.['base price'] ?? 1000)}
              fields={extractFields(selectedPlayer.data)}
              tags={selectedPlayer.isIcon ? [{ label: 'Bidder Choice', color: 'purple' }] : []}
            />
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setSaleMode(true)}
                className="h-12 rounded-lg bg-teal-500 hover:bg-teal-600 text-gray-950 font-bold"
              >
                Mark Sold
              </button>
              <button
                onClick={recordUnsold}
                className="h-12 rounded-lg bg-white/10 hover:bg-white/15 text-white font-bold"
              >
                Mark Unsold
              </button>
            </div>
            <button onClick={resetPicker} className="text-xs text-gray-500 underline">
              Back to player list
            </button>
          </div>
        )}

        {selectedPlayer && saleMode && (
          <div className="space-y-3">
            <div className="text-sm text-gray-300">
              Selling <span className="font-bold text-white">{extractName(selectedPlayer.data)}</span>
            </div>
            <input
              type="text"
              inputMode="numeric"
              placeholder="Final sale amount"
              value={amountInput}
              onChange={e => setAmountInput(e.target.value.replace(/[^0-9]/g, ''))}
              className="w-full bg-white/5 border border-white/15 rounded-md px-3 py-2 text-white placeholder:text-gray-500"
            />
            <div className="text-[10px] font-black uppercase tracking-widest text-gray-400">Tap the buyer</div>
            {groupedBidders.map(group => (
              <div key={group.letter}>
                <div className="text-[9px] font-black text-teal-400/80 uppercase tracking-widest mb-1">{group.letter}</div>
                <div className="grid grid-cols-2 gap-1.5 mb-2">
                  {group.bidders.map(b => (
                    <button
                      key={b.id}
                      onClick={() => setSelectedBidderId(b.id)}
                      className={`text-left p-1.5 rounded-lg border min-w-0 ${
                        selectedBidderId === b.id ? 'bg-teal-500/15 border-teal-500' : 'bg-white/[0.03] border-white/10'
                      }`}
                    >
                      <div className="text-[10px] font-bold truncate">{b.name || b.username}</div>
                      <div className="text-[9px] text-gray-500 truncate">
                        {b.teamName} &middot; ₹{(purseByBidder.get(b.id) ?? b.remainingPurse).toLocaleString('en-IN')} left
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <button
              onClick={recordSale}
              disabled={!selectedBidderId || !amountInput}
              className="w-full h-12 rounded-lg bg-teal-500 disabled:bg-white/10 disabled:text-gray-600 text-gray-950 font-bold"
            >
              Confirm Sale
            </button>
            <button onClick={() => setSaleMode(false)} className="text-xs text-gray-500 underline">
              Back
            </button>
          </div>
        )}

        <div className="pt-4 border-t border-white/10">
          <div className="text-[11px] font-black uppercase tracking-widest text-gray-400 mb-2">
            Recorded Offline &middot; {pending.length}
          </div>
          {pending.length === 0 ? (
            <div className="text-gray-600 text-sm">Nothing recorded yet.</div>
          ) : (
            <div className="space-y-1.5">
              {pending.map(r => (
                <div key={r.id} className="flex items-center justify-between text-sm bg-white/[0.03] rounded-lg px-3 py-2">
                  <div>
                    <span className="font-bold">{r.playerName}</span>{' '}
                    {r.status === 'SOLD' ? (
                      <span className="text-gray-400">
                        sold to {r.bidderName} for ₹{r.amount?.toLocaleString('en-IN')}
                      </span>
                    ) : (
                      <span className="text-gray-400">unsold</span>
                    )}
                  </div>
                  <button onClick={() => removePending(r.id)} className="text-red-400 text-xs">Undo</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="pt-4 border-t border-white/10 space-y-2">
          <button
            onClick={syncNow}
            disabled={pending.length === 0 || syncing}
            className="w-full h-12 rounded-lg bg-emerald-600 disabled:bg-white/10 disabled:text-gray-600 text-white font-bold"
          >
            {syncing ? 'Trying to reach the live auction…' : `Sync ${pending.length} Result${pending.length === 1 ? '' : 's'} to Live Auction`}
          </button>
          {syncMessage && <div className="text-xs text-gray-400">{syncMessage}</div>}
        </div>
      </div>
    </div>
  )
}
