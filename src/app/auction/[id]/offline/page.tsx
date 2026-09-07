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
import Link from 'next/link'
import {
  OfflineAuctionSnapshot,
  OfflineResult,
  loadOfflineSnapshot,
  loadPendingResults,
  savePendingResults,
  saveOfflineSnapshot,
  loadCurrentOfflinePlayer,
  saveCurrentOfflinePlayer,
  pickRandomPlayer,
  extractOfflineRules,
  validateOfflineSale
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
  const [currentPlayerId, setCurrentPlayerId] = useState<string | null>(null)
  const [selectedBidderId, setSelectedBidderId] = useState<string | null>(null)
  const [amountInput, setAmountInput] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)

  // Proactive connectivity check, independent of whatever the admin is
  // doing here - the same beacon the live console uses. Declared up top
  // because the auto-pick effect below needs it: this console must never
  // guess who's on the block while it can actually reach the server.
  const { isOnline } = useConnectivityBeacon(auctionId)

  // Set only the first time this console draws its OWN player pick while
  // genuinely offline (never while reachable - see the auto-pick effect).
  // Remembers what the live auction's currentPlayerId was right before
  // this console started guessing, so a later sync can tell whether
  // anything else changed it in the meantime instead of blindly
  // overwriting real progress.
  const selfDrawnPickRef = useRef<{ playerId: string | null; expectedPreviousPlayerId: string | null } | null>(null)

  useEffect(() => {
    const loadedSnapshot = loadOfflineSnapshot(auctionId)
    const loadedPending = loadPendingResults(auctionId)
    setSnapshot(loadedSnapshot)
    setPending(loadedPending)

    // The persisted pick only means something while there's actual offline
    // work resting on it - a sale/unsold recorded here but not yet synced,
    // where the live snapshot's currentPlayerId can no longer be trusted
    // (this console has already moved past it). With nothing pending, that
    // pin is just leftover state from an earlier visit that recorded
    // nothing - trusting it forever, even after the live auction has moved
    // on to a different player, is exactly how this console ends up
    // showing someone the outage already left behind (mismatched against
    // the admin console, which reads current truth from the database).
    const hasUnsyncedWork = loadedPending.length > 0
    const persistedPlayerId = hasUnsyncedWork ? loadCurrentOfflinePlayer(auctionId) : null
    const resumedPlayerId = persistedPlayerId ?? loadedSnapshot?.currentPlayerId ?? null
    setCurrentPlayerId(resumedPlayerId)
    saveCurrentOfflinePlayer(auctionId, resumedPlayerId)
    if (!persistedPlayerId && resumedPlayerId) {
      // Only meaningful when we're continuing that same live player -
      // prefill what was already bid so nothing typed live has to be
      // re-entered or remembered from memory.
      if (loadedSnapshot?.currentBid) {
        setSelectedBidderId(loadedSnapshot.currentBid.bidderId)
        setAmountInput(String(loadedSnapshot.currentBid.amount))
      }
    }
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

  // How many players each bidder has already locked in - snapshot (from
  // before the outage) plus whatever's been recorded here since. Feeds the
  // same team-size/reserve checks mark-sold/route.ts runs online, so a
  // bidder can't end up over the cap just because their last few purchases
  // happened offline.
  const playersBoughtByBidder = useMemo(() => {
    const map = new Map<string, number>()
    snapshot?.players.forEach(p => {
      if (p.status === 'SOLD' && p.soldTo) map.set(p.soldTo, (map.get(p.soldTo) ?? 0) + 1)
    })
    pending.forEach(r => {
      if (r.status === 'SOLD' && r.bidderId) map.set(r.bidderId, (map.get(r.bidderId) ?? 0) + 1)
    })
    return map
  }, [snapshot, pending])

  const rules = useMemo(() => extractOfflineRules(snapshot?.rules), [snapshot])

  const saleError = useMemo(() => {
    if (!selectedBidderId || !amountInput) return null
    const bidderId = selectedBidderId
    return validateOfflineSale({
      amount: parseInt(amountInput, 10),
      bidderRemainingPurse: purseByBidder.get(bidderId) ?? 0,
      playersBoughtByBidder: playersBoughtByBidder.get(bidderId) ?? 0,
      rules
    })
  }, [selectedBidderId, amountInput, purseByBidder, playersBoughtByBidder, rules])

  const resolvedPlayerIds = useMemo(() => new Set(pending.map(r => r.playerId)), [pending])

  const availablePlayers = useMemo(() => {
    if (!snapshot) return []
    return snapshot.players.filter(p => p.status === 'AVAILABLE' && !resolvedPlayerIds.has(p.id))
  }, [snapshot, resolvedPlayerIds])

  // A dropdown, not a tap-grid of buttons - this page is meant to be read
  // off a projector, where a scrolling grid of bidder buttons is the one
  // thing nobody in the room can follow along with.
  const sortedBidders = useMemo(() => {
    if (!snapshot) return []
    return snapshot.bidders.slice().sort((a, b) =>
      (a.name || a.username).localeCompare(b.name || b.username)
    )
  }, [snapshot])

  const currentPlayer = snapshot?.players.find(p => p.id === currentPlayerId) || null
  const selectedBidder = snapshot?.bidders.find(b => b.id === selectedBidderId) || null

  // Whoever's on the block is decided by whichever source of truth is
  // actually trustworthy right now:
  //
  // - Reachable: mirror the live snapshot's currentPlayerId directly,
  //   always. This console must NEVER independently guess while it can
  //   still reach the server - guessing is exactly how it ended up
  //   showing a different player than the live admin console with
  //   nothing actually wrong: this console drew its own random pick
  //   (because its locally-cached snapshot happened to have no valid
  //   currentPlayerId yet) while genuinely still online, and then never
  //   revisited that guess since nothing here re-reads the snapshot after
  //   the first load.
  // - Unreachable: fall back to the icon-first random draw (mirrors the
  //   live server's own rule - see pickRandomPlayer) whenever the current
  //   pick is missing or has just been resolved offline, since there's no
  //   live authority left to consult.
  useEffect(() => {
    if (!snapshot) return

    if (isOnline) {
      // A self-drawn pick still waiting to sync takes priority over the
      // (possibly now-outdated) live snapshot for one more render - the
      // auto-sync effect below fires on this same isOnline transition and
      // will resolve it properly (confirmed, or corrected on conflict).
      // Without this, this effect would flip the display back to the
      // stale pre-outage player for a moment and then flip again once
      // sync responds.
      if (selfDrawnPickRef.current) return
      const livePlayerId = snapshot.currentPlayerId ?? null
      if (currentPlayerId !== livePlayerId) {
        setCurrentPlayerId(livePlayerId)
        saveCurrentOfflinePlayer(auctionId, livePlayerId)
      }
      return
    }

    const stillOnTheBlock = currentPlayerId && availablePlayers.some(p => p.id === currentPlayerId)
    if (stillOnTheBlock) return

    if (pending.length === 0 && !selfDrawnPickRef.current) {
      selfDrawnPickRef.current = { playerId: null, expectedPreviousPlayerId: currentPlayerId }
    }
    const next = pickRandomPlayer(availablePlayers)
    const nextId = next?.id ?? null
    setCurrentPlayerId(nextId)
    saveCurrentOfflinePlayer(auctionId, nextId)
    if (pending.length === 0 && selfDrawnPickRef.current) {
      selfDrawnPickRef.current = { ...selfDrawnPickRef.current, playerId: nextId }
    }
  }, [snapshot, availablePlayers, currentPlayerId, auctionId, isOnline, pending.length])

  const resetSaleForm = () => {
    setSelectedBidderId(null)
    setAmountInput('')
  }

  const recordUnsold = () => {
    if (!currentPlayer) return
    const entry: OfflineResult = {
      id: crypto.randomUUID(),
      playerId: currentPlayer.id,
      playerName: extractName(currentPlayer.data),
      status: 'UNSOLD',
      recordedAt: new Date().toISOString()
    }
    persistPending([entry, ...pending])
    resetSaleForm()
  }

  const recordSale = () => {
    if (!currentPlayer || !selectedBidder) return
    const amount = parseInt(amountInput.replace(/[^0-9]/g, ''), 10)
    if (!amount || amount <= 0) return
    // Re-check even though the button is disabled on the same condition -
    // this is the last gate before a sale becomes an irreversible pending
    // entry, so it must never rely solely on the UI having stayed in sync.
    if (saleError) return
    const entry: OfflineResult = {
      id: crypto.randomUUID(),
      playerId: currentPlayer.id,
      playerName: extractName(currentPlayer.data),
      status: 'SOLD',
      bidderId: selectedBidder.id,
      bidderName: selectedBidder.name || selectedBidder.username,
      amount,
      recordedAt: new Date().toISOString()
    }
    persistPending([entry, ...pending])
    resetSaleForm()
  }

  const removePending = (id: string) => {
    persistPending(pending.filter(r => r.id !== id))
  }

  const syncNow = async () => {
    // A self-drawn pick only gets pushed when there's nothing else pending -
    // if a result IS pending, the existing sold/unsold sync path below
    // already advances the live currentPlayerId once that result applies,
    // so pushing a separate, possibly-stale guess on top would just be a
    // second, competing claim about who's next.
    const currentPick = pending.length === 0 ? selfDrawnPickRef.current : null
    if (pending.length === 0 && !currentPick) return
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
          })),
          ...(currentPick ? { currentPick } : {})
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

      // The pick was either accepted, already matched, or conflicted with
      // something that changed the live auction in the meantime - either
      // way, this console shouldn't keep asserting it, and its own view of
      // "current" needs to reflect whichever value actually won.
      let currentPickMessage: string | null = null
      if (data.currentPickOutcome) {
        selfDrawnPickRef.current = null
        if (data.currentPickOutcome === 'conflict') {
          const liveId = data.liveCurrentPlayer?.id ?? null
          setSnapshot(prev => {
            if (!prev) return prev
            const updated = { ...prev, currentPlayerId: liveId, currentBid: null }
            saveOfflineSnapshot(updated)
            return updated
          })
          currentPickMessage = 'The live auction had already moved on to a different player while this console was offline - corrected to match it.'
        } else if (currentPick) {
          setSnapshot(prev => {
            if (!prev) return prev
            const updated = { ...prev, currentPlayerId: currentPick.playerId, currentBid: null }
            saveOfflineSnapshot(updated)
            return updated
          })
        }
      }

      // A synced result stops being excluded via "pending" the moment it's
      // removed below - without folding it into the snapshot itself first,
      // that player's status here would still read AVAILABLE (the snapshot
      // is otherwise only ever refreshed by the admin console mirroring a
      // new one), so it would silently count as available again and could
      // even be drawn a second time by the random-pick effect.
      const resolvedResults = pending.filter(r => resolvedIds.has(r.id))
      if (resolvedResults.length > 0 && snapshot) {
        const updatedSnapshot: OfflineAuctionSnapshot = {
          ...snapshot,
          players: snapshot.players.map(p => {
            const result = resolvedResults.find(r => r.playerId === p.id)
            if (!result) return p
            return {
              ...p,
              status: result.status,
              soldTo: result.status === 'SOLD' ? result.bidderId ?? null : null,
              soldPrice: result.status === 'SOLD' ? result.amount ?? null : null
            }
          }),
          bidders: snapshot.bidders.map(b => {
            const spent = resolvedResults
              .filter(r => r.status === 'SOLD' && r.bidderId === b.id && r.amount != null)
              .reduce((sum, r) => sum + (r.amount as number), 0)
            return spent > 0 ? { ...b, remainingPurse: b.remainingPurse - spent } : b
          })
        }
        setSnapshot(updatedSnapshot)
        saveOfflineSnapshot(updatedSnapshot)
      }

      const stillPending = pending.filter(r => !resolvedIds.has(r.id))
      persistPending(stillPending)
      const needsReview = outcomes.filter(o => o.outcome === 'conflict' || o.outcome === 'error')
      const resultsMessage = outcomes.length === 0
        ? null
        : stillPending.length === 0
          ? `Synced. All ${outcomes.length} results applied.`
          : `Synced ${resolvedIds.size} of ${outcomes.length}. ${needsReview.length} need manual review (kept below) - check: ${needsReview.map(o => o.message).join(' ')}`
      setSyncMessage([resultsMessage, currentPickMessage].filter(Boolean).join(' ') || null)
    } catch {
      setSyncMessage('Still unreachable - keep recording offline, then try again.')
    } finally {
      setSyncing(false)
    }
  }

  // The moment the beacon says we're back online, push automatically -
  // pending results, or a self-drawn pick still waiting to become official
  // - instead of relying on the admin to remember to tap Sync. Safe to
  // retry on its own: reconcile-offline/route.ts is idempotent (a result
  // already applied comes back "skipped," never re-applied) and never
  // silently overwrites a conflicting outcome.
  const syncNowRef = useRef(syncNow)
  syncNowRef.current = syncNow

  useEffect(() => {
    if (isOnline && !syncing && (pending.length > 0 || selfDrawnPickRef.current)) {
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
        <div className="text-[10px] font-bold uppercase tracking-wide">
          {isOnline && pending.length === 0 ? (
            <Link href={`/auction/${auctionId}`} className="text-emerald-300 underline underline-offset-2">
              Everything&apos;s synced - back to the live admin console →
            </Link>
          ) : (
            <span className="text-gray-400">
              {pending.length > 0 ? `Back to the admin console once these ${pending.length} sync` : 'Back to the admin console once reconnected'}
            </span>
          )}
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

        {!currentPlayer && (
          <div className="text-center py-8 text-gray-500 text-sm">No players left to auction.</div>
        )}

        {currentPlayer && (
          <div className="space-y-3">
            <PlayerCard
              name={extractName(currentPlayer.data)}
              imageUrl={extractImageUrl(currentPlayer.data)}
              basePrice={Number(currentPlayer.data?.['Base Price'] ?? currentPlayer.data?.['base price'] ?? 1000)}
              fields={extractFields(currentPlayer.data)}
              tags={currentPlayer.isIcon ? [{ label: 'Bidder Choice', color: 'purple' }] : []}
            />

            <input
              type="text"
              inputMode="numeric"
              placeholder="Final sale amount"
              value={amountInput}
              onChange={e => setAmountInput(e.target.value.replace(/[^0-9]/g, ''))}
              className="w-full bg-white/5 border border-white/15 rounded-md px-3 py-2 text-white placeholder:text-gray-500"
            />
            <div className="text-[10px] font-black uppercase tracking-widest text-gray-400">Buyer</div>
            <select
              value={selectedBidderId ?? ''}
              onChange={e => setSelectedBidderId(e.target.value || null)}
              className="w-full h-14 bg-white/5 border border-white/15 rounded-md px-3 text-base font-bold text-white"
            >
              <option value="" disabled>Select the buyer…</option>
              {sortedBidders.map(b => {
                const teamFull = Boolean(rules.maxTeamSize && (playersBoughtByBidder.get(b.id) ?? 0) >= rules.maxTeamSize - 1)
                const purseLeft = (purseByBidder.get(b.id) ?? b.remainingPurse).toLocaleString('en-IN')
                return (
                  <option key={b.id} value={b.id} disabled={teamFull}>
                    {b.name || b.username} — {b.teamName || 'No Team'} — {teamFull ? 'Team Full' : `₹${purseLeft} left`}
                  </option>
                )
              })}
            </select>
            {selectedBidder && (
              <div className="text-xs text-gray-400">
                {selectedBidder.teamName || 'No Team'} &middot; ₹{(purseByBidder.get(selectedBidder.id) ?? selectedBidder.remainingPurse).toLocaleString('en-IN')} remaining
              </div>
            )}

            {saleError && (
              <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                {saleError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={recordSale}
                disabled={!selectedBidderId || !amountInput || !!saleError}
                className="h-12 rounded-lg bg-teal-500 disabled:bg-white/10 disabled:text-gray-600 text-gray-950 font-bold"
              >
                Confirm Sale
              </button>
              <button
                onClick={recordUnsold}
                className="h-12 rounded-lg bg-white/10 hover:bg-white/15 text-white font-bold"
              >
                Mark Unsold
              </button>
            </div>
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
