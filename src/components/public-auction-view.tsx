'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import dynamic from 'next/dynamic'
import { Auction, Player } from '@prisma/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { ChevronRight, Eye, Trophy, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { usePusher } from '@/lib/pusher-client'
import { motion, AnimatePresence } from 'framer-motion'
import { logger } from '@/lib/logger'
import { formatCurrency } from '@/lib/currency'
import { useViewerCount } from '@/hooks/use-viewer-count'
import PlayerCard from '@/components/player-card'
import BidAmountStrip from '@/components/bid-amount-strip'
import { PlayerRevealAnimation } from '@/components/player-reveal-animation'
import { GoingLiveBanner } from '@/components/going-live-banner'
import { extractCricheroesLink } from '@/lib/cricheroes'
import { extractBattingStats, extractBowlingStats } from '@/lib/cricket-stats'
import { BatIcon, BallIcon, StatTile } from '@/components/cricket-stat-ui'
// Memoized components for performance
import { StatsDisplay } from '@/components/public-auction-view/memoized-components'

interface BidHistoryEntry {
  bidderId: string
  amount: number
  timestamp: Date
  bidderName: string
  teamName?: string
  type?: 'bid' | 'sold' | 'unsold' | 'bid-undo'
  playerId?: string
  playerName?: string
}

interface Bidder {
  id: string
  teamName: string | null
  username: string
  remainingPurse: number
  logoUrl: string | null
}

interface PublicAuctionViewProps {
  auction: Auction & {
    players: Player[]
  }
  currentPlayer: Player | null
  stats: {
    total: number
    sold: number
    unsold: number
    remaining: number
  }
  bidHistory: BidHistoryEntry[]
  bidders: Bidder[]
  onOpenBidHistoryRef?: React.MutableRefObject<(() => void) | null> // Ref to expose modal opener
  onRefreshRef?: React.MutableRefObject<(() => void) | null> // Ref to expose a manual force-refresh
  // The presenter link (?presenter=1) - see public-auction-wrapper.tsx. True
  // keeps a real Pusher connection (the anchor's screen needs instant
  // updates); false (the default, every other viewer) drops Pusher entirely
  // in favor of a background poll - see the effect below usePusher.
  isPresenter?: boolean
}

interface AuctionSnapshot {
  currentPlayer: Player | null
  players: Player[]
  // Team name/logo/username never change during a live auction and are
  // already known from the initial page load - the poll only needs to carry
  // the one thing that actually changes per team, the remaining purse. See
  // applySnapshot below, which merges this into the existing bidder records
  // instead of replacing them (a replace would blank out the display fields
  // this trimmed shape no longer carries).
  bidders: Array<{ id: string; remainingPurse: number }>
  bidHistory: BidHistoryEntry[]
  poolExhausted: boolean
  recentSales: RecentSale[]
}

interface RecentSale {
  id: string
  name: string
  price: number
  buyer: string
}

function deriveCurrentBidForPlayer(rawHistory: BidHistoryEntry[], playerId: string | undefined) {
  if (!playerId) return { sortedHistory: [] as BidHistoryEntry[], currentBid: null, highestBidderId: null }

  const filtered = rawHistory.filter(bid => {
    if (bid.type === 'bid-undo') return false
    return !bid.playerId || bid.playerId === playerId
  })
  const sortedHistory = [...filtered].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  const latestBid = sortedHistory[0]
  if (latestBid && (!latestBid.type || latestBid.type === 'bid')) {
    return {
      sortedHistory,
      currentBid: { bidderId: latestBid.bidderId, amount: latestBid.amount, bidderName: latestBid.bidderName, teamName: latestBid.teamName },
      highestBidderId: latestBid.bidderId,
    }
  }
  return { sortedHistory, currentBid: null, highestBidderId: null }
}

// Bottom scrolling ticker of recent sales. 'floating' (the default, used by
// regular public viewers) is fixed above the page's branding footer on
// mobile and drops to normal document flow on desktop, right before that
// same footer. 'inline' (presenter only) is always normal flow - the
// presenter screen is a fixed-height flex column, so it just takes its own
// row and the stage above it shrinks to fit, no positioning math needed.
function SoldTicker({ sales, variant = 'floating' }: { sales: RecentSale[]; variant?: 'floating' | 'inline' }) {
  if (sales.length === 0) return null
  // bottom-0, not bottom-8 - this sits flush at the true bottom of the
  // screen, with the branding footer positioned just above it (bottom-8 in
  // page.tsx). Both at bottom-8 previously left the actual bottom-most 32px
  // of the viewport uncovered by either, showing scrolled content through it.
  const positionClasses = variant === 'floating'
    ? 'fixed bottom-0 left-0 right-0 z-30 sm:static sm:z-auto'
    : 'flex-shrink-0'
  // Presenter gets a much bigger banner than regular viewers - it's read
  // from across a room on a projector, not held in a hand a foot from the
  // eyes, so it needs a size closer to the rest of the presenter stage's
  // own scale (which already runs text-3xl+ for the player name).
  const containerSizeClasses = variant === 'inline' ? 'h-16 border-t-2' : 'h-8 sm:h-9 border-t'
  const itemSizeClasses = variant === 'inline' ? 'gap-3 px-10 text-xl' : 'gap-2 px-6 text-xs sm:text-sm'
  return (
    <div className={`${positionClasses} ${containerSizeClasses} bg-[#05070a] border-amber-500/30 overflow-hidden flex items-center`}>
      {/* Content rendered twice so the loop from -50% back to 0% is
          invisible - see .animate-ticker-scroll in globals.css. */}
      <div className="flex whitespace-nowrap animate-ticker-scroll">
        {[...sales, ...sales].map((sale, i) => (
          <span key={`${sale.id}-${i}`} className={`inline-flex items-center flex-shrink-0 font-bold ${itemSizeClasses}`}>
            <span className="text-white uppercase">{sale.name}</span>
            <span className="text-gray-600">&rarr;</span>
            <span className="text-amber-400">{sale.buyer}</span>
            <span className="text-emerald-400 tabular-nums">₹{sale.price.toLocaleString('en-IN')}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

export function PublicAuctionView({ auction, currentPlayer: initialPlayer, stats: initialStats, bidHistory: initialHistory, bidders, onOpenBidHistoryRef, onRefreshRef, isPresenter = false }: PublicAuctionViewProps) {
  const [currentPlayer, setCurrentPlayer] = useState(initialPlayer)
  // True once a sale empties the pool (nothing AVAILABLE, nothing UNSOLD left
  // to recycle) - without this, spectators have no way to tell "waiting for
  // the next player" apart from "there is no next player."
  const [poolExhausted, setPoolExhausted] = useState(false)
  const [currentBid, setCurrentBid] = useState<{ bidderId: string; amount: number; bidderName: string; teamName?: string } | null>(null)
  const [bidHistory, setBidHistory] = useState<BidHistoryEntry[]>([])
  const [highestBidderId, setHighestBidderId] = useState<string | null>(null)
  const [soldAnimation, setSoldAnimation] = useState(false)
  // Who the SOLD banner should credit - captured off the player-sold event
  // at the moment it fires, since currentBid/currentPlayer may already have
  // moved on to the next player by the time the banner is shown.
  const [soldInfo, setSoldInfo] = useState<{ teamName?: string; bidderName?: string } | null>(null)
  const [isClient, setIsClient] = useState(false)
  const [showAllPlayerDetails, setShowAllPlayerDetails] = useState(false)
  const [isImageLoading, setIsImageLoading] = useState(false)
  // Feeds both the sold ticker and the Play-by-Play panel's "Recently Sold"
  // fallback. Server-authoritative (see recentSales in the snapshot route)
  // rather than derived from this component's own `players` state, since
  // that state only ever carries status/isIcon after the first poll - it
  // would silently go stale (wrong name, wrong price) for any sale that
  // happened after the initial page load otherwise. Starts empty rather
  // than seeded from initial props - the props carry no soldAt, so a seed
  // built from them can't tell a genuinely recent sale apart from an old
  // one, and would flash the wrong entries for the brief moment before the
  // first poll (which fires immediately on mount) corrects it.
  const [recentSales, setRecentSales] = useState<RecentSale[]>([])
  
  // Track live viewer count
  const viewerCount = useViewerCount(auction.id, true)
  const [players, setPlayers] = useState(auction.players)
  const [biddersState, setBiddersState] = useState(bidders)
  const [showPlayerReveal, setShowPlayerReveal] = useState(false)
  const [pendingPlayer, setPendingPlayer] = useState<Player | null>(null)
  const [showGoingLiveBanner, setShowGoingLiveBanner] = useState(false)
  const [previousAuctionStatus, setPreviousAuctionStatus] = useState(auction.status)
  const goingLiveBannerTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const [localCurrentPlayer, setLocalCurrentPlayer] = useState(currentPlayer)
  
  // Real-time stats calculated from players state
  const stats = useMemo(() => {
    const total = players.length
    const sold = players.filter(p => p.status === 'SOLD').length
    const unsold = players.filter(p => p.status === 'UNSOLD').length
    const remaining = players.filter(p => p.status === 'AVAILABLE').length
    return { total, sold, unsold, remaining }
  }, [players])

  // How many bids landed in the last minute - drives the mobile "pulse"
  // status line, which points at the existing Live Bids sheet rather than
  // duplicating its content.
  const recentBidCount = useMemo(() => {
    const cutoff = Date.now() - 60000
    return bidHistory.filter(b =>
      (!b.type || b.type === 'bid') && new Date(b.timestamp).getTime() >= cutoff
    ).length
  }, [bidHistory])

  // Bid history modal state
  const [bidHistoryModalOpen, setBidHistoryModalOpen] = useState(false)

  // Expose modal opener via ref
  useEffect(() => {
    if (onOpenBidHistoryRef) {
      onOpenBidHistoryRef.current = () => setBidHistoryModalOpen(true)
    }
  }, [onOpenBidHistoryRef])


  // Set client-side rendered flag
  useEffect(() => {
    setIsClient(true)
  }, [])
  
  // Update local current player when prop changes
  useEffect(() => {
    setLocalCurrentPlayer(currentPlayer)
  }, [currentPlayer])

  // Detect when auction goes live and show banner
  useEffect(() => {
    // Check if auction status changed from DRAFT/PAUSED to LIVE/MOCK_RUN
    const { isLiveStatus } = require('@/lib/auction-status')
    const wasNotLive = !isLiveStatus(previousAuctionStatus)
    const isNowLive = isLiveStatus(auction.status)
    const hasCurrentPlayer = localCurrentPlayer !== null

    if (wasNotLive && isNowLive && hasCurrentPlayer) {
      console.log('🎬 Auction just went LIVE - showing going live banner (public view)')
      setShowGoingLiveBanner(true)
      
      // Clear any existing timeout
      if (goingLiveBannerTimeoutRef.current) {
        clearTimeout(goingLiveBannerTimeoutRef.current)
      }
      
      // Hide banner after 4 seconds
      goingLiveBannerTimeoutRef.current = setTimeout(() => {
        setShowGoingLiveBanner(false)
        goingLiveBannerTimeoutRef.current = null
      }, 4000)
    }

    // Update previous status
    setPreviousAuctionStatus(auction.status)

    // Cleanup timeout on unmount
    return () => {
      if (goingLiveBannerTimeoutRef.current) {
        clearTimeout(goingLiveBannerTimeoutRef.current)
      }
    }
  }, [auction.status, localCurrentPlayer, previousAuctionStatus])

  // Track page view
  useEffect(() => {
    // Generate or retrieve visitor ID from localStorage
    let visitorId = localStorage.getItem('visitorId')
    if (!visitorId) {
      visitorId = `visitor_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`
      localStorage.setItem('visitorId', visitorId)
    }

    // Track the view
    fetch(`/api/auction/${auction.id}/track-view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorId })
    }).catch(err => console.error('Failed to track view:', err))
  }, [auction.id])

  // Sync biddersState with bidders prop when it changes
  useEffect(() => {
    setBiddersState(bidders)
  }, [bidders])

  // Handler when reveal animation completes
  const handleRevealComplete = useCallback(() => {
    setShowPlayerReveal(false)
    
    if (pendingPlayer) {
      setIsImageLoading(true)
      setCurrentPlayer(pendingPlayer)
      setCurrentBid(null)
      setHighestBidderId(null)
      setBidHistory([]) // Clear bid history for new player
      setPendingPlayer(null)
    }
  }, [pendingPlayer])

  // Initialize bid history and current bid from initial data
  useEffect(() => {
    logger.log('PublicAuctionView init', { historyLength: initialHistory.length, currentPlayerId: currentPlayer?.id })
    
    // Filter bid history to only show bids for the current player
    if (currentPlayer?.id) {
      const filteredHistory = initialHistory.filter(bid => {
        // Filter out stale "bid-undo" entries (they should only exist in real-time, not in DB)
        if (bid.type === 'bid-undo') return false
        // Show bids that match the current player OR don't have a playerId (legacy bids)
        return !bid.playerId || bid.playerId === currentPlayer.id
      })
      logger.log('PublicAuctionView filtered history', { length: filteredHistory.length })
      // Sort to have latest first (newest at top)
      const sortedHistory = [...filteredHistory].sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )
      setBidHistory(sortedHistory)
      
      // Set current bid if there's a bid in the filtered history
      if (sortedHistory.length > 0) {
        // Get the latest bid (first item is most recent)
        const latestBid = sortedHistory[0]
        if (latestBid && (!latestBid.type || latestBid.type === 'bid')) {
          logger.log('PublicAuctionView initial current bid', latestBid)
          setCurrentBid({
            bidderId: latestBid.bidderId,
            amount: latestBid.amount,
            bidderName: latestBid.bidderName,
            teamName: latestBid.teamName
          })
          setHighestBidderId(latestBid.bidderId)
        }
      } else {
        // No bids for this player
        setCurrentBid(null)
        setHighestBidderId(null)
      }
    } else {
      setBidHistory([])
      setCurrentBid(null)
      setHighestBidderId(null)
    }
  }, [initialHistory, currentPlayer?.id])

  // Refresh players and bidders list from server
  const refreshPlayersList = async () => {
    try {
      const response = await fetch(`/api/auctions/${auction.id}`)
      const data = await response.json()
      if (data.auction) {
        if (data.auction.players) {
          setPlayers(data.auction.players)
        }
        if (data.auction.bidders) {
          // Update bidders state
          const updatedBidders = data.auction.bidders.map((b: any) => ({
            id: b.id,
            teamName: b.teamName,
            username: b.username,
            remainingPurse: b.remainingPurse,
            logoUrl: b.logoUrl
          }))
          setBiddersState(updatedBidders)
        }
      }
    } catch (error) {
      logger.error('Failed to refresh players list:', error)
    }
  }

  // Reset image loading when player changes (but not on initial load)
  useEffect(() => {
    if (currentPlayer?.id && initialPlayer?.id && currentPlayer.id !== initialPlayer.id) {
      setIsImageLoading(true)
    }
  }, [currentPlayer?.id])


  // Applies a snapshot fetched by the non-presenter polling fallback below.
  // Deliberately direct (no reveal animation, no diffing) - that flourish is
  // presenter/Pusher-specific eye candy; a background poller just needs the
  // screen to catch up to the real state.
  const applySnapshot = useCallback((snapshot: AuctionSnapshot, options?: { skipTurnState?: boolean }) => {
    setPlayers(snapshot.players)
    setBiddersState(prev => prev.map(b => {
      const update = snapshot.bidders.find(u => u.id === b.id)
      return update ? { ...b, remainingPurse: update.remainingPurse } : b
    }))
    setPoolExhausted(snapshot.poolExhausted)
    setRecentSales(snapshot.recentSales)
    // Skipped while the presenter's reveal animation is playing (see the
    // presenter safety-net poll below) - applying this mid-animation would
    // cut the reveal short instead of catching up on a genuinely missed
    // event, since setCurrentPlayer here is the same commit that
    // handleRevealComplete normally makes once the animation finishes.
    if (options?.skipTurnState) return
    setCurrentPlayer(snapshot.currentPlayer)
    const { sortedHistory, currentBid: derivedBid, highestBidderId: derivedHighest } =
      deriveCurrentBidForPlayer(snapshot.bidHistory, snapshot.currentPlayer?.id)
    setBidHistory(sortedHistory)
    setCurrentBid(derivedBid)
    setHighestBidderId(derivedHighest)
  }, [])

  // Tracks whether OUR polling is actually succeeding - the correct signal
  // for a non-presenter viewer's "Live/Reconnecting" badge, since these
  // viewers never hold a Pusher connection at all (see the `enabled` flag
  // below) and previously showed that same badge wired to `pusherConnected`,
  // which is permanently false for them regardless of whether polling is
  // working - a false "Reconnecting" shown to every real viewer, always.
  // Two consecutive failures before flipping unhealthy (one blip shouldn't
  // alarm anyone); a single success recovers it immediately.
  const [pollHealthy, setPollHealthy] = useState(true)
  const pollFailureStreakRef = useRef(0)

  const fetchSnapshot = useCallback(async () => {
    try {
      // no-store: without this, some browsers will silently keep reusing
      // their own cached copy of this URL well past the server's intended
      // 2s freshness window (s-maxage only governs Vercel's shared edge
      // cache, not a visitor's own browser cache) - leaving the screen
      // stuck on stale data through every subsequent poll, and even a
      // manual refresh, since that still consults the browser's own cache
      // for this same URL. This forces every poll to actually reach
      // Vercel's edge, which is where the real freshness policy lives.
      const response = await fetch(`/api/auction/${auction.id}/snapshot`, { cache: 'no-store' })
      if (!response.ok) throw new Error(`Snapshot poll failed: HTTP ${response.status}`)
      const data = await response.json()
      applySnapshot({
        currentPlayer: data.currentPlayer,
        players: data.players,
        bidders: data.bidders,
        bidHistory: data.bidHistory,
        poolExhausted: data.poolExhausted,
        recentSales: data.recentSales ?? [],
      })
      pollFailureStreakRef.current = 0
      setPollHealthy(true)
    } catch (error) {
      logger.error('Failed to fetch auction snapshot:', error)
      pollFailureStreakRef.current += 1
      if (pollFailureStreakRef.current >= 2) setPollHealthy(false)
    }
  }, [auction.id, applySnapshot])

  // Expose a manual refresh trigger via ref - same pattern as
  // onOpenBidHistoryRef above. This is what the header's big Refresh button
  // calls: it just forces the same fetchSnapshot the 6s poll already runs,
  // rather than a full page reload.
  useEffect(() => {
    if (onRefreshRef) {
      onRefreshRef.current = () => { fetchSnapshot() }
    }
  }, [onRefreshRef, fetchSnapshot])

  // Non-presenter viewers (the default) never subscribe to Pusher at all -
  // see the `enabled` argument on usePusher below - so this poll is their
  // only source of live updates. The edge cache on the snapshot endpoint
  // (see route.ts) is what makes this affordable regardless of how many
  // viewers are polling at once.
  useEffect(() => {
    if (isPresenter) return
    fetchSnapshot()
    const interval = setInterval(fetchSnapshot, 6000)
    return () => clearInterval(interval)
  }, [isPresenter, fetchSnapshot])

  // Presenter safety net. Pusher delivers updates instantly when it works,
  // but a single dropped message (a brief network blip on the venue's
  // projector connection, which Pusher's client can recover from without
  // any visible reconnect) previously left this screen frozen on stale
  // data indefinitely - unlike every other viewer, who self-corrects via
  // the poll above within ~6s. This runs the same kind of poll, but only
  // acts on it while no reveal animation is in flight (skipTurnState),
  // so it never fights the cinematic transition on a normal update - it
  // only steps in exactly when a missed "new player" event would have
  // otherwise left nothing animating at all.
  useEffect(() => {
    if (!isPresenter) return
    const interval = setInterval(async () => {
      try {
        // no-store: without this, some browsers will silently keep reusing
      // their own cached copy of this URL well past the server's intended
      // 2s freshness window (s-maxage only governs Vercel's shared edge
      // cache, not a visitor's own browser cache) - leaving the screen
      // stuck on stale data through every subsequent poll, and even a
      // manual refresh, since that still consults the browser's own cache
      // for this same URL. This forces every poll to actually reach
      // Vercel's edge, which is where the real freshness policy lives.
      const response = await fetch(`/api/auction/${auction.id}/snapshot`, { cache: 'no-store' })
        if (!response.ok) return
        const data = await response.json()
        applySnapshot({
          currentPlayer: data.currentPlayer,
          players: data.players,
          bidders: data.bidders,
          bidHistory: data.bidHistory,
          poolExhausted: data.poolExhausted,
          recentSales: data.recentSales ?? [],
        }, { skipTurnState: showPlayerReveal || !!pendingPlayer })
      } catch (error) {
        logger.error('Presenter safety-net poll failed:', error)
      }
    }, 6000)
    return () => clearInterval(interval)
  }, [isPresenter, auction.id, applySnapshot, showPlayerReveal, pendingPlayer])

  // Real-time subscriptions. Only the presenter link actually subscribes to
  // Pusher (see the `enabled` argument) - every other viewer relies on the
  // poll above instead.
  const { isConnected: pusherConnected } = usePusher(auction.id, {
    onNewBid: (data) => {
      console.log('[PublicAuctionView] onNewBid callback triggered', data)
      logger.log('PublicAuctionView onNewBid')
      
      // Batch critical state updates - React 18 automatically batches these
      // This reduces from 4-5 re-renders to just 1
      setCurrentBid({
        bidderId: data.bidderId,
        amount: data.amount,
        bidderName: data.bidderName,
        teamName: data.teamName
      })
      setHighestBidderId(data.bidderId)

      // Update bid history (separate update for large arrays)
      setBidHistory(prev => {
        logger.log('PublicAuctionView updating bid history', { prevLength: prev.length })
        // Add newest bid at the beginning (latest first)
        return [{
          bidderId: data.bidderId,
          amount: data.amount,
          timestamp: new Date(),
          bidderName: data.bidderName,
          teamName: data.teamName,
          playerId: currentPlayer?.id, // Associate bid with current player
          type: 'bid'
        }, ...prev]
      })
      
      // Update purse instantly from Pusher data (no API call needed)
      if (data.remainingPurse !== undefined) {
        setBiddersState(prev => prev.map(b => 
          b.id === data.bidderId 
            ? { ...b, remainingPurse: data.remainingPurse! }
            : b
        ))
      }
    },
    onPlayerSold: (data) => {
      logger.log('PublicAuctionView player sold')
      
      // Update players state to reflect sold status (for real-time stats update)
      if (data.playerId) {
        setPlayers(prev => prev.map(p => 
          p.id === data.playerId 
            ? { ...p, status: 'SOLD' as const, soldTo: data.bidderId, soldPrice: data.amount }
            : p
        ))
      }
      
      // Add sold event to bid history using the latest bid in history
      setBidHistory(prev => {
        const latestBid = prev.length > 0 ? prev[0] : null // Latest is now first
        if (latestBid && latestBid.type === 'bid') {
          return [{
            type: 'sold',
            playerName: data?.playerName || (currentPlayer as any)?.data?.name || 'Player',
            bidderId: latestBid.bidderId,
            bidderName: latestBid.bidderName,
            teamName: latestBid.teamName,
            amount: latestBid.amount,
            timestamp: new Date(),
            playerId: currentPlayer?.id
          }, ...prev] // Add at beginning
        }
        return prev
      })
      
      // Update purse instantly from Pusher data (no API call needed)
      if (data.bidderRemainingPurse !== undefined && data.bidderId) {
        setBiddersState(prev => prev.map(b => 
          b.id === data.bidderId 
            ? { ...b, remainingPurse: data.bidderRemainingPurse! }
            : b
        ))
      } else if (data.updatedBidders) {
        // Batch update multiple bidders
        setBiddersState(prev => prev.map(b => {
          const update = data.updatedBidders!.find(ub => ub.id === b.id)
          return update ? { ...b, remainingPurse: update.remainingPurse } : b
        }))
      }
      
      setSoldInfo({ teamName: data.teamName, bidderName: data.bidderName })
      setSoldAnimation(true)
      setTimeout(() => {
        setSoldAnimation(false)
        // Don't reload - updates are handled via Pusher
      }, 3000)
    },
    onNewPlayer: (data) => {
      setPoolExhausted(false)
      // Store the new player and show reveal animation
      setPendingPlayer(data.player as Player)
      setShowPlayerReveal(true)
      // Don't update current player yet - wait for animation to complete
    },
    onAuctionPoolExhausted: () => {
      setPoolExhausted(true)
    },
    onAuctionEnded: () => {
      window.location.reload()
    },
    onBidUndo: (data) => {
      console.log('[PublicAuctionView] onBidUndo callback triggered', data)
      logger.log('PublicAuctionView onBidUndo', { data, currentBidHistoryLength: bidHistory.length })
      
      // Update bid history: remove the undone bid and add "BID UNDONE" entry
      setBidHistory(prev => {
        if (prev.length === 0) return prev

        // Find the first ACTUAL bid (skip bid-undo entries at the top)
        const firstBidIndex = prev.findIndex(entry => !entry.type || entry.type === 'bid')
        
        if (firstBidIndex === -1) {
          logger.log('Cannot undo: no actual bids found in history')
          return prev
        }
        
        const undoneBid = prev[firstBidIndex]
        logger.log('Undoing bid at index', firstBidIndex, undoneBid)
        
        // Remove the undone bid from history
        const withoutUndone = prev.filter((_, index) => index !== firstBidIndex)

        // Add visible "BID UNDONE" entry at the beginning
        return [{
          bidderId: undoneBid.bidderId,
          amount: undoneBid.amount,
          timestamp: new Date(),
          bidderName: undoneBid.bidderName,
          teamName: undoneBid.teamName,
          type: 'bid-undo' as const,
          playerId: undoneBid.playerId
        }, ...withoutUndone]
      })
      
      // Update current bid to previous bid (from Pusher data)
      if (data.currentBid && data.currentBid.amount > 0) {
        setCurrentBid({
          bidderId: data.currentBid.bidderId,
          amount: data.currentBid.amount,
          bidderName: data.currentBid.bidderName,
          teamName: data.currentBid.teamName
        })
        setHighestBidderId(data.currentBid.bidderId)
      } else {
        setCurrentBid(null)
        setHighestBidderId(null)
      }
      
      // Update purse instantly from Pusher data if available
      if (data.remainingPurse !== undefined && data.bidderId) {
        setBiddersState(prev => prev.map(b => 
          b.id === data.bidderId 
            ? { ...b, remainingPurse: data.remainingPurse! }
            : b
        ))
      }
    },
    onSaleUndo: () => {
      window.location.reload()
    },
    onPlayersUpdated: (data) => {
      // Update players state if provided (for real-time stats update)
      if (data.players) {
        setPlayers(prev => prev.map(p => {
          const update = data.players!.find(up => up.id === p.id)
          // Merge rather than replace - the broadcast only carries the
          // fields that changed (status/soldTo/soldPrice), not the full
          // player record, to keep the Pusher payload small.
          return update ? { ...p, ...update } : p
        }))
      }
      
      // Update from Pusher data if available (no API call needed)
      if (data.bidders) {
        setBiddersState(prev => prev.map(b => {
          const update = data.bidders!.find(ub => ub.id === b.id)
          return update ? { ...b, remainingPurse: update.remainingPurse } : b
        }))
      }
    },
  }, isPresenter)

  // Extract player data from JSON
  const getPlayerData = (player: Player | null) => {
    if (!player || !player.data) return {}
    return player.data as Record<string, any>
  }

  // Memoized so it's a stable reference across re-renders of the same
  // player (every incoming bid re-renders this component) - both this and
  // the derived stats below were previously recomputed from scratch on
  // every render regardless of whether the player on screen had changed.
  const playerData = useMemo(() => getPlayerData(currentPlayer), [currentPlayer])
  const playerName = playerData.name || playerData.Name || 'No Player Selected'
  // extractBattingStats/extractBowlingStats each rebuild a normalized map of
  // every field on the player's raw uploaded data - real, avoidable work
  // when only the purse/bid amount changed, not the player.
  const battingStats = useMemo(() => extractBattingStats(playerData), [playerData])
  const bowlingStats = useMemo(() => extractBowlingStats(playerData), [playerData])
  const cricherosLink = useMemo(() => extractCricheroesLink(playerData), [playerData])

  // Determine auction phase based on player status and icon status
  const auctionPhase = useMemo(() => {
    if (!currentPlayer || players.length === 0) return null
    
    const totalPlayers = players.length
    const soldPlayers = players.filter(p => p.status === 'SOLD').length
    const unsoldPlayers = players.filter(p => p.status === 'UNSOLD').length
    const availablePlayers = players.filter(p => p.status === 'AVAILABLE').length
    
    // Bidder Choice players phase
    const iconPlayers = players.filter(p => (p as any).isIcon === true)
    const soldIconPlayers = iconPlayers.filter(p => p.status === 'SOLD').length
    const unsoldIconPlayers = iconPlayers.filter(p => p.status === 'UNSOLD').length
    const availableIconPlayers = iconPlayers.filter(p => p.status === 'AVAILABLE').length
    
    // Check if current player is icon
    const currentPlayerIsIcon = (currentPlayer as any)?.isIcon === true
    
    // Phase 1: Bidder Choice Auction (if Bidder Choice players exist and current is Bidder Choice or Bidder Choice players not finished)
    if (iconPlayers.length > 0 && (currentPlayerIsIcon || availableIconPlayers > 0)) {
      return {
        type: 'BIDDER_CHOICE',
        message: '⭐ Bidder Choice Auction Going On',
        color: 'from-purple-600 to-pink-600'
      }
    }
    
    // Phase 3: Remaining/Unsold Players (if there are unsold players and no available regular players left)
    if (unsoldPlayers > 0 && availablePlayers > 0 && availablePlayers === unsoldPlayers) {
      return {
        type: 'REMAINING_PLAYERS',
        message: '🔄 Remaining Players Auction Going On',
        color: 'from-orange-600 to-red-600'
      }
    }
    
    // Phase 2: Regular Players (default for all other cases when auction is ongoing)
    if (availablePlayers > 0) {
      return {
        type: 'ALL_PLAYERS',
        message: '🎯 All Player Auction Running',
        color: 'from-blue-600 to-cyan-600'
      }
    }
    
    return null
  }, [currentPlayer, players])

  // Get all player names for reveal animation
  // Only include AVAILABLE players (exclude SOLD, UNSOLD, RETIRED)
  const allPlayerNames = useMemo(() => {
    // Filter out SOLD, UNSOLD, and RETIRED players - only show AVAILABLE players
    const availablePlayers = players.filter(p => p.status === 'AVAILABLE')
    
    // If we have a pending player, make sure it's included (even if not in players array yet)
    const allPlayers = [...availablePlayers]
    if (pendingPlayer && !allPlayers.find(p => p.id === pendingPlayer.id)) {
      // Only add pending player if it's AVAILABLE
      if (pendingPlayer.status === 'AVAILABLE') {
        allPlayers.push(pendingPlayer)
      }
    }
    
    // Extract names and filter out empty/undefined names
    const names = allPlayers
      .map(p => {
        const data = p.data as any
        return data?.name || data?.Name || data?.player_name || null
      })
      .filter((name): name is string => name !== null && name !== undefined && name !== '')
    
    return names.length > 0 ? names : ['Player 1', 'Player 2', 'Player 3'] // Fallback if no names
  }, [players, pendingPlayer])

  const pendingPlayerName = useMemo(() => {
    if (!pendingPlayer) return ''
    const data = pendingPlayer.data as any
    return data?.name || data?.Name || data?.player_name || 'Unknown Player'
  }, [pendingPlayer])

  const getProfilePhotoUrl = useCallback((playerData: any): string | undefined => {
    const possibleKeys = [
      'Profile Photo',
      'profile photo',
      'Profile photo',
      'PROFILE PHOTO',
      'profile_photo',
      'ProfilePhoto'
    ]

    const rawValue = possibleKeys
      .map(key => playerData?.[key])
      .find(value => value !== undefined && value !== null && String(value).trim() !== '')

    if (!rawValue) {
      return undefined
    }

    const photoStr = String(rawValue).trim()

    let match = photoStr.match(/\/d\/([a-zA-Z0-9_-]+)/)
    if (match && match[1]) {
      return `/api/proxy-image?id=${match[1]}`
    }

    match = photoStr.match(/[?&]id=([a-zA-Z0-9_-]+)/)
    if (match && match[1]) {
      return `/api/proxy-image?id=${match[1]}`
    }

    if (photoStr.startsWith('http://') || photoStr.startsWith('https://')) {
      return photoStr
    }

    return undefined
  }, [])

  // Presenter mode (?presenter=1) is a dedicated full-screen stage meant to
  // be projected for a room to watch, not the interactive per-viewer page -
  // see the design brief this came from. It reuses all the same state above
  // (currentPlayer, currentBid, stats, live Pusher connection) but renders a
  // completely different layout: full attention on the player photo and one
  // big "Current Bid" number, everything else that isn't essential to read
  // from across a room removed. The regular public view below is untouched.
  if (isPresenter) {
    const presenterRole = playerData?.Speciality || playerData?.speciality || playerData?.Role || playerData?.role
    const presenterBasePrice = Number(playerData?.['Base Price'] || playerData?.['base price']) || 1000
    const presenterPhotoUrl = getProfilePhotoUrl(playerData)
    const presenterBattingStats = battingStats
    const presenterBowlingStats = bowlingStats
    const presenterIsBidderChoice = !!(currentPlayer?.isIcon || (currentPlayer?.data as any)?.isIcon)
    const presenterCricherosLink = cricherosLink

    return (
      <>
        <GoingLiveBanner show={showGoingLiveBanner} onComplete={() => setShowGoingLiveBanner(false)} />
        {!showGoingLiveBanner && (
          <div className="h-screen w-screen overflow-hidden bg-[#05070a] flex flex-col">
            {/* Top strip - auction name, LIVE, sold/left count, connection status. Nothing else. */}
            <div className="relative flex items-center justify-between px-6 py-2.5 border-b border-white/10 flex-shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-sm font-black text-white uppercase tracking-tight truncate">{auction.name}</span>
                <Badge className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 gap-1 animate-pulse flex-shrink-0">● LIVE</Badge>
              </div>
              <div className="flex items-center gap-3 text-xs font-bold text-white/55 flex-shrink-0">
                <span><span className="text-amber-400">{stats.sold}</span> sold</span>
                <span className="text-white/20">&middot;</span>
                <span><span className="text-teal-400">{stats.remaining}</span> left</span>
                <span className="text-white/20">&middot;</span>
                <span>{stats.total} total</span>
                <span className={`inline-flex items-center gap-1.5 ${pusherConnected ? 'text-emerald-400' : 'text-red-400'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${pusherConnected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
                  {pusherConnected ? 'Live' : 'Reconnecting…'}
                </span>
              </div>
            </div>

            {/* Stage */}
            <div className="relative flex-1 flex min-h-0">
              <AnimatePresence>
                {soldAnimation && (
                  <motion.div
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0, opacity: 0 }}
                    className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-green-500 text-white"
                  >
                    <div className="text-7xl lg:text-8xl font-black">SOLD!</div>
                    {(soldInfo?.teamName || soldInfo?.bidderName) && (
                      <div className="text-2xl lg:text-3xl font-extrabold text-white/90">
                        {[soldInfo.teamName, soldInfo.bidderName].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {showPlayerReveal && pendingPlayer && (
                  <PlayerRevealAnimation
                    allPlayerNames={allPlayerNames}
                    finalPlayerName={pendingPlayerName}
                    onComplete={handleRevealComplete}
                    duration={5000}
                  />
                )}
              </AnimatePresence>

              {poolExhausted ? (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center space-y-3">
                    <h3 className="text-3xl lg:text-4xl font-black text-white">All Players Sold</h3>
                    <p className="text-white/60 text-base lg:text-lg">Results will be shared shortly.</p>
                  </div>
                </div>
              ) : (
                <>
                  {/* Left: photo - dominant, not full-bleed */}
                  <div className="relative w-[58%] h-full overflow-hidden bg-gradient-to-br from-[#1c2b2a] via-[#10181b] to-[#05070a] flex-shrink-0">
                    <div className="absolute -top-[30%] left-[10%] w-24 h-[160%] bg-gradient-to-b from-amber-400/10 to-transparent blur-sm rotate-[-10deg] pointer-events-none" />
                    {presenterPhotoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={presenterPhotoUrl} alt={playerName} className="w-full h-full object-contain" />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center opacity-20">
                        <svg width="220" height="380" viewBox="0 0 220 380" fill="none" stroke="#5eead4" strokeWidth={2.5}>
                          <circle cx="110" cy="80" r="55"></circle>
                          <path d="M25 375 C25 235 55 180 110 180 C165 180 195 235 195 375"></path>
                        </svg>
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-[#05070a]/95" />
                  </div>

                  {/* Right: identity + the big Current Bid number + compact stat strip */}
                  <div className="relative flex-1 h-full bg-[#080b0f] flex flex-col justify-center px-8 lg:px-14 py-6 overflow-y-auto min-w-0">
                    {/* Divider fades at both ends instead of a hard-edged line */}
                    <div className="absolute inset-y-0 left-0 w-px bg-gradient-to-b from-transparent via-white/15 to-transparent" />
                    {presenterRole && (
                      <span className="text-base lg:text-xl font-extrabold text-teal-400 uppercase tracking-wide mb-1.5">{presenterRole}</span>
                    )}
                    <h1 className="text-3xl lg:text-6xl font-black text-white uppercase tracking-tight leading-[0.98] mb-3 break-words">
                      {playerName}
                    </h1>
                    {/* Badges, not fine print - this reads from across a
                        room, so base/last-year price get the same
                        pill treatment as the "Bidder Choice"/Cricheroes
                        badges further down, just carrying a number. */}
                    <div className="flex flex-wrap items-center gap-3 mb-6">
                      <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-4 py-2">
                        <span className="text-xs lg:text-sm font-bold uppercase tracking-wide text-white/50">Base</span>
                        <span className="text-lg lg:text-2xl font-black text-white tabular-nums">₹{presenterBasePrice.toLocaleString('en-IN')}</span>
                      </div>
                      {currentPlayer?.lastYearPrice != null && (
                        <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-400/10 px-4 py-2">
                          <span className="text-xs lg:text-sm font-bold uppercase tracking-wide text-amber-200/80">Last Year</span>
                          <span className="text-lg lg:text-2xl font-black text-amber-400 tabular-nums">₹{currentPlayer.lastYearPrice.toLocaleString('en-IN')}</span>
                          {currentPlayer.lastYearTeamName && (
                            <span className="text-xs lg:text-sm font-bold text-amber-200/70">· {currentPlayer.lastYearTeamName}</span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* The scoreboard - the single most important number in the room */}
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={currentBid ? `${currentBid.bidderId}-${currentBid.amount}` : 'no-bid'}
                        initial={{ opacity: 0, scale: 0.94 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.25 }}
                        className="rounded-2xl border-[1.5px] border-teal-400/40 bg-gradient-to-br from-teal-400/15 to-teal-400/[0.02] px-6 lg:px-8 py-5 lg:py-6 mb-6 shadow-[0_0_60px_rgba(45,212,191,0.12)]"
                      >
                        <div className="text-xs font-extrabold text-teal-200 uppercase tracking-widest mb-1.5">Current Bid</div>
                        {currentBid ? (
                          <>
                            <div className="text-4xl lg:text-5xl font-black text-amber-400 tracking-tight">
                              ₹{currentBid.amount.toLocaleString('en-IN')}
                            </div>
                            <div className="text-sm lg:text-base font-bold text-white/70 mt-1 truncate">
                              {[currentBid.teamName, currentBid.bidderName].filter(Boolean).join(' · ')}
                            </div>
                          </>
                        ) : (
                          <div className="text-3xl lg:text-4xl font-black text-amber-400">No Bids Yet</div>
                        )}
                      </motion.div>
                    </AnimatePresence>

                    {/* Career stats - a headline rate-stat row per discipline
                        (as before), now with room to add a supporting row of
                        tiles for the next-most-useful numbers, rather than
                        just cramming more into one line. */}
                    {(presenterBattingStats || presenterBowlingStats) && (
                      <div className="flex flex-col gap-4 mb-6">
                        {presenterBattingStats && (
                          <div>
                            <div className="flex items-center gap-4 text-base lg:text-xl flex-wrap mb-3">
                              <BatIcon size={26} />
                              {presenterBattingStats.runs !== undefined && <span className="font-black text-white tabular-nums">{presenterBattingStats.runs} Runs</span>}
                              {presenterBattingStats.average !== undefined && <span className="font-bold text-white/60">Avg <b className="text-white tabular-nums">{presenterBattingStats.average.toFixed(2)}</b></span>}
                              {presenterBattingStats.strikeRate !== undefined && <span className="font-bold text-white/60">SR <b className="text-white tabular-nums">{presenterBattingStats.strikeRate.toFixed(2)}</b></span>}
                            </div>
                            {(presenterBattingStats.matches !== undefined || presenterBattingStats.highest !== undefined || presenterBattingStats.fours !== undefined || presenterBattingStats.sixes !== undefined) && (
                              <div className="grid grid-cols-4 gap-3">
                                {presenterBattingStats.matches !== undefined && <StatTile size="lg" label="Matches" value={presenterBattingStats.matches} />}
                                {presenterBattingStats.highest !== undefined && <StatTile size="lg" label="Highest" value={presenterBattingStats.highest} />}
                                {presenterBattingStats.fours !== undefined && <StatTile size="lg" label="4s" value={presenterBattingStats.fours} />}
                                {presenterBattingStats.sixes !== undefined && <StatTile size="lg" label="6s" value={presenterBattingStats.sixes} />}
                              </div>
                            )}
                          </div>
                        )}
                        {presenterBowlingStats && (
                          <div>
                            <div className="flex items-center gap-4 text-base lg:text-xl flex-wrap mb-3">
                              <BallIcon size={26} />
                              {presenterBowlingStats.wickets !== undefined && <span className="font-black text-white tabular-nums">{presenterBowlingStats.wickets} Wkts</span>}
                              {presenterBowlingStats.economy !== undefined && <span className="font-bold text-white/60">Econ <b className="text-white tabular-nums">{presenterBowlingStats.economy.toFixed(2)}</b></span>}
                              {presenterBowlingStats.average !== undefined && <span className="font-bold text-white/60">Avg <b className="text-white tabular-nums">{presenterBowlingStats.average.toFixed(2)}</b></span>}
                            </div>
                            {(presenterBowlingStats.matches !== undefined || presenterBowlingStats.best !== undefined || presenterBowlingStats.maidens !== undefined || presenterBowlingStats.overs !== undefined) && (
                              <div className="grid grid-cols-4 gap-3">
                                {presenterBowlingStats.matches !== undefined && <StatTile size="lg" label="Matches" value={presenterBowlingStats.matches} />}
                                {presenterBowlingStats.best !== undefined && <StatTile size="lg" label="Best" value={presenterBowlingStats.best} />}
                                {presenterBowlingStats.maidens !== undefined && <StatTile size="lg" label="Maidens" value={presenterBowlingStats.maidens} />}
                                {presenterBowlingStats.overs !== undefined && <StatTile size="lg" label="Overs" value={presenterBowlingStats.overs} />}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex items-center gap-2 flex-wrap">
                      {presenterIsBidderChoice && (
                        <span className="text-[11px] font-extrabold text-purple-200 bg-purple-500/20 border border-purple-400/35 rounded-md px-3 py-1.5 uppercase tracking-wide">★ Bidder Choice</span>
                      )}
                      {presenterCricherosLink && (
                        <span className="text-[11px] font-extrabold text-green-300 bg-green-600/15 border border-green-500/30 rounded-md px-3 py-1.5">Cricheroes.com</span>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
            <SoldTicker sales={recentSales} variant="inline" />
          </div>
        )}
      </>
    )
  }

  return (
    <>
      {/* Going Live Banner - Full Page Overlay */}
      <GoingLiveBanner 
        show={showGoingLiveBanner} 
        onComplete={() => setShowGoingLiveBanner(false)}
      />
      
      {/* Hide main content when banner is showing */}
      {!showGoingLiveBanner && (
    /* pb-48 (was pb-40): the extra room is for the sold ticker's own h-8
       bar, which now sits fixed below the branding footer on mobile - see
       SoldTicker below and the footer's bottom-8 offset in page.tsx. */
    <div className="pb-48 sm:pb-3 bg-[#05070a]">
      <div className="max-w-7xl mx-auto">
        {/* Stage - a fixed-composition "broadcast" surface: every row below
            is sized off real content (not viewport units), specifically so
            the whole stage fits without an extra page-level scroll on both
            phones and laptops - the one intentional exception is the
            Play-by-Play list, which gets its own small contained scroll for
            overflow bids, the same way the previous Live Activity card
            already scrolled internally (max-h + overflow-y-auto), not the
            page. Full-bleed, no card padding/rounding/margin - this is
            meant to read as one continuous dark stage with the page around
            it (which is also forced dark, see page.tsx), not a dark box
            floating on a light page. */}
        <div className="relative bg-[#05070a] overflow-hidden">
          {/* Ambient spotlight beams - decorative only */}
          <div className="hidden sm:block absolute -top-[20%] left-[3%] w-24 h-[130%] origin-top bg-gradient-to-b from-amber-400/10 to-transparent blur-sm rotate-[-10deg] pointer-events-none" />
          <div className="hidden sm:block absolute -top-[20%] right-[3%] w-24 h-[130%] origin-top bg-gradient-to-b from-amber-400/10 to-transparent blur-sm rotate-[10deg] pointer-events-none" />

          {/* Desktop header */}
          <div className="hidden sm:flex relative items-center justify-between px-4 py-2.5 border-b border-white/10">
            <div
              className="absolute inset-y-0 left-0 w-[30%] bg-amber-400/90 pointer-events-none"
              style={{ clipPath: 'polygon(0 0, 70% 0, 40% 100%, 0 100%)' }}
            />
            <div className="relative flex items-center gap-3">
              <h1 className="text-base font-black text-white uppercase tracking-tight">{auction.name}</h1>
              <Badge className="bg-red-500 text-white text-[9px] font-bold px-2 py-0.5 gap-1 animate-pulse">● LIVE</Badge>
            </div>
            <div className="relative flex items-center gap-4">
              <StatsDisplay
                total={stats.total}
                sold={stats.sold}
                unsold={stats.unsold}
                remaining={stats.remaining}
              />
              <span className="inline-flex items-center gap-1 text-gray-400 text-xs font-semibold">
                <Eye className="h-3 w-3" /> {viewerCount || 0}
              </span>
              {isPresenter ? (
                <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${pollHealthy ? 'text-emerald-400' : 'text-red-400'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${pollHealthy ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
                  {pollHealthy ? 'Live' : 'Reconnecting…'}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => fetchSnapshot()}
                  className="inline-flex items-center gap-1 text-gray-400 hover:text-white text-xs font-semibold transition-colors"
                  title="Refresh now"
                >
                  <RefreshCw className="h-3 w-3" /> Refresh
                </button>
              )}
              <Link href={`/auction/${auction.id}/teams`} target="_blank" rel="noopener noreferrer">
                <Button className="bg-white/10 hover:bg-white/20 text-white border-white/20 h-8 text-xs" size="sm">
                  <Trophy className="h-3 w-3 mr-1" />
                  All Players &amp; Teams
                </Button>
              </Link>
            </div>
          </div>

          {/* Mobile header - same auction.name/stats data as desktop, compact */}
          <div className="sm:hidden relative overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 w-[46%] h-[50px] bg-amber-400/90 pointer-events-none"
              style={{ clipPath: 'polygon(0 0, 70% 0, 40% 100%, 0 100%)' }}
            />
            <div className="relative flex items-center justify-between gap-2 px-3 py-2">
              <span className="text-[11px] font-black text-white uppercase truncate min-w-0">{auction.name}</span>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <Badge className="bg-red-500 text-white text-[8px] font-bold px-1.5 py-0.5 gap-1 animate-pulse">● LIVE</Badge>
                <span className="text-[9px] font-bold text-amber-400">{stats.sold} sold</span>
                <span className="text-[9px] font-bold text-gray-500">&middot; {stats.remaining} left</span>
                {isPresenter ? (
                  <span className={`inline-flex items-center gap-1 text-[9px] font-bold ${pollHealthy ? 'text-emerald-400' : 'text-red-400'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${pollHealthy ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
                    {pollHealthy ? 'Live' : 'Reconnecting'}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => fetchSnapshot()}
                    className="inline-flex items-center gap-0.5 text-gray-400 text-[9px] font-bold flex-shrink-0"
                    title="Refresh now"
                  >
                    <RefreshCw className="h-2.5 w-2.5" />
                  </button>
                )}
              </div>
            </div>
            <div className="relative h-[3px] bg-white/10 mx-3 mb-2 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-400"
                style={{ width: `${stats.total > 0 ? ((stats.sold + stats.unsold) / stats.total * 100) : 0}%` }}
              />
            </div>
          </div>

          {/* Moment banner - real auctionPhase content. A solid pill, not a
              second diagonal-cut shape - the header wedge is the page's one
              diagonal accent, so this doesn't compete with it. */}
          {auctionPhase && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              className="relative flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-2.5"
            >
              <span className="bg-amber-400 text-black font-black text-[9px] sm:text-[11px] uppercase tracking-wider px-3 sm:px-4 py-1 sm:py-1.5 rounded-full whitespace-nowrap">
                {auctionPhase.message}
              </span>
              <div className="h-px flex-1 bg-white/20" />
            </motion.div>
          )}

          {/* Main stage grid */}
          <div className="relative grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-3 lg:gap-5 px-2 sm:px-4 pb-3 sm:pb-4">
            {/* Player podium */}
            <div className="relative">
              <AnimatePresence>
                {soldAnimation && (
                  <motion.div
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0, opacity: 0 }}
                    className="absolute inset-0 flex items-center justify-center bg-green-500 text-white text-6xl font-bold z-50 rounded-lg"
                  >
                    SOLD!
                  </motion.div>
                )}
              </AnimatePresence>

              {isClient && (
                <div className="relative">
                  {/* Pool exhausted: nothing left to auction. Shown above the
                      (now stale) last-sold player card instead of leaving
                      spectators looking at a frozen screen with no explanation. */}
                  {poolExhausted && (
                    <div className="mb-3 rounded-xl border-2 border-purple-300 dark:border-purple-700 bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-950/40 dark:to-indigo-950/40 p-4 sm:p-6 text-center space-y-2">
                      <h3 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-gray-100">🎉 All Players Sold</h3>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        Every player has been auctioned. Results will be shared shortly.
                      </p>
                    </div>
                  )}
                  <AnimatePresence>
                    {showPlayerReveal && pendingPlayer && (
                      <PlayerRevealAnimation
                        allPlayerNames={allPlayerNames}
                        finalPlayerName={pendingPlayerName}
                        onComplete={handleRevealComplete}
                        duration={5000}
                      />
                    )}
                  </AnimatePresence>

                  <PlayerCard
                    currentBid={currentBid}
                    lastYear={currentPlayer?.lastYearPrice != null ? {
                      price: currentPlayer.lastYearPrice,
                      teamName: currentPlayer.lastYearTeamName,
                      auctionName: currentPlayer.lastYearAuctionName,
                    } : null}
                    name={playerName}
                    imageUrl={(() => {
                      const keys = ['Profile Photo', 'profile photo', 'Profile photo', 'PROFILE PHOTO', 'profile_photo', 'ProfilePhoto']
                      const value = keys.map(key => playerData?.[key]).find(v => v && String(v).trim())
                      if (!value) {
                        console.log('DEBUG - Player data fields:', Object.keys(playerData))
                        return undefined
                      }
                      const photoStr = String(value).trim()
                      let match = photoStr.match(/\/d\/([a-zA-Z0-9_-]+)/)
                      if (match && match[1]) {
                        return `/api/proxy-image?id=${match[1]}`
                      }
                      match = photoStr.match(/[?&]id=([a-zA-Z0-9_-]+)/)
                      if (match && match[1]) {
                        return `/api/proxy-image?id=${match[1]}`
                      }
                      if (photoStr.startsWith('http://') || photoStr.startsWith('https://')) {
                        return photoStr
                      }
                      return undefined
                    })()}
                    basePrice={(currentPlayer?.data as any)?.['Base Price'] || (currentPlayer?.data as any)?.['base price'] || 1000}
                    tags={((currentPlayer as any)?.isIcon || (currentPlayer?.data as any)?.isIcon) ? [{ label: 'Bidder Choice', color: 'purple' }] : []}
                    profileLink={cricherosLink}
                    battingStats={battingStats}
                    bowlingStats={bowlingStats}
                    fields={(() => {
                      const essentials: Array<{ label: string; value: string }> = []
                      const add = (label: string, keys: string[]) => {
                        for (const key of keys) {
                          const v = (playerData as any)[key]
                          if (v) {
                            essentials.push({ label, value: String(v) })
                            return
                          }
                        }
                      }
                      add('Batting', ['Batting', 'batting', 'Batting Type', 'batting type', 'BAT', 'Bat'])
                      add('Bowling', ['Bowling', 'bowling', 'Bowling Type', 'bowling type', 'BOWL', 'Bowl'])
                      add('Fielding', ['Fielding', 'fielding', 'FIELD', 'Field'])
                      add('Speciality', ['Speciality', 'speciality', 'Specialty', 'specialty', 'Role', 'role'])
                      add('Wicket Keeper', ['Wicket Keeper', 'wicket keeper', 'Wicket Keeper', 'WicketKeeper', 'wicketKeeper', 'WK', 'wk'])
                      return essentials
                    })()}
                  />

                  {/* "All Players & Teams" already lives in the header
                      (always visible, not just here) - a second copy of the
                      same button right under the card was a duplicate entry
                      point to the same destination, so it's gone rather than
                      repeated. */}
                  <div className="sm:hidden mt-2">
                    <BidAmountStrip
                      amount={currentBid?.amount ?? null}
                      bidderName={currentBid?.bidderName}
                      teamName={currentBid?.teamName}
                      auctionId={auction.id}
                    />
                  </div>

                  {/* Mobile-only pulse status. Not a second "Live Bids" button -
                      it opens the same sheet the header link on desktop opens
                      Play-by-Play for, but isn't labeled as its own entry point. */}
                  {recentBidCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setBidHistoryModalOpen(true)}
                      className="sm:hidden mt-2 w-full flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2.5"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
                      <span className="flex-1 text-left text-xs font-semibold text-gray-200">
                        {recentBidCount} bid{recentBidCount !== 1 ? 's' : ''} in the last minute
                      </span>
                      <ChevronRight className="h-3.5 w-3.5 text-gray-500 flex-shrink-0" />
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Play by Play - desktop only, same bidHistory data and same
                job as the previous Live Activity card; mobile keeps using
                the existing bottom-sheet modal below instead, unchanged. */}
            <div className="hidden lg:flex lg:flex-col lg:min-h-0">
              <div className="flex items-center gap-2 mb-2 flex-shrink-0">
                <span className="text-white text-[11px] font-black uppercase tracking-widest">Play by Play</span>
                <div className="h-px flex-1 bg-white/15" />
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto space-y-2.5 pr-1">
                {bidHistory.length === 0 ? (
                  <>
                    <div className="text-gray-500 text-xs font-semibold px-1 pb-3 mb-1 border-b border-white/10">
                      No bids yet on this lot
                    </div>
                    {recentSales.length > 0 ? (
                      <>
                        <div className="text-gray-600 text-[10px] font-black uppercase tracking-widest px-1 pb-1">
                          Recently Sold
                        </div>
                        {recentSales.map(sale => (
                          <div key={sale.id} className="pl-3 border-l-[3px] border-white/10">
                            <div className="font-black uppercase truncate text-gray-300 text-sm">
                              {sale.name}
                            </div>
                            <div className="flex items-center gap-1.5 text-xs">
                              <span className="font-bold tabular-nums text-emerald-400">₹{sale.price.toLocaleString('en-IN')}</span>
                              <span className="text-gray-600">&middot;</span>
                              <span className="text-gray-500 truncate">{sale.buyer}</span>
                            </div>
                          </div>
                        ))}
                      </>
                    ) : (
                      <div className="text-gray-600 text-xs px-1">Bidding will appear here the moment it starts.</div>
                    )}
                  </>
                ) : (
                  bidHistory.map((bid, index) => (
                    <div
                      key={`${bid.bidderId}-${bid.amount}-${index}`}
                      className={`pl-3 border-l-[3px] ${index === 0 ? 'border-amber-400' : 'border-white/10'}`}
                    >
                      <div className={`font-black uppercase truncate ${index === 0 ? 'text-white text-base' : 'text-gray-300 text-sm'}`}>
                        {bid.bidderName}
                      </div>
                      <div className={`font-bold tabular-nums ${index === 0 ? 'text-amber-400 text-sm' : 'text-gray-500 text-xs'}`}>
                        {formatCurrency(bid.amount)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>


      {/* Mobile Bid History Bottom Modal */}
      <Dialog open={bidHistoryModalOpen} onOpenChange={setBidHistoryModalOpen}>
        <DialogContent className="!fixed !bottom-0 !left-0 !right-0 !top-auto !translate-x-0 !translate-y-0 !w-full !max-w-full rounded-t-lg p-0 sm:hidden" style={{ maxHeight: '70vh', display: 'flex', flexDirection: 'column' }} showCloseButton={false}>
          <div className="bg-gray-50 dark:bg-gray-900 rounded-t-lg flex flex-col" style={{ maxHeight: '70vh' }}>
            {/* Drag Handle */}
            <div className="w-12 h-1 bg-gray-300 dark:bg-gray-600 rounded-full mx-auto mt-2 mb-4" />
            
            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
              <DialogTitle className="text-lg font-semibold text-gray-900 dark:text-gray-100">Live Bid History</DialogTitle>
              <DialogDescription className="sr-only">View the live bidding history for this player</DialogDescription>
            </div>
            
            {/* Bid History Content */}
            <div className="px-4 py-2 space-y-2 flex-1 overflow-y-auto" key={`bid-history-content-${bidHistory.length}-${currentPlayer?.id}`}>
              {bidHistory.length === 0 ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  <p>No bids yet</p>
                </div>
              ) : (
                bidHistory.map((bid, index) => {
                  // Use unique key for each bid entry
                  const bidKey = bid.bidderId && bid.amount && bid.timestamp 
                    ? `${bid.bidderId}-${bid.amount}-${new Date(bid.timestamp).getTime()}-${index}`
                    : `bid-${index}-${bid.type || 'bid'}`
                  
                  // Handle sold/unsold events
                  if (bid.type === 'sold') {
                    const bidTime = new Date(bid.timestamp)
                    let timeAgo = ''
                    if (isClient) {
                      const now = new Date()
                      const timeDiff = Math.floor((now.getTime() - bidTime.getTime()) / 1000)
                      timeAgo = timeDiff < 60 ? `${timeDiff}s ago` : timeDiff < 3600 ? `${Math.floor(timeDiff / 60)}m ago` : bidTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    } else {
                      timeAgo = bidTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    }
                    
                    return (
                      <motion.div
                        key={bidKey}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.3 }}
                        className="text-sm border-l-4 border-green-500 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/40 dark:to-emerald-900/40 rounded-lg p-3 mb-2 shadow-lg"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-2xl">🎉</span>
                          <div className="font-bold text-lg text-green-800 dark:text-green-300">
                            {bid.playerName || 'Player'} SOLD!
                          </div>
                        </div>
                        <div className="flex items-center gap-2 mb-1 text-sm">
                          <span className="text-gray-700 dark:text-gray-300">To:</span>
                          <span className="font-semibold text-gray-900 dark:text-gray-100">{bid.bidderName}</span>
                          {bid.teamName && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200">({bid.teamName})</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {bid.amount && (
                            <span className="text-xl font-bold text-green-600 dark:text-green-400">
                              {formatCurrency(bid.amount)}
                            </span>
                          )}
                          <span className="text-xs text-green-600 dark:text-green-400">⏰ {timeAgo}</span>
                        </div>
                      </motion.div>
                    )
                  }
                  
                  if (bid.type === 'unsold') {
                    const bidTime = new Date(bid.timestamp)
                    let timeAgo = ''
                    if (isClient) {
                      const now = new Date()
                      const timeDiff = Math.floor((now.getTime() - bidTime.getTime()) / 1000)
                      timeAgo = timeDiff < 60 ? `${timeDiff}s ago` : timeDiff < 3600 ? `${Math.floor(timeDiff / 60)}m ago` : bidTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    } else {
                      timeAgo = bidTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    }
                    
                    return (
                      <motion.div
                        key={bidKey}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.3 }}
                        className="text-sm border-l-4 border-orange-500 bg-gradient-to-r from-orange-50 to-red-50 dark:from-orange-900/40 dark:to-red-900/40 rounded-lg p-3 mb-2 shadow-md"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-2xl">⏭️</span>
                          <div className="font-bold text-lg text-orange-800 dark:text-orange-300">
                            {bid.playerName || 'Player'} - UNSOLD
                          </div>
                        </div>
                        <div className="text-sm text-orange-700 dark:text-orange-400 mb-1">
                          No buyer found • Moving to next player
                        </div>
                        <div className="text-xs text-orange-600 dark:text-orange-400">
                          ⏰ {timeAgo}
                        </div>
                      </motion.div>
                    )
                  }
                  
                  // Handle bid-undo events
                  if (bid.type === 'bid-undo') {
                    const bidTime = new Date(bid.timestamp)
                    let timeAgo = ''
                    if (isClient) {
                      const now = new Date()
                      const timeDiff = Math.floor((now.getTime() - bidTime.getTime()) / 1000)
                      timeAgo = timeDiff < 60 ? `${timeDiff}s ago` : timeDiff < 3600 ? `${Math.floor(timeDiff / 60)}m ago` : bidTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    } else {
                      timeAgo = bidTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    }
                    
                    return (
                      <motion.div
                        key={bidKey}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.3 }}
                        className="text-sm border-l-4 border-red-500 bg-gradient-to-r from-red-50 to-orange-50 dark:from-red-900/40 dark:to-orange-900/40 rounded-lg p-3 mb-2 shadow-md"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-2xl">↩️</span>
                          <div className="font-bold text-lg text-red-800 dark:text-red-300">
                            BID UNDONE
                          </div>
                        </div>
                        <div className="flex items-center gap-2 mb-1 text-sm">
                          <span className="text-gray-700 dark:text-gray-300">From:</span>
                          <span className="font-semibold text-gray-900 dark:text-gray-100">{bid.bidderName}</span>
                          {bid.teamName && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-red-200 dark:bg-red-800 text-red-800 dark:text-red-200">({bid.teamName})</span>
                          )}
                        </div>
                        {bid.amount && (
                          <div className="flex items-center gap-2">
                            <span className="text-lg font-bold text-red-600 dark:text-red-400">
                              {formatCurrency(bid.amount)}
                            </span>
                            <span className="text-xs text-red-600 dark:text-red-400">⏰ {timeAgo}</span>
                          </div>
                        )}
                      </motion.div>
                    )
                  }
                  
                  // Handle regular bids
                  if (!bid.amount) {
                    return null
                  }
                  
                  const bidTime = new Date(bid.timestamp)
                  let timeAgo = ''
                  if (isClient) {
                    const now = new Date()
                    const timeDiff = Math.floor((now.getTime() - bidTime.getTime()) / 1000)
                    
                    if (timeDiff < 60) {
                      timeAgo = `${timeDiff} second${timeDiff !== 1 ? 's' : ''} ago`
                    } else if (timeDiff < 3600) {
                      const minutes = Math.floor(timeDiff / 60)
                      timeAgo = `${minutes} minute${minutes !== 1 ? 's' : ''} ago`
                    } else {
                      timeAgo = bidTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    }
                  } else {
                    timeAgo = bidTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  }
                  
                  const isLatestBid = index === 0
                  const increment = isLatestBid && bidHistory.length > 1
                    ? bid.amount - (bidHistory[1]?.amount || 0)
                    : null
                  
                  return (
                    <motion.div
                      key={bidKey}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.3 }}
                      className={`text-sm rounded-lg p-3 mb-2 ${
                        isLatestBid
                          ? 'border-l-4 border-blue-500 bg-gradient-to-r from-blue-50 to-cyan-50 dark:from-blue-900/40 dark:to-cyan-900/40 shadow-lg'
                          : 'bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-900 dark:text-gray-100">{bid.bidderName}</span>
                          {bid.teamName && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                              {bid.teamName}
                            </span>
                          )}
                        </div>
                        <span className="text-lg font-bold text-gray-900 dark:text-gray-100">
                          {formatCurrency(bid.amount)}
                        </span>
                      </div>
                      {increment && increment > 0 && (
                        <div className="text-xs text-blue-600 dark:text-blue-400 mb-1">
                          +₹{increment.toLocaleString('en-IN')} increment
                        </div>
                      )}
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        ⏰ {timeAgo}
                      </div>
                    </motion.div>
                  )
                })
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <SoldTicker sales={recentSales} />
    </div>
      )}
    </>
  )
}



