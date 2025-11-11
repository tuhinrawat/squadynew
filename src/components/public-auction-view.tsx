'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import dynamic from 'next/dynamic'
import { Auction, Player } from '@prisma/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Clock, ChevronDown, ChevronUp, Eye, Trophy } from 'lucide-react'
import Link from 'next/link'
import { DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { usePusher } from '@/lib/pusher-client'
import { motion, AnimatePresence } from 'framer-motion'
import { logger } from '@/lib/logger'
import { useViewerCount } from '@/hooks/use-viewer-count'
import { ActivityLog } from '@/components/activity-log'
import PlayerCard from '@/components/player-card'
import BidAmountStrip from '@/components/bid-amount-strip'
import { PlayerRevealAnimation } from '@/components/player-reveal-animation'
import { GoingLiveBanner } from '@/components/going-live-banner'
// Memoized components for performance
import { StatsDisplay } from '@/components/public-auction-view/memoized-components'

// Code-split heavy components for better initial load (PublicChat moved to header)

// Custom hook for optimized timer updates (reduces re-renders by 66%)
function useOptimizedTimer(timerValue: number): number {
  const [displayTimer, setDisplayTimer] = useState(timerValue)
  const lastUpdate = useRef(Date.now())
  
  useEffect(() => {
    // Always update immediately if critical (< 6 seconds)
    if (timerValue <= 5) {
      setDisplayTimer(timerValue)
      lastUpdate.current = Date.now()
      return
    }
    
    // For non-critical, only update every 2 seconds
    const timeSinceLastUpdate = Date.now() - lastUpdate.current
    if (timeSinceLastUpdate >= 2000) {
      setDisplayTimer(timerValue)
      lastUpdate.current = Date.now()
    }
  }, [timerValue])
  
  return displayTimer
}

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
}

export function PublicAuctionView({ auction, currentPlayer: initialPlayer, stats: initialStats, bidHistory: initialHistory, bidders }: PublicAuctionViewProps) {
  const [currentPlayer, setCurrentPlayer] = useState(initialPlayer)
  const [currentBid, setCurrentBid] = useState<{ bidderId: string; amount: number; bidderName: string; teamName?: string } | null>(null)
  const [timer, setTimer] = useState(30)
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
  
  // Bid error state for public view
  const errorIdRef = useRef(0)
  const bidErrorTimeouts = useRef<Record<number, ReturnType<typeof setTimeout>>>({})
  const [bidErrors, setBidErrors] = useState<Array<{ id: number; message: string }>>([])

  // Optimized timer for smoother countdown (updates less frequently when not critical)
  const displayTimer = useOptimizedTimer(timer)

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
    // Check if auction status changed from DRAFT/PAUSED to LIVE
    const wasNotLive = previousAuctionStatus !== 'LIVE'
    const isNowLive = auction.status === 'LIVE'
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
      setTimer(data.countdownSeconds || 30)
      
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
    onTimerUpdate: (data) => {
      setTimer(data.seconds)
    },
    onNewPlayer: (data) => {
      // Store the new player and show reveal animation
      setPendingPlayer(data.player as Player)
      setShowPlayerReveal(true)
      // Don't update current player yet - wait for animation to complete
    },
    onAuctionEnded: () => {
      window.location.reload()
    },
    onBidUndo: (data) => {
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
      // Update from Pusher data if available (no API call needed)
      if (data.bidders) {
        setBiddersState(prev => prev.map(b => {
          const update = data.bidders!.find(ub => ub.id === b.id)
          return update ? { ...b, remainingPurse: update.remainingPurse } : b
        }))
      }
      // Note: players update handled via onPlayerSold
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
    
    // Icon players phase
    const iconPlayers = players.filter(p => (p as any).isIcon === true)
    const soldIconPlayers = iconPlayers.filter(p => p.status === 'SOLD').length
    const unsoldIconPlayers = iconPlayers.filter(p => p.status === 'UNSOLD').length
    const availableIconPlayers = iconPlayers.filter(p => p.status === 'AVAILABLE').length
    
    // Check if current player is icon
    const currentPlayerIsIcon = (currentPlayer as any)?.isIcon === true
    
    // Phase 1: Icon Players Auction (if icon players exist and current is icon or icon players not finished)
    if (iconPlayers.length > 0 && (currentPlayerIsIcon || availableIconPlayers > 0)) {
      return {
        type: 'ICON_PLAYERS',
        message: '⭐ Icon Players Auction Going On',
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
    <div className="p-1 sm:p-6">
      <div className="max-w-7xl mx-auto space-y-1 sm:space-y-4">
        {/* Compact Dark Header (Desktop) / Stats Header (Mobile - appears after player card) */}
        <div className="hidden sm:block relative bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 rounded-lg overflow-hidden px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Left: Title & Badges */}
            <div className="flex items-center gap-3">
              <h1 className="text-lg sm:text-xl font-black text-white uppercase">{auction.name}</h1>
              <Badge className="bg-green-500 text-white text-[10px] font-bold px-2 py-0.5 animate-pulse">● LIVE</Badge>
              <Badge className="bg-white/10 text-white border-white/20 text-[10px] font-semibold px-2 py-0.5 hidden sm:inline-flex">Public Viewer</Badge>
              {viewerCount > 0 && (
                <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[10px] font-semibold px-2 py-0.5 animate-pulse">
                  <Eye className="h-3 w-3 mr-1" />
                  {viewerCount}
                </Badge>
              )}
            </div>
            
            {/* Right: Stats & Button */}
            <div className="flex items-center gap-4">
              {/* Stats Display - Memoized for performance */}
              <StatsDisplay 
                total={initialStats.total}
                sold={initialStats.sold}
                unsold={initialStats.unsold}
                remaining={initialStats.remaining}
              />
              
              <div className="flex items-center gap-2">
                <Link href={`/auction/${auction.id}/teams`} target="_blank" rel="noopener noreferrer">
                  <Button className="bg-white/10 hover:bg-white/20 text-white border-white/20 h-8 text-xs" size="sm">
                    <Trophy className="h-3 w-3 mr-1" />
                    <span className="hidden sm:inline">View All Players & Teams</span>
                    <span className="sm:hidden">Players</span>
                  </Button>
                </Link>
              </div>
            </div>
          </div>
          
        </div>

        {/* Main Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-1 sm:gap-4">
          {/* Center Stage */}
          <div className="col-span-1 lg:col-span-2 order-1">
            {/* Sold Animation */}
            <Card className="min-h-[300px] sm:min-h-[500px] relative overflow-hidden mx-1 sm:mx-0">
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
              
              <CardContent className="p-0 sm:p-4 space-y-0 sm:space-y-4">
                {/* New Player Card */}
                {isClient && (
                  <div className="relative">
                    {/* Player Reveal Animation - Inside Player Card */}
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
                    
                    {/* Combined Auction Phase Banner + Live Badges */}
                    {auctionPhase && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`absolute -top-0 left-0 right-0 z-10 bg-gradient-to-r ${auctionPhase.color} px-2 sm:px-4 py-1.5 sm:py-2 shadow-xl rounded-t-xl border-b-2 border-white/30`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          {/* Left: Auction Phase Message */}
                          <div className="flex items-center gap-1 sm:gap-1.5 flex-1 min-w-0">
                            <span className="text-[9px] sm:text-xs md:text-sm font-bold text-white truncate">{auctionPhase.message}</span>
                          </div>
                          
                          {/* Right: Live Status + Count */}
                          <div className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0">
                            <Badge className="bg-green-500 text-white text-[9px] sm:text-[10px] font-bold px-1 py-0.5 sm:px-1.5 sm:py-0.5 animate-pulse">
                              ● LIVE
                            </Badge>
                            <Badge className="bg-white/20 text-white border-white/30 text-[9px] sm:text-[10px] font-semibold px-1 py-0 sm:px-1.5 sm:py-0.5 animate-pulse">
                              <Eye className="h-2 w-2 sm:h-2.5 sm:w-2.5 mr-0.5" />
                              {viewerCount || 0}
                            </Badge>
                          </div>
                        </div>
                      </motion.div>
                    )}
                    <div className={auctionPhase ? 'pt-8 sm:pt-10' : ''}>
                      <PlayerCard
                    name={playerName}
                    imageUrl={(() => {
                      const profilePhotoLink = playerData['Profile Photo'] || playerData['profile photo'] || playerData['Profile photo'] || playerData['PROFILE PHOTO'] || playerData['profile_photo']
                      console.log('Profile Photo Link for', playerName, ':', profilePhotoLink)
                      console.log('All available fields for', playerName, ':', Object.keys(playerData))
                      if (!profilePhotoLink) {
                        console.log('No profile photo link found for', playerName)
                        console.log('PlayerData:', playerData)
                        return undefined
                      }
                      // Try to extract Google Drive ID from various formats
                      // Format 1: https://drive.google.com/file/d/[ID]/view
                      let match = profilePhotoLink.match(/\/d\/([a-zA-Z0-9_-]+)/)
                      if (match && match[1]) {
                        const url = `/api/proxy-image?id=${match[1]}`
                        console.log('Constructed proxy URL for', playerName, ':', url)
                        return url
                      }
                      // Format 2: https://drive.google.com/open?id=[ID]
                      match = profilePhotoLink.match(/[?&]id=([a-zA-Z0-9_-]+)/)
                      if (match && match[1]) {
                        const url = `/api/proxy-image?id=${match[1]}`
                        console.log('Constructed proxy URL (format 2) for', playerName, ':', url)
                        return url
                      }
                      // If it's already a valid URL, use it directly
                      if (typeof profilePhotoLink === 'string' && (profilePhotoLink.startsWith('http://') || profilePhotoLink.startsWith('https://'))) {
                        console.log('Using direct URL for', playerName, ':', profilePhotoLink)
                        return profilePhotoLink
                      }
                      console.log('Returning raw profile photo link for', playerName, ':', profilePhotoLink)
                      return profilePhotoLink
                    })()}
                    basePrice={(currentPlayer?.data as any)?.['Base Price'] || (currentPlayer?.data as any)?.['base price'] || 1000}
                    tags={((currentPlayer as any)?.isIcon || (currentPlayer?.data as any)?.isIcon) ? [{ label: 'Icon', color: 'purple' }] : []}
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
                      return essentials
                    })()}
                  />
                    </div>
                  </div>
                )}
                
                {/* Bid Amount Strip */}
                {isClient && (
                  <BidAmountStrip
                    amount={currentBid?.amount ?? null}
                    bidderName={currentBid?.bidderName}
                    teamName={currentBid?.teamName}
                    timerSeconds={displayTimer}
                    nextMin={(() => {
                      const currentBidAmount = currentBid?.amount || 0
                      const rules = auction.rules as any
                      const minIncrement = currentBidAmount >= 10000 ? 2000 : (rules?.minBidIncrement || 1000)
                      return currentBidAmount + minIncrement
                    })()}
                  />
                )}
              </CardContent>
              
              <CardHeader className="hidden">
                <div className="flex flex-col items-center gap-3">
                  {(() => {
                    // Try to find profile photo with various field name patterns
                    const profilePhotoLink = playerData['Profile Photo'] || playerData['profile photo'] || playerData['Profile photo'] || 
                      playerData['ProfilePhoto'] || playerData['profilePhoto'] || playerData['ProfilePHOTO'] || 
                      playerData['profile_photo'] || playerData['Profile_Photo'] || playerData['PHOTO']
                    
                    if (!profilePhotoLink) {
                      logger.log('No profile photo found')
                      // Show placeholder avatar instead of nothing
                      return (
                        <div className="flex flex-col items-center gap-2">
                          <div className="w-32 h-32 sm:w-40 sm:h-40 lg:w-48 lg:h-48 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center">
                            <span className="text-gray-600 dark:text-gray-400 text-2xl sm:text-3xl lg:text-4xl font-semibold">
                              {playerName.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <CardTitle className="text-lg sm:text-xl lg:text-2xl text-gray-900 dark:text-gray-100 text-center">{playerName}</CardTitle>
                        </div>
                      )
                    }
                    
                    logger.log('Profile photo link found')
                    
                    // Extract file ID from the Google Drive URL
                    const fileId = profilePhotoLink.includes('/file/d/') 
                      ? profilePhotoLink.match(/\/file\/d\/([a-zA-Z0-9-_]+)/)?.[1]
                      : profilePhotoLink.includes('open?id=')
                      ? profilePhotoLink.match(/open\?id=([a-zA-Z0-9-_]+)/)?.[1]
                      : profilePhotoLink.includes('id=')
                      ? profilePhotoLink.match(/id=([a-zA-Z0-9-_]+)/)?.[1]
                      : null
                      
                    // Use proxy API to bypass CORB
                    const proxyImageUrl = fileId ? `/api/proxy-image?id=${fileId}` : null
                      
                    return (
                      <>
                        <div className="w-32 h-32 sm:w-40 sm:h-40 lg:w-48 lg:h-48 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center overflow-hidden relative">
                          {proxyImageUrl ? (
                            <>
                              {isImageLoading && (
                                <div className="absolute inset-0 flex items-center justify-center bg-gray-200 dark:bg-gray-700 rounded-full z-10">
                                  <div className="w-8 h-8 border-4 border-gray-300 border-t-gray-600 dark:border-gray-600 dark:border-t-gray-300 rounded-full animate-spin"></div>
                                </div>
                              )}
                              <img 
                                src={proxyImageUrl}
                                alt={playerName}
                                className="rounded-full object-contain w-full h-full p-2"
                                onError={(e) => {
                                  setIsImageLoading(false)
                                  logger.error('Image failed to load, showing initial')
                                  const img = e.currentTarget
                                  img.style.display = 'none'
                                  const parent = img.parentElement
                                  if (parent) {
                                    parent.innerHTML = `
                                      <span class="text-gray-600 dark:text-gray-400 text-2xl sm:text-3xl lg:text-4xl font-semibold">
                                        ${playerName.charAt(0).toUpperCase()}
                                      </span>
                                    `
                                  }
                                }}
                                onLoad={() => {
                                  setIsImageLoading(false)
                                  logger.log('Image loaded successfully via proxy')
                                }}
                              />
                            </>
                          ) : (
                            <span className="text-gray-600 dark:text-gray-400 text-2xl sm:text-3xl lg:text-4xl font-semibold">
                              {playerName.charAt(0).toUpperCase()}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-center gap-2">
                          <CardTitle className="text-lg sm:text-xl lg:text-2xl text-gray-900 dark:text-gray-100 text-center">{playerName}</CardTitle>
                          {(currentPlayer as any)?.isIcon && (
                            <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-300 text-xs">
                              ⭐ Icon
                            </Badge>
                          )}
                        </div>
                      </>
                    )
                  })()}
                </div>
              </CardHeader>
              <CardContent className="hidden space-y-3 sm:space-y-4 p-3 sm:p-6">
                {/* Essential Fields */}
                <div className="space-y-3">
                  {(() => {
                    // Define essential fields to show always
                    const essentialFields = ['Speciality', 'Batting Type', 'Bowling Type', 'Wicket Keeper']
                    const allFields = Object.entries(playerData).filter(([key]) => 
                      key.toLowerCase() !== 'name' && 
                      !key.toLowerCase().includes('profile photo') &&
                      !key.toLowerCase().includes('photo')
                    )
                    
                    const essentialData = allFields.filter(([key]) => 
                      essentialFields.some(ef => key.toLowerCase().includes(ef.toLowerCase()))
                    )
                    
                    // Group essential fields into a cleaner layout
                    return (
                      <div className="space-y-2">
                        {essentialData.map(([key, value]) => (
                          <div key={key} className="flex items-center justify-between py-1 border-b border-gray-100 dark:border-gray-800">
                            <span className="text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-400">{key}</span>
                            <span className="text-sm sm:text-base font-semibold text-gray-900 dark:text-gray-100">{String(value)}</span>
                          </div>
                        ))}
                      </div>
                    )
                  })()}
                </div>

                {/* Read More Section */}
                {(() => {
                  const essentialFields = ['Speciality', 'Batting Type', 'Bowling Type', 'Wicket Keeper']
                  const allFields = Object.entries(playerData).filter(([key]) => 
                    key.toLowerCase() !== 'name' && 
                    !key.toLowerCase().includes('profile photo') &&
                    !key.toLowerCase().includes('photo')
                  )
                  
                  const nonEssentialFields = allFields.filter(([key]) => 
                    !essentialFields.some(ef => key.toLowerCase().includes(ef.toLowerCase()))
                  )
                  
                  if (nonEssentialFields.length === 0) return null
                  
                  return (
                    <div className="space-y-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowAllPlayerDetails(!showAllPlayerDetails)}
                        className="w-full text-xs sm:text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800"
                      >
                        {showAllPlayerDetails ? (
                          <>
                            <ChevronUp className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                            Show Less Details
                          </>
                        ) : (
                          <>
                            <ChevronDown className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                            Show More Details ({nonEssentialFields.length})
                          </>
                        )}
                      </Button>
                      
                      <AnimatePresence>
                        {showAllPlayerDetails && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="space-y-2 overflow-hidden"
                          >
                            {nonEssentialFields.map(([key, value]) => (
                              <div key={key} className="flex items-center justify-between py-1 border-b border-gray-100 dark:border-gray-800">
                                <span className="text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-400 truncate">{key}</span>
                                <span className="text-sm sm:text-base font-semibold text-gray-900 dark:text-gray-100 ml-2 text-right">{String(value)}</span>
                              </div>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )
                })()}
                {/* Combined Current Bid & Timer Section */}
                <div className="border-t-4 border-blue-200 dark:border-blue-900 pt-4 mt-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Current Bid */}
                    <div className="text-center space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                        Current Bid
                      </div>
                      {currentBid ? (
                        <div className="space-y-1">
                          <div className="text-3xl sm:text-4xl lg:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">
                            ₹{currentBid.amount.toLocaleString('en-IN')}
                          </div>
                          <div className="text-sm sm:text-base font-semibold text-gray-700 dark:text-gray-300">
                            {currentBid.bidderName}
                            {currentBid.teamName && (
                              <span className="text-blue-600 font-bold"> ({currentBid.teamName})</span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="py-4 text-base font-semibold text-gray-400 dark:text-gray-500">
                          No bids yet
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            {/* Mobile Only: View All Players & Teams Button */}
            <div className="lg:hidden mt-2 px-1">
              <Link href={`/auction/${auction.id}/teams`} target="_blank" rel="noopener noreferrer" className="block">
                <Button className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-lg" size="lg">
                  <Trophy className="h-4 w-4 mr-2" />
                  View All Players & Teams
                </Button>
              </Link>
            </div>
          </div>

          {/* Bid History */}
          <div className="order-2 lg:order-1 space-y-3">
            {/* Bid Errors Display */}
            {bidErrors.length > 0 && (
              <div className="space-y-2">
                {bidErrors.map(err => (
                  <div
                    key={err.id}
                    className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200 animate-in fade-in slide-in-from-top-2 duration-300"
                  >
                    <span className="mt-0.5 text-red-600 dark:text-red-300">⚠️</span>
                    <span className="flex-1">{err.message}</span>
                  </div>
                ))}
              </div>
            )}
            
            <Card>
              <CardHeader className="p-3 sm:p-4">
                <CardTitle className="text-sm sm:text-base text-gray-900 dark:text-gray-100">Live Activity</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-[200px] sm:max-h-[300px] lg:max-h-[500px] overflow-y-auto px-3 sm:px-4 py-2">
                  <ActivityLog items={bidHistory as any} />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
      )}
    </>
  )
}



