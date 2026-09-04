'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import dynamic from 'next/dynamic'
import { Auction, Player } from '@prisma/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { ChevronRight, Eye, Trophy } from 'lucide-react'
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
}

export function PublicAuctionView({ auction, currentPlayer: initialPlayer, stats: initialStats, bidHistory: initialHistory, bidders, onOpenBidHistoryRef }: PublicAuctionViewProps) {
  const [currentPlayer, setCurrentPlayer] = useState(initialPlayer)
  // True once a sale empties the pool (nothing AVAILABLE, nothing UNSOLD left
  // to recycle) - without this, spectators have no way to tell "waiting for
  // the next player" apart from "there is no next player."
  const [poolExhausted, setPoolExhausted] = useState(false)
  const [currentBid, setCurrentBid] = useState<{ bidderId: string; amount: number; bidderName: string; teamName?: string } | null>(null)
  const [bidHistory, setBidHistory] = useState<BidHistoryEntry[]>([])
  const [highestBidderId, setHighestBidderId] = useState<string | null>(null)
  const [soldAnimation, setSoldAnimation] = useState(false)
  const [isClient, setIsClient] = useState(false)
  const [showAllPlayerDetails, setShowAllPlayerDetails] = useState(false)
  const [isImageLoading, setIsImageLoading] = useState(false)
  
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

  // Bid error state for public view
  const errorIdRef = useRef(0)
  const bidErrorTimeouts = useRef<Record<number, ReturnType<typeof setTimeout>>>({})
  const [bidErrors, setBidErrors] = useState<Array<{ id: number; message: string }>>([])
  
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
  
  // Cleanup bid error timeouts on unmount
  useEffect(() => {
    return () => {
      Object.values(bidErrorTimeouts.current).forEach(clearTimeout)
    }
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


  // Real-time subscriptions
  usePusher(auction.id, {
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
          return update || p
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
    onBidError: (data) => {
      // Display error message in public view
      const id = ++errorIdRef.current
      setBidErrors(prev => [{ id, message: data.message }, ...prev])
      const timeout = setTimeout(() => {
        setBidErrors(prev => prev.filter(err => err.id !== id))
        delete bidErrorTimeouts.current[id]
      }, 10000)
      bidErrorTimeouts.current[id] = timeout
    },
  })

  // Extract player data from JSON
  const getPlayerData = (player: Player | null) => {
    if (!player || !player.data) return {}
    return player.data as Record<string, any>
  }

  const playerData = getPlayerData(currentPlayer)
  const playerName = playerData.name || playerData.Name || 'No Player Selected'

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

  const getPlayerName = useCallback((player: Player): string => {
    const data = player.data as any
    return data?.name || data?.Name || data?.player_name || 'Unknown Player'
  }, [])

  // Real sales, most recent first - fills the Play-by-Play panel with
  // actual content between bids instead of empty space under "No bids
  // yet", using data the page already has (players already carry
  // soldTo/soldPrice once sold).
  const recentlySold = useMemo(() => {
    return players
      .filter(p => p.status === 'SOLD' && p.soldTo)
      .slice(-5)
      .reverse()
      .map(p => {
        const bidder = biddersState.find(b => b.id === p.soldTo)
        return {
          id: p.id,
          name: getPlayerName(p),
          price: p.soldPrice ?? 0,
          buyer: bidder?.teamName || bidder?.username || 'Unknown'
        }
      })
  }, [players, biddersState, getPlayerName])

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


  return (
    <>
      {/* Going Live Banner - Full Page Overlay */}
      <GoingLiveBanner 
        show={showGoingLiveBanner} 
        onComplete={() => setShowGoingLiveBanner(false)}
      />
      
      {/* Hide main content when banner is showing */}
      {!showGoingLiveBanner && (
    <div className="pb-40 sm:pb-3 bg-[#05070a]">
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

          {/* Bid errors - real feature, kept visible on every breakpoint
              (not just desktop) since it's not just an activity-panel item */}
          {bidErrors.length > 0 && (
            <div className="relative px-3 sm:px-4 pb-2 space-y-2">
              {bidErrors.map(err => (
                <div
                  key={err.id}
                  className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs sm:text-sm text-red-300 animate-in fade-in slide-in-from-top-2 duration-300"
                >
                  <span className="mt-0.5">⚠️</span>
                  <span className="flex-1">{err.message}</span>
                </div>
              ))}
            </div>
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
                    profileLink={(() => {
                      const link = (playerData as any)?.['Cricheroes Profile link'] ||
                                   (playerData as any)?.[' Cricheroes Profile link'] ||
                                   (playerData as any)?.['cricheroes profile link']

                      if (link && typeof link === 'string') {
                        const urlMatch = link.match(/(https?:\/\/[^\s]+)/i)
                        if (urlMatch && urlMatch[1]) {
                          return urlMatch[1].trim()
                        }
                      }
                      return undefined
                    })()}
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
                    {recentlySold.length > 0 ? (
                      <>
                        <div className="text-gray-600 text-[10px] font-black uppercase tracking-widest px-1 pb-1">
                          Recently Sold
                        </div>
                        {recentlySold.map(sale => (
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
    </div>
      )}
    </>
  )
}



