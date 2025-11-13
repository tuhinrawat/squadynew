'use client'

import React, { useState, useEffect, useCallback, useMemo, useRef, startTransition, memo } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { Auction, Player, Bidder } from '@prisma/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Clock, Play, Pause, SkipForward, Square, Undo2, TrendingUp, ChevronDown, ChevronUp, Share2, MoreVertical, Trophy, RotateCcw } from 'lucide-react'
import Link from 'next/link'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { usePusher } from '@/lib/pusher-client'
import { motion, AnimatePresence } from 'framer-motion'
import { ActivityLog } from '@/components/activity-log'
import { isLiveStatus } from '@/lib/auction-status'
import PlayerCard from '@/components/player-card'
import BidAmountStrip from '@/components/bid-amount-strip'
import ActionButtons from '@/components/action-buttons'
import { PlayerRevealAnimation } from '@/components/player-reveal-animation'
import { GoingLiveBanner } from '@/components/going-live-banner'
import { toast } from 'sonner'
import { useSession } from 'next-auth/react'
import { preloadImage } from '@/lib/image-preloader'

// Dynamic import for PublicChat - code splitting for better performance
const PublicChat = dynamic(
  () => import('@/components/public-chat').then(mod => ({ default: mod.PublicChat })),
  { ssr: false }
)

// Optimized timer hook - reduces re-renders by 66%
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
  bidderId?: string // Optional for sale-undo events
  amount?: number // Optional for sale-undo events
  timestamp: Date
  bidderName?: string // Optional for sale-undo events
  teamName?: string
  type?: 'bid' | 'sold' | 'unsold' | 'sale-undo' | 'bid-undo'
  playerId?: string
  playerName?: string
  refundedAmount?: number // For sale-undo events
}

interface BidderWithUser extends Bidder {
      user: {
        id: string
        name: string
        email: string
      }
}

interface PusherBidData {
  bidderId: string
  bidderName: string
  teamName?: string
  amount: number
  timestamp: string
  remainingPurse?: number // Added for instant UI updates
  currentBid?: {
    bidderId: string
    amount: number
    bidderName: string
    teamName?: string
  }
}

interface PusherBidUndoData {
  bidderId: string
  currentBid: {
    bidderId: string
    amount: number
    bidderName: string
    teamName?: string
  } | null
  countdownSeconds: number
  remainingPurse?: number // Added for instant UI updates
}

interface PusherSoldData {
  playerId: string
  bidderId: string
  bidderName?: string
  teamName?: string
  amount: number
  playerName: string
  bidderRemainingPurse?: number // Added for instant UI updates
  updatedBidders?: Array<{ id: string; remainingPurse: number }> // Batch updates
}

interface PusherSaleUndoData {
  playerId: string
  player?: any // Updated player data after undo
  bidderId?: string
  refundedAmount?: number
  bidderRemainingPurse?: number
  updatedBidders?: Array<{ id: string; remainingPurse: number }>
}

interface PusherTimerData {
  seconds: number
}

interface PusherPlayerData {
  player: Player
}

interface AuctionRules {
  minBidIncrement?: number
  countdownSeconds?: number
  // Add other rule properties as needed
}

interface AdminAuctionViewProps {
  auction: Auction & {
    players: Player[]
    bidders: BidderWithUser[]
  }
  currentPlayer: Player | null
  stats: {
    total: number
    sold: number
    unsold: number
    remaining: number
  }
  bidHistory: BidHistoryEntry[]
  viewMode?: 'admin' | 'bidder'
}

export function AdminAuctionView({ auction, currentPlayer: initialPlayer, stats: initialStats, bidHistory: initialHistory, viewMode = 'admin' }: AdminAuctionViewProps) {
  const router = useRouter()
  const { data: session } = useSession()
  const [currentPlayer, setCurrentPlayer] = useState(initialPlayer)
  const [currentBid, setCurrentBid] = useState<{ bidderId: string; amount: number; bidderName: string; teamName?: string } | null>(null)
  const [timer, setTimer] = useState(30)
  const [isPaused, setIsPaused] = useState(false)
  
  // Use optimized timer for smoother performance (reduces re-renders by 66%)
  const displayTimer = useOptimizedTimer(timer)
  const [bidHistory, setBidHistory] = useState<BidHistoryEntry[]>([])
  const [fullBidHistory, setFullBidHistory] = useState(initialHistory)
  const [highestBidderId, setHighestBidderId] = useState<string | null>(null)
  const [soldAnimation, setSoldAnimation] = useState(false)
  const [undoSaleDialogOpen, setUndoSaleDialogOpen] = useState(false)
  const [selectedBidderForBid, setSelectedBidderForBid] = useState<string | null>(null)
  const [customBidAmount, setCustomBidAmount] = useState('')
  const [showAllPlayerDetails, setShowAllPlayerDetails] = useState(false)
  const [isClient, setIsClient] = useState(false)
  const [isImageLoading, setIsImageLoading] = useState(false)
  const [bidHistoryModalOpen, setBidHistoryModalOpen] = useState(false)
  const [isMarkingSold, setIsMarkingSold] = useState(false)
  const [isMarkingUnsold, setIsMarkingUnsold] = useState(false)
  const [customBidModalOpen, setCustomBidModalOpen] = useState(false)
  const [players, setPlayers] = useState(auction.players)
  const [bidAmount, setBidAmount] = useState(0)
  const [isPlacingBid, setIsPlacingBid] = useState(false)
  const [placingBidFor, setPlacingBidFor] = useState<string | null>(null) // Track which bidder's bid is being placed
  const [error, setError] = useState('')
  const [bidders, setBidders] = useState(auction.bidders)
  const [isBidConsoleOpen, setIsBidConsoleOpen] = useState(false)
  const [showPlayerReveal, setShowPlayerReveal] = useState(false)
  const [pendingPlayer, setPendingPlayer] = useState<Player | null>(null)
  const [showGoingLiveBanner, setShowGoingLiveBanner] = useState(false)
  const [previousAuctionStatus, setPreviousAuctionStatus] = useState(auction.status)
  const fallbackTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const soldAnimationRef = useRef(false)
  const showPlayerRevealRef = useRef(false)
  const pendingPlayerRef = useRef<Player | null>(null)
  const goingLiveBannerTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const [isDesktop, setIsDesktop] = useState(false)
  const showPinnedConsole = viewMode === 'admin' && isDesktop
  const errorIdRef = useRef(0)
  const bidErrorTimeouts = useRef<Record<number, ReturnType<typeof setTimeout>>>({})
  const [bidErrors, setBidErrors] = useState<Array<{ id: number; message: string }>>([])
  const pushBidError = useCallback((message: string) => {
    toast.error(message)
    const id = ++errorIdRef.current
    setBidErrors(prev => [{ id, message }, ...prev])
    const timeout = setTimeout(() => {
      setBidErrors(prev => prev.filter(err => err.id !== id))
      delete bidErrorTimeouts.current[id]
    }, 10000) // Changed from 2000ms to 10000ms (10 seconds)
    bidErrorTimeouts.current[id] = timeout
  }, [])
  const showBidError = useCallback((message: string) => {
    setError(message)
    pushBidError(message)
  }, [pushBidError])
  const canToggleConsole = !showPinnedConsole
  const chatOffsetClass = (showPinnedConsole || isBidConsoleOpen) ? 'lg:right-[calc(30%+2rem)]' : 'lg:right-20'
  
  // Memoize sorted bidders to avoid sorting on every render - optimization
  const sortedBidders = useMemo(() => 
    bidders.slice().sort((a, b) => b.remainingPurse - a.remainingPurse),
    [bidders]
  )
  
  // Bidding console panel component
  const BidConsolePanel = useCallback(({ showClose = false, onClose }: { showClose?: boolean; onClose?: () => void }) => (
    <div className="h-screen w-full bg-gradient-to-b from-white to-gray-50 dark:from-gray-900 dark:to-gray-950 shadow-[-8px_0_24px_rgba(0,0,0,0.3)] flex flex-col pointer-events-auto overflow-hidden">
      <div className="p-2 bg-gradient-to-r from-emerald-600 to-teal-600 dark:from-emerald-700 dark:to-teal-700 shadow-lg flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-white" />
          <div className="text-sm font-bold text-white">Bidding Console</div>
        </div>
        {showClose && (
          <div className="flex items-center gap-2">
            <button
              className="text-white/90 hover:text-white hover:bg-white/20 rounded-lg px-2 py-1 text-xs font-medium transition-all"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        )}
      </div>
      <div className="p-2 flex-1 bg-white dark:bg-gray-900 min-h-0 overflow-y-auto">
        <div className="text-[10px] font-bold text-gray-800 dark:text-gray-200 mb-1.5 pb-1.5 border-b border-gray-200 dark:border-gray-700 flex items-center gap-1">
          <span>👥</span>
          <span>All Bidders</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5 pb-2">
          {sortedBidders.map(bidder => (
            <div key={bidder.id} className={`p-1.5 rounded-lg shadow-sm ${bidder.id === highestBidderId ? 'bg-green-50 dark:bg-green-900/20' : 'bg-white dark:bg-gray-800'}`}>
              <div className="flex flex-col gap-1.5">
                <div className="min-w-0">
                  <div className="text-[10px] font-bold truncate text-gray-900 dark:text-gray-100">{bidder.user?.name || bidder.username || 'Bidder'}</div>
                  {bidder.teamName && <div className="text-[9px] font-medium truncate text-gray-600 dark:text-gray-400">{bidder.teamName}</div>}
                  <div className="text-[9px] font-medium text-gray-700 dark:text-gray-300">₹{bidder.remainingPurse.toLocaleString('en-IN')}</div>
                </div>
                <div className="grid grid-cols-2 gap-1">
                  <Button
                    size="sm"
                    className={`h-8 w-full text-[10px] !px-1 whitespace-nowrap ${bidder.id === highestBidderId || isPlacingBid || placingBidFor === bidder.id ? 'bg-gray-400 text-white/90 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}
                    disabled={bidder.id === highestBidderId || isPlacingBid || placingBidFor === bidder.id}
                    onClick={async () => {
                      if (isPlacingBid || placingBidFor === bidder.id) return

                      const currentBidAmount = currentBid?.amount || 0
                      const rules = auction.rules as AuctionRules | undefined
                      const minInc = (rules?.minBidIncrement || 1000)
                      const totalBid = currentBidAmount + minInc

                      // Batch all state updates together (React 18 auto-batches)
                      const previousBid = currentBid
                      const previousHighestBidderId = highestBidderId
                      
                      // Create unique optimistic entry ID to track and remove it later
                      const optimisticEntryId = `optimistic-${Date.now()}-${Math.random()}`
                      const optimisticEntry: BidHistoryEntry = {
                        bidderId: bidder.id,
                        amount: totalBid,
                        timestamp: new Date(),
                        bidderName: bidder.user?.name || bidder.username,
                        teamName: bidder.teamName || undefined,
                        type: 'bid',
                        playerId: currentPlayer?.id,
                        // Add unique identifier for tracking
                        _optimisticId: optimisticEntryId
                      } as any

                      // Optimistic UI updates - batched together
                      setIsPlacingBid(true)
                      setPlacingBidFor(bidder.id)
                      setCurrentBid({
                        bidderId: bidder.id,
                        amount: totalBid,
                        bidderName: bidder.user?.name || bidder.username,
                        teamName: bidder.teamName || undefined
                      })
                      setHighestBidderId(bidder.id)
                      setFullBidHistory(prev => [optimisticEntry, ...prev])

                      // Fire-and-forget API call - don't block UI
                      fetch(`/api/auction/${auction.id}/bid`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ bidderId: bidder.id, amount: totalBid })
                      })
                        .then(async (response) => {
                          if (!response.ok) {
                            const err = await response.json()
                            pushBidError(err.error || 'Failed to place bid')
                            // Revert optimistic update - remove by unique ID
                            setCurrentBid(previousBid)
                            setHighestBidderId(previousHighestBidderId)
                            setFullBidHistory(prev => prev.filter(entry => 
                              (entry as any)._optimisticId !== optimisticEntryId
                            ))
                          }
                        })
                        .catch(() => {
                          pushBidError('Network error')
                          // Revert optimistic update - remove by unique ID
                          setCurrentBid(previousBid)
                          setHighestBidderId(previousHighestBidderId)
                          setFullBidHistory(prev => prev.filter(entry => 
                            (entry as any)._optimisticId !== optimisticEntryId
                          ))
                        })
                        .finally(() => {
                          // Clear placing state in background (non-blocking)
                          startTransition(() => {
                            setIsPlacingBid(false)
                            setPlacingBidFor(null)
                          })
                        })
                    }}
                  >
                    {placingBidFor === bidder.id ? 'Placing...' : 'Raise'}
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 w-full text-[10px] !px-1 whitespace-nowrap bg-indigo-600 hover:bg-indigo-700 text-white disabled:bg-gray-400 disabled:text-white/90"
                    disabled={bidder.id === highestBidderId || isPlacingBid}
                    onClick={() => {
                      if (!isPlacingBid) {
                        setSelectedBidderForBid(bidder.id)
                      }
                    }}
                  >
                    Custom
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  ), [sortedBidders, highestBidderId, isPlacingBid, placingBidFor, currentBid, auction, currentPlayer, pushBidError])

  // Keep refs in sync with state
  useEffect(() => {
    soldAnimationRef.current = soldAnimation
  }, [soldAnimation])
  
  useEffect(() => {
    showPlayerRevealRef.current = showPlayerReveal
  }, [showPlayerReveal])
  
  useEffect(() => {
    pendingPlayerRef.current = pendingPlayer
  }, [pendingPlayer])

  useEffect(() => {
    const updateDeviceType = () => {
      if (typeof window !== 'undefined') {
        setIsDesktop(window.innerWidth >= 1024)
      }
    }
    updateDeviceType()
    window.addEventListener('resize', updateDeviceType)
    return () => window.removeEventListener('resize', updateDeviceType)
  }, [])

  useEffect(() => {
    if (showPinnedConsole && isBidConsoleOpen) {
      setIsBidConsoleOpen(false)
    }
  }, [showPinnedConsole, isBidConsoleOpen])

  useEffect(() => {
    return () => {
      Object.values(bidErrorTimeouts.current).forEach(clearTimeout)
    }
  }, [])

  // Find current user's bidder profile (for bidder view)
  const userBidder = bidders.find((b) => b.userId === session?.user?.id)
  
  // Calculate if userBidder has reached max team size
  const isTeamFull = useMemo(() => {
    if (!userBidder) return false
    const rules = auction.rules as any
    // Use maxTeamSize if set, otherwise fall back to mandatoryTeamSize (if available)
    const maxTeamSize = rules?.maxTeamSize || rules?.mandatoryTeamSize
    if (!maxTeamSize) {
      console.log('[Team Full Check] No maxTeamSize or mandatoryTeamSize set in rules - team size limit not enforced')
      return false
    }
    
    // Count players bought by this bidder - use ALL players, not just current state
    const playersBought = players.filter(p => p.soldTo === userBidder.id && p.status === 'SOLD').length
    
    // Team size includes the bidder, so if they've bought (maxTeamSize - 1) players, team is full
    const isFull = playersBought >= maxTeamSize - 1
    
    // Log only when team becomes full or when current player changes
    if (isFull || currentPlayer) {
      console.log('[Team Full Check]', {
        bidderId: userBidder.id,
        bidderName: userBidder.teamName || userBidder.username,
        playersBought,
        maxTeamSize,
        maxPlayersCanBuy: maxTeamSize - 1,
        isFull,
        usingMandatoryTeamSize: !rules?.maxTeamSize && !!rules?.mandatoryTeamSize,
        currentPlayerName: currentPlayer ? ((currentPlayer.data as any)?.Name || (currentPlayer.data as any)?.name) : 'none',
        allPlayers: players.length,
        soldPlayers: players.filter(p => p.status === 'SOLD').length
      })
    }
    
    return isFull
  }, [userBidder, players, auction.rules, currentPlayer])
  
  // Open custom bid modal when bidder is selected (for admin view)
  useEffect(() => {
    if (selectedBidderForBid) {
      setCustomBidModalOpen(true)
    }
  }, [selectedBidderForBid])

  // Refresh auction state from server  
  const refreshAuctionState = useCallback(async () => {
    try {
      // Fetch updated auction data
      const response = await fetch(`/api/auctions/${auction.id}`)
      const data = await response.json()
      
      if (data.auction?.bidHistory && Array.isArray(data.auction.bidHistory)) {
        // Update full bid history - the useEffect will filter it for current player
        setFullBidHistory(data.auction.bidHistory)
      }
      
      // Also update bidders to ensure balance is current
      if (data.auction?.bidders) {
        console.log('🔄 Refreshing bidders balance from server')
        setBidders(data.auction.bidders)
      }
    } catch (error) {
      console.error('Failed to refresh auction state:', error)
    }
  }, [auction.id])

  // Refresh players list from server
  const refreshPlayersList = useCallback(async () => {
    try {
      const response = await fetch(`/api/auctions/${auction.id}`)
      const data = await response.json()
      if (data.auction?.players) {
        setPlayers(data.auction.players)
      }
      if (data.auction?.bidders) {
        setBidders(data.auction.bidders)
      }
    } catch (error) {
      console.error('Failed to refresh players list:', error)
    }
  }, [auction.id])

  // Set client-side rendered flag
  useEffect(() => {
    setIsClient(true)
  }, [])

  // Detect when auction goes live and show banner
  useEffect(() => {
    // Check if auction status changed from DRAFT/PAUSED to LIVE/MOCK_RUN
    const wasNotLive = !isLiveStatus(previousAuctionStatus)
    const isNowLive = isLiveStatus(auction.status)
    const hasCurrentPlayer = currentPlayer !== null

    if (wasNotLive && isNowLive && hasCurrentPlayer) {
      console.log('🎬 Auction just went LIVE - showing going live banner')
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
  }, [auction.status, currentPlayer, previousAuctionStatus])

  // Memoize player bid history for performance
  const playerBidHistory = useMemo(() => {
    if (!currentPlayer?.id) return []
    // Filter bids to only include those for the current player
    const filteredBids = fullBidHistory.filter(bid => {
      // Filter out stale "bid-undo" entries (they should only exist in real-time, not in DB)
      if (bid.type === 'bid-undo') return false
      // Only include bids that have playerId matching current player
      return bid.playerId === currentPlayer.id
    })
    // Keep latest first (no reverse needed since fullBidHistory adds new bids at beginning)
    return filteredBids
  }, [currentPlayer?.id, fullBidHistory])

  // Filter bid history for current player whenever player changes
  useEffect(() => {
    if (currentPlayer?.id) {
      // Filter out non-bid entries (sold, unsold, sale-undo, bid-undo) for display
      const displayBidHistory = playerBidHistory.filter(bid => 
        !bid.type || bid.type === 'bid'
      )
      setBidHistory(displayBidHistory)
      
      // Get the most recent bid (first item, since latest is first)
      // Only consider actual bid entries, not sold/unsold/sale-undo
      const latestBid = displayBidHistory.length > 0 ? displayBidHistory[0] : null
      
      // Update current bid to the latest bid (only if it's a bid event)
      if (latestBid && latestBid.amount && latestBid.bidderId && latestBid.bidderName) {
        setCurrentBid({
          bidderId: latestBid.bidderId,
          amount: latestBid.amount,
          bidderName: latestBid.bidderName,
          teamName: latestBid.teamName
        })
        setHighestBidderId(latestBid.bidderId)
      } else {
        // No valid bids, clear current bid
        setCurrentBid(null)
        setHighestBidderId(null)
      }
    } else {
      setBidHistory([])
      setCurrentBid(null)
      setHighestBidderId(null)
    }
  }, [currentPlayer?.id, playerBidHistory])

  // Reset image loading when player changes (but not on initial load)
  useEffect(() => {
    if (currentPlayer?.id && initialPlayer?.id && currentPlayer.id !== initialPlayer.id) {
      setIsImageLoading(true)
    }
  }, [currentPlayer?.id, initialPlayer?.id])

  // Memoize callbacks to prevent re-subscription
  const handleNewBid = useCallback((data: PusherBidData) => {
      // Clear bid placement state when Pusher confirms the bid (fallback if API didn't clear it)
      setIsPlacingBid(false)
      setPlacingBidFor(null)
      
      // Remove any optimistic entries for this bidder and player before adding server-confirmed bid
      // This ensures we don't have duplicate entries
      setFullBidHistory(prev => {
        // Remove optimistic entries for the same bidder and player
        const filtered = prev.filter(entry => 
          !((entry as any)._optimisticId && 
            entry.bidderId === data.bidderId && 
            entry.playerId === currentPlayer?.id)
        )
        return filtered
      })
      
      // Update state from Pusher (this is the source of truth, corrects any API response discrepancies)
      setCurrentBid({
        bidderId: data.bidderId,
        amount: data.amount,
        bidderName: data.bidderName,
        teamName: data.teamName
      })
      setHighestBidderId(data.bidderId) // Update from server-confirmed data
      
      // Add new bid to full history (single source of truth)
      const newBidEntry = {
        type: 'bid' as const,
        bidderId: data.bidderId,
        amount: data.amount,
        timestamp: new Date(),
        bidderName: data.bidderName,
        teamName: data.teamName,
        playerId: currentPlayer?.id // Associate bid with current player
      }
      setFullBidHistory(prev => {
        const last = prev[0]
        // If the last entry matches (optimistic entry), replace it with server-confirmed data
        if (last && last.type === 'bid' && last.playerId === newBidEntry.playerId && last.bidderId === newBidEntry.bidderId && last.amount === newBidEntry.amount) {
          // Replace optimistic entry with server-confirmed entry
          return [newBidEntry, ...prev.slice(1)]
        }
        return [newBidEntry, ...prev]
      })
      
      // Update purse instantly from Pusher data (no API call needed)
      if (data.remainingPurse !== undefined) {
        setBidders(prev => prev.map(b => 
          b.id === data.bidderId 
            ? { ...b, remainingPurse: data.remainingPurse! }
            : b
        ))
      }
      
      // Clear selected bidder after successful bid
      setSelectedBidderForBid(null)
      setCustomBidAmount('')
  }, [currentPlayer?.id])

  const handleBidUndo = useCallback((data: PusherBidUndoData) => {
      console.log('🔄 handleBidUndo triggered with data:', data)
      
      // Clear bid placement state when bid is undone
      setIsPlacingBid(false)
      setPlacingBidFor(null)
      
      // Update bid history in real-time: remove the undone bid and add "BID UNDONE" entry
      setBidHistory(prev => {
        if (prev.length === 0) {
          console.log('No bid history to undo')
          return prev
        }

        // Find the first ACTUAL bid (skip bid-undo entries at the top)
        const firstBidIndex = prev.findIndex(entry => !entry.type || entry.type === 'bid')
        
        if (firstBidIndex === -1) {
          console.log('Cannot undo: no actual bids found in history')
          return prev
        }
        
        const undoneBid = prev[firstBidIndex]
        console.log('Undoing bid at index', firstBidIndex, undoneBid)
        
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
      
      // Update current bid
      if (data.currentBid && data.currentBid.amount > 0) {
        console.log('Setting current bid to:', data.currentBid)
        setCurrentBid({
          bidderId: data.currentBid.bidderId,
          amount: data.currentBid.amount,
          bidderName: data.currentBid.bidderName,
          teamName: data.currentBid.teamName
        })
        setHighestBidderId(data.currentBid.bidderId)
      } else {
        console.log('Clearing current bid (no previous bid)')
        setCurrentBid(null)
        setHighestBidderId(null)
      }
      
      // Reset timer
      const countdownSeconds = data.countdownSeconds || 30
      console.log('Resetting timer to:', countdownSeconds)
      setTimer(countdownSeconds)
      
      // Update purse instantly from Pusher data if available
      if (data.remainingPurse !== undefined && data.bidderId) {
        console.log('Updating purse for bidder:', data.bidderId, 'to:', data.remainingPurse)
        setBidders(prev => prev.map(b => 
          b.id === data.bidderId 
            ? { ...b, remainingPurse: data.remainingPurse! }
            : b
        ))
      }
      
      console.log('✅ handleBidUndo completed')
  }, [])

  const handleSaleUndo = useCallback((data: PusherSaleUndoData) => {
      console.log('🔄 Sale undo event received:', data)
      
      // Update player status if player data is provided
      if (data.player) {
        setPlayers(prev => prev.map(p => 
          p.id === data.playerId ? data.player : p
        ))
        
        // When a sale is undone, the API sets this player as currentPlayerId
        // So we should update the current player to this undone player
        setCurrentPlayer(data.player)
      } else {
        // Fallback: update player status to AVAILABLE
        setPlayers(prev => {
          const updated = prev.map(p => 
            p.id === data.playerId 
              ? { ...p, status: 'AVAILABLE' as const, soldTo: null, soldPrice: null }
              : p
          )
          
          // Find the undone player and set it as current
          const undonePlayer = updated.find(p => p.id === data.playerId)
          if (undonePlayer) {
            setCurrentPlayer({
              ...undonePlayer,
              status: 'AVAILABLE' as const,
              soldTo: null,
              soldPrice: null
            })
          }
          
          return updated
        })
      }
      
      // Update bidder balance
      if (data.bidderRemainingPurse !== undefined && data.bidderId) {
        setBidders(prev => prev.map(b => 
          b.id === data.bidderId 
            ? { ...b, remainingPurse: data.bidderRemainingPurse! }
            : b
        ))
      } else if (data.updatedBidders) {
        // Batch update multiple bidders
        setBidders(prev => prev.map(b => {
          const update = data.updatedBidders!.find(ub => ub.id === b.id)
          return update ? { ...b, remainingPurse: update.remainingPurse } : b
        }))
      }
      
      // Reset current bid and highest bidder since the player is back to being available
      setCurrentBid(null)
      setHighestBidderId(null)
      
      // Remove only the "sold" entry for this player (keep all bids)
      // Bids should only be removed via "undo bid" action
      const playerData = data.player?.data as any
      const playerName = playerData?.Name || playerData?.name || 'Player'
      const undoEvent: BidHistoryEntry = {
        type: 'sale-undo' as const,
        playerId: data.playerId,
        playerName: playerName,
        timestamp: new Date(),
        refundedAmount: data.refundedAmount
      }
      setFullBidHistory(prev => {
        // Remove only "sold" events for this player
        // Keep all bids - bids should only be removed via "undo bid"
        const filtered = prev.filter(entry => 
          !(entry.playerId === data.player.id && entry.type === 'sold')
        )
        // Add the undo event at the beginning
        return [undoEvent, ...filtered]
      })
      
      // Update bid history to show remaining bids for this player
      // Filter to only show bids for current player (excluding sold/unsold events)
      setBidHistory(prev => {
        return prev.filter(entry => 
          entry.playerId === data.player.id && 
          entry.type !== 'sold' && 
          entry.type !== 'unsold'
        )
      })
      
      // Show success toast
      toast.success(`Sale undone! Player restored and ₹${data.refundedAmount?.toLocaleString('en-IN') || 'amount'} refunded`)
  }, [])

  const handleTimerUpdate = useCallback((data: PusherTimerData) => {
      if (!isPaused) {
        setTimer(data.seconds)
      }
  }, [isPaused])

  const handlePlayerSold = useCallback((data: PusherSoldData) => {
      setSoldAnimation(true)
      setTimeout(() => {
        setSoldAnimation(false)
        // Don't auto-advance - let admin control it manually
      }, 3000)
    
    // Add sold event to bid history
    if (data && currentPlayer) {
      const soldEvent = {
        type: 'sold' as const,
        playerId: currentPlayer.id,
        playerName: data.playerName || 'Unknown',
        bidderId: data.bidderId,
        amount: data.amount || 0,
        timestamp: new Date(),
        bidderName: data.bidderName || '',
        teamName: data.teamName
      }
      setFullBidHistory(prev => [soldEvent, ...prev])
    }
    
    // Update purse instantly from Pusher data (no API call needed)
    if (data.bidderRemainingPurse !== undefined && data.bidderId) {
      setBidders(prev => prev.map(b => 
        b.id === data.bidderId 
          ? { ...b, remainingPurse: data.bidderRemainingPurse! }
          : b
      ))
    } else if (data.updatedBidders) {
      // Batch update multiple bidders
      setBidders(prev => prev.map(b => {
        const update = data.updatedBidders!.find(ub => ub.id === b.id)
        return update ? { ...b, remainingPurse: update.remainingPurse } : b
      }))
    }
    
    // Update player status instantly - update ALL players, not just current
    setPlayers(prev => prev.map(p => 
      p.id === data.playerId 
        ? { ...p, status: 'SOLD' as const, soldTo: data.bidderId, soldPrice: data.amount }
        : p
    ))
  }, [])

  const handleNewPlayer = useCallback((data: PusherPlayerData) => {
      console.log('🎬 NEW PLAYER EVENT RECEIVED - Starting reveal animation:', data.player)
      console.log('🎬 Player data:', {
        id: data.player?.id,
        name: (data.player?.data as any)?.Name || (data.player?.data as any)?.name,
        status: data.player?.status
      })
      
      // Clear any pending fallback timeout since Pusher event arrived
      if (fallbackTimeoutRef.current) {
        clearTimeout(fallbackTimeoutRef.current)
        fallbackTimeoutRef.current = null
        console.log('✅ Cleared fallback timeout - Pusher event received')
      }
      
      // Store the new player
      setPendingPlayer(data.player)
      pendingPlayerRef.current = data.player
      
      console.log('🎬 handleNewPlayer called (from Pusher):', {
        hasPlayer: !!data.player,
        playerName: (data.player?.data as any)?.Name || (data.player?.data as any)?.name,
        showPlayerReveal: showPlayerRevealRef.current,
        hasPendingPlayer: !!pendingPlayerRef.current
      })
      
      // If animation is already showing (triggered from handleMarkSold/handleMarkUnsold),
      // just update the pending player - don't restart the animation
      if (showPlayerRevealRef.current) {
        console.log('🎬 Animation already running, just updating pending player')
        // Animation is already running, just ensure pending player is updated
        // The animation will use the updated pendingPlayer
        return
      }
      
      // If animation is not showing yet, start it
      // Check if sold animation is showing - if so, delay reveal animation until after it closes
      if (soldAnimationRef.current) {
        console.log('⏳ Sold animation is showing, delaying reveal animation by 3s')
        setTimeout(() => {
          console.log('🎬 Delayed reveal animation starting now (from Pusher)')
          setShowPlayerReveal(true)
        }, 3000)
      } else {
        // Show reveal animation immediately if sold animation is not showing
        console.log('🎬 No sold animation, starting reveal animation immediately (from Pusher)')
        setShowPlayerReveal(true)
      }
      
      // Don't update current player yet - wait for animation to complete
  }, [])

  // Handler when reveal animation completes
  const handleRevealComplete = useCallback(() => {
      console.log('✅ REVEAL ANIMATION COMPLETE - Updating player')
      
      // Clear any pending fallback timeout since animation completed
      if (fallbackTimeoutRef.current) {
        clearTimeout(fallbackTimeoutRef.current)
        fallbackTimeoutRef.current = null
      }
      
      // Use ref to get latest pendingPlayer value (closure issue fix)
      const latestPendingPlayer = pendingPlayerRef.current
      
      if (latestPendingPlayer) {
        console.log('✅ Setting current player from pending player:', latestPendingPlayer)
        console.log('✅ Player data:', latestPendingPlayer.data)
        console.log('✅ Player name:', (latestPendingPlayer.data as any)?.Name || (latestPendingPlayer.data as any)?.name)
        
        // Hide animation first
        setShowPlayerReveal(false)
        
        // Set all state updates together - React 18 batches these automatically
        setIsImageLoading(true)
        setCurrentPlayer(latestPendingPlayer) // Set player FIRST
        setTimer(30)
        setBidHistory([]) // Clear bid history for new player
        setCurrentBid(null) // Clear current bid
        setHighestBidderId(null) // Clear highest bidder
        setSelectedBidderForBid(null) // Clear selected bidder
        setCustomBidAmount('') // Clear custom bid amount
        setBidAmount(0) // Clear bid amount for bidder
        // Clear loading states
        setIsMarkingSold(false)
        setIsMarkingUnsold(false)
        
        // Check team size when new player loads - use setTimeout to ensure players state is updated
        if (userBidder) {
          setTimeout(() => {
            const rules = auction.rules as any
            // Use maxTeamSize if set, otherwise fall back to mandatoryTeamSize (for existing auctions)
            const maxTeamSize = rules?.maxTeamSize || rules?.mandatoryTeamSize
            if (maxTeamSize) {
              // Access players state via a function to get latest value
              setPlayers(currentPlayers => {
                const playersBought = currentPlayers.filter(p => p.soldTo === userBidder.id && p.status === 'SOLD').length
                const isFull = playersBought >= maxTeamSize - 1
                console.log('[New Player Loaded] Team size check:', {
                  bidderId: userBidder.id,
                  bidderName: userBidder.teamName || userBidder.username,
                  playersBought,
                  maxTeamSize,
                  maxPlayersCanBuy: maxTeamSize - 1,
                  isFull,
                  newPlayerName: (latestPendingPlayer.data as any)?.Name || (latestPendingPlayer.data as any)?.name
                })
                return currentPlayers // Return unchanged to not modify state
              })
            }
          }, 200) // Delay to ensure players state is updated from Pusher
        }
        
        // Use setTimeout to ensure currentPlayer state update completes before clearing pending
        // This ensures the player card renders with the new player
        setTimeout(() => {
          // Clear pending player AFTER current player is set
          setPendingPlayer(null)
          pendingPlayerRef.current = null
        }, 0)
        
        // Refresh full bid history from server when new player loads
        refreshAuctionState()
      } else {
        console.warn('⚠️ No pending player found when animation completed')
        // Still hide animation even if no pending player
        setShowPlayerReveal(false)
      }
  }, [refreshAuctionState, userBidder, auction.rules])

  const handleAuctionPaused = useCallback(() => setIsPaused(true), [])
  const handleAuctionResumed = useCallback(() => setIsPaused(false), [])
  const handlePlayersUpdated = useCallback((data: { players?: any[]; bidders?: Array<{ id: string; remainingPurse: number }> }) => {
      // Update from Pusher data if available (no API call needed)
      if (data.players) {
        setPlayers(prev => {
          const updated = [...prev]
          data.players!.forEach(player => {
            const index = updated.findIndex(p => p.id === player.id)
            if (index >= 0) {
              updated[index] = player
            } else {
              updated.push(player)
            }
          })
          return updated
        })
        
        // Log team size check after players are updated
        if (userBidder) {
          const rules = auction.rules as any
          // Use maxTeamSize if set, otherwise fall back to mandatoryTeamSize (for existing auctions)
          const maxTeamSize = rules?.maxTeamSize || rules?.mandatoryTeamSize
          if (maxTeamSize) {
            // Use the updated players from data, not prev state
            const playersBought = data.players.filter(p => p.soldTo === userBidder.id && p.status === 'SOLD').length
            const isFull = playersBought >= maxTeamSize - 1
            console.log('[Players Updated] Team size check:', {
              bidderId: userBidder.id,
              bidderName: userBidder.teamName || userBidder.username,
              playersBought,
              maxTeamSize,
              maxPlayersCanBuy: maxTeamSize - 1,
              isFull
            })
          }
        }
      }
      
      if (data.bidders) {
        setBidders(prev => prev.map(b => {
          const update = data.bidders!.find(ub => ub.id === b.id)
          return update ? { ...b, remainingPurse: update.remainingPurse } : b
        }))
      }
  }, [userBidder, auction.rules])

  const handleAuctionReset = useCallback(() => {
      toast.success('Auction has been reset! Reloading page...')
      // Use router.refresh() to reload data without full page reload
      setTimeout(() => {
        router.refresh()
      }, 1000)
  }, [router])

  const handleAuctionEnded = useCallback(() => {
      toast.success('Auction ended successfully! Redirecting to results...')
      setTimeout(() => {
        // Redirect to the auction page which will show results view
        window.location.href = `/auction/${auction.id}`
      }, 1000)
  }, [auction.id])

  // Real-time subscriptions
  usePusher(auction.id, {
    onNewBid: handleNewBid,
    onBidUndo: handleBidUndo,
    onSaleUndo: handleSaleUndo,
    onTimerUpdate: handleTimerUpdate,
    onPlayerSold: handlePlayerSold,
    onNewPlayer: handleNewPlayer,
    onAuctionPaused: handleAuctionPaused,
    onAuctionResumed: handleAuctionResumed,
    onPlayersUpdated: handlePlayersUpdated,
    onAuctionEnded: handleAuctionEnded,
    onAuctionReset: handleAuctionReset,
    onBidError: (data) => {
      // Display error message via Pusher
      pushBidError(data.message)
    },
  })

  // Countdown timer - don't auto-advance when timer hits 0
  useEffect(() => {
    if (!isPaused && timer > 0) {
      const interval = setInterval(() => {
        setTimer(prev => Math.max(prev - 1, 0))
      }, 1000)
      return () => clearInterval(interval)
    }
  }, [isPaused, timer])


  const handleStartAuction = async () => {
    await fetch(`/api/auction/${auction.id}/start`, { method: 'POST' })
  }

  const handlePauseResume = async () => {
    if (isPaused) {
      await fetch(`/api/auction/${auction.id}/resume`, { method: 'POST' })
    } else {
      await fetch(`/api/auction/${auction.id}/pause`, { method: 'POST' })
    }
    setIsPaused(!isPaused)
  }

  const handleNextPlayer = async () => {
    try {
      const response = await fetch(`/api/auction/${auction.id}/next-player`, { method: 'POST' })
      if (!response.ok) {
        console.error('Failed to move to next player')
      }
    } catch (error) {
      console.error('Error moving to next player:', error)
    }
  }

  const handleEndAuction = async () => {
    await fetch(`/api/auction/${auction.id}/end`, { method: 'POST' })
  }

  const handleResetAuction = async () => {
    if (!confirm('Are you sure you want to reset the auction? This will:\n- Reset all players to AVAILABLE\n- Reset all bidders\' purses to original amounts\n- Clear all bid history\n- Set auction status to DRAFT\n\nThis action cannot be undone!')) {
      return
    }
    
    try {
      const response = await fetch(`/api/auction/${auction.id}/reset`, { method: 'POST' })
      if (response.ok) {
        toast.success('Auction reset successfully')
        // Use router.refresh() to reload data without full page reload
        // This avoids React context issues that occur with window.location.reload()
        setTimeout(() => {
          router.refresh()
        }, 500)
      } else {
        const error = await response.json()
        toast.error(error.error || 'Failed to reset auction')
      }
    } catch (error) {
      console.error('Error resetting auction:', error)
      toast.error('Failed to reset auction')
    }
  }

  const handleMarkSold = async () => {
    if (!currentPlayer || !currentBid) return

    // Optimistic UI update - show sold animation immediately
    setIsMarkingSold(true)
    setSoldAnimation(true)
    
    // Fire-and-forget API call - don't block UI
    fetch(`/api/auction/${auction.id}/mark-sold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: currentPlayer.id })
    })
      .then(async (response) => {
        if (response.ok) {
          const data = await response.json()
          toast.success('Player marked as sold!')
          
          // Trigger reveal animation immediately if we have next player
          if (data.nextPlayer) {
            console.log('🎬 Setting pending player from mark-sold response:', data.nextPlayer)
            setPendingPlayer(data.nextPlayer)
            pendingPlayerRef.current = data.nextPlayer
            
            // Clear any existing fallback timeout
            if (fallbackTimeoutRef.current) {
              clearTimeout(fallbackTimeoutRef.current)
              fallbackTimeoutRef.current = null
            }
            
            // Start reveal animation after sold animation closes (3 seconds)
            setTimeout(() => {
              console.log('🎬 Starting reveal animation after sold banner closed')
              setShowPlayerReveal(true)
            }, 3000)
            
            // Set a timeout fallback in case animation doesn't complete
            // Increased timeout to 12 seconds (3s sold + 5s reveal + 1.5s buffer + 2.5s extra safety)
            fallbackTimeoutRef.current = setTimeout(() => {
              console.warn('⚠️ Animation fallback triggered - setting player directly')
              const fallbackPlayer = pendingPlayerRef.current || data.nextPlayer
              if (fallbackPlayer) {
                setCurrentPlayer(fallbackPlayer)
                setCurrentBid(null)
                setBidHistory([])
                setHighestBidderId(null)
                setIsMarkingSold(false)
                setShowPlayerReveal(false)
                setPendingPlayer(null)
                pendingPlayerRef.current = null
                refreshAuctionState()
              }
              fallbackTimeoutRef.current = null
            }, 12000)
          }
          
          setTimeout(() => {
            setSoldAnimation(false)
            setCurrentBid(null)
            setBidHistory([])
            setHighestBidderId(null)
          }, 3000)
        } else {
          const errorData = await response.json()
          toast.error(errorData.error || 'Failed to mark as sold')
          setIsMarkingSold(false)
          setSoldAnimation(false)
        }
      })
      .catch(() => {
        toast.error('Network error')
        setIsMarkingSold(false)
        setSoldAnimation(false)
      })
  }

  const handleMarkUnsold = async () => {
    if (!currentPlayer) return

    // Optimistic UI update
    setIsMarkingUnsold(true)
    
    // Fire-and-forget API call - don't block UI
    fetch(`/api/auction/${auction.id}/mark-unsold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: currentPlayer.id })
    })
      .then(async (response) => {
        if (response.ok) {
          const data = await response.json()
          toast.success('Player marked as unsold')
          
          // Trigger reveal animation immediately if we have next player
          if (data.nextPlayer) {
            console.log('🎬 Setting pending player from mark-unsold response:', data.nextPlayer)
            setPendingPlayer(data.nextPlayer)
            pendingPlayerRef.current = data.nextPlayer
            
            // Clear any existing fallback timeout
            if (fallbackTimeoutRef.current) {
              clearTimeout(fallbackTimeoutRef.current)
              fallbackTimeoutRef.current = null
            }
            
            // Start reveal animation immediately (no sold banner for unsold)
            setShowPlayerReveal(true)
            
            // Set a timeout fallback in case animation doesn't complete
            // Increased timeout to 8 seconds (5s reveal + 1.5s buffer + 1.5s extra safety)
            fallbackTimeoutRef.current = setTimeout(() => {
              console.warn('⚠️ Animation fallback triggered - setting player directly')
              const fallbackPlayer = pendingPlayerRef.current || data.nextPlayer
              if (fallbackPlayer) {
                setCurrentPlayer(fallbackPlayer)
                setCurrentBid(null)
                setBidHistory([])
                setHighestBidderId(null)
                setIsMarkingUnsold(false)
                setShowPlayerReveal(false)
                setPendingPlayer(null)
                pendingPlayerRef.current = null
                refreshAuctionState()
              }
              fallbackTimeoutRef.current = null
            }, 8000)
          } else {
            setIsMarkingUnsold(false)
          }
        } else {
          toast.error('Failed to mark as unsold')
          setIsMarkingUnsold(false)
        }
      })
      .catch(() => {
        toast.error('Network error')
        setIsMarkingUnsold(false)
      })
  }

  const handleUndoSaleConfirm = async () => {
    try {
      const response = await fetch(`/api/auction/${auction.id}/undo-sale`, { method: 'POST' })
      const data = await response.json()
      if (response.ok) {
        setUndoSaleDialogOpen(false)
        // Real-time updates will come via Pusher event (handleSaleUndo)
        // But we can also update optimistically from API response
        if (data.player && data.bidder) {
          console.log('🔄 Updating state from API response (optimistic)')
          
          // Calculate refund amount from bidder balance change
          const oldBidder = bidders.find(b => b.id === data.bidder.id)
          const refundAmount = oldBidder ? data.bidder.remainingPurse - oldBidder.remainingPurse : 0
          
          setPlayers(prev => prev.map(p => 
            p.id === data.player.id ? data.player : p
          ))
          setBidders(prev => prev.map(b => 
            b.id === data.bidder.id ? data.bidder : b
          ))
          // Set the undone player as current player (API sets it as currentPlayerId)
          setCurrentPlayer(data.player)
          
          // Reset bid state
          setCurrentBid(null)
          setHighestBidderId(null)
          
          // Remove the "sold" entry and all bids for this player from activity log
          const playerData = data.player.data as any
          const playerName = playerData?.Name || playerData?.name || 'Player'
          setFullBidHistory(prev => {
            // Remove the "sold" entry and all bid entries for this player
            const filtered = prev.filter(entry => 
              !(entry.playerId === data.player.id && (entry.type === 'sold' || entry.type === 'bid'))
            )
            // Add undo event at the beginning
            const undoEvent: BidHistoryEntry = {
              type: 'sale-undo' as const,
              playerId: data.player.id,
              playerName: playerName,
              timestamp: new Date(),
              refundedAmount: refundAmount
            }
            return [undoEvent, ...filtered]
          })
          
          // Clear bid history for this player to start fresh
          setBidHistory([])
        }
        // Toast will be shown by handleSaleUndo when Pusher event arrives
      } else {
        toast.error(data.error || 'Failed to undo sale')
      }
    } catch (error) {
      console.error('Error undoing sale:', error)
      toast.error('Network error while undoing sale')
    }
  }

  // Extract player data from JSON
  const getPlayerData = (player: Player | null) => {
    if (!player || !player.data) return {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return player.data as Record<string, any>
  }

  // Memoize player data extraction for performance
  const playerData = useMemo(() => getPlayerData(currentPlayer), [currentPlayer])
  const playerName = useMemo(() => {
    return playerData.name || playerData.Name || 'No Player Selected'
  }, [playerData])

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

  // Check if there are any sold players (for showing Undo Last Sale button)
  const hasSoldPlayers = useMemo(() => {
    return players.some(p => p.status === 'SOLD')
  }, [players])

  // Preload images when player or bidders change
  useEffect(() => {
    const preloadImages = async () => {
      // Preload player image
      if (currentPlayer?.data) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = currentPlayer.data as Record<string, any>
        const imageUrl = data.imageUrl || data.ImageUrl || data.picUrl || data.PicUrl
        if (imageUrl) {
          try {
            const fileId = imageUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)?.[1]
            if (fileId) {
              const proxyImageUrl = `/api/proxy-image?id=${fileId}`
              await preloadImage(proxyImageUrl)
              setIsImageLoading(false)
            }
          } catch (error) {
            console.warn('Failed to preload player image:', error)
          }
        }
      }

      // Preload bidder logos
      if (bidders.length > 0) {
        bidders.forEach(bidder => {
          if (bidder.logoUrl) {
            preloadImage(bidder.logoUrl).catch(() => {
              // Silently fail for bidder logos
            })
          }
        })
      }
    }

    preloadImages()
  }, [currentPlayer, bidders])

  // Get all player names for reveal animation (must be before early return)
  // Only include players that are AVAILABLE (not SOLD, not UNSOLD, not RETIRED)
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
    
    console.log('🎭 All player names for animation:', {
      totalPlayers: players.length,
      availablePlayers: availablePlayers.length,
      namesCount: names.length,
      names: names.slice(0, 5) // Log first 5 names
    })
    
    return names.length > 0 ? names : ['Player 1', 'Player 2', 'Player 3'] // Fallback if no names
  }, [players, pendingPlayer])

  const pendingPlayerName = useMemo(() => {
    if (!pendingPlayer) return ''
    const data = pendingPlayer.data as any
    return data?.name || data?.Name || data?.player_name || 'Unknown Player'
  }, [pendingPlayer])

  // Cleanup fallback timeout on unmount
  useEffect(() => {
    return () => {
      if (fallbackTimeoutRef.current) {
        clearTimeout(fallbackTimeoutRef.current)
      }
    }
  }, [])

  // Early return for SSR
  if (!isClient) {
    return null
  }

  // Main return
  return (
    <>
      {/* Going Live Banner - Full Page Overlay */}
      <GoingLiveBanner 
        show={showGoingLiveBanner} 
        onComplete={() => setShowGoingLiveBanner(false)}
      />
      
      {/* Hide main content when banner is showing */}
      {!showGoingLiveBanner && (
        <div className={`${(showPinnedConsole || isBidConsoleOpen) ? 'lg:mr-[30%]' : ''} px-4 sm:px-6 lg:px-8 transition-all duration-200`}>
      <div className="max-w-[1400px] mx-auto py-4 sm:py-6 space-y-4">
        {/* Enhanced Header */}
        <div className="bg-white dark:bg-gray-800 rounded-xl overflow-hidden">
          {/* Top Section */}
          <div className="px-3 py-3 sm:px-6 sm:py-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-3">
              {/* Left: Title, Status, and Stats */}
              <div className="flex-1 w-full sm:w-auto">
                {/* Title and Status - Compact on mobile */}
                <div className="flex items-center justify-between sm:justify-start gap-2 sm:gap-3 mb-2">
                  <h1 className="text-base sm:text-2xl lg:text-3xl font-bold text-gray-900 dark:text-gray-100">{auction.name}</h1>
                  <Badge className={`px-2 py-0.5 sm:px-3 sm:py-1 text-[10px] sm:text-sm font-semibold rounded-full flex-shrink-0 ${
                    isLiveStatus(auction.status) 
                      ? 'bg-green-500 text-white animate-pulse' 
                      : auction.status === 'PAUSED'
                      ? 'bg-yellow-500 text-white'
                      : 'bg-gray-500 text-white'
                  }`}>
                    {auction.status}
                  </Badge>
                </div>
                
                {auction.description && (
                  <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mb-2 hidden sm:block">{auction.description}</p>
                )}
                
                {/* Inline Stats - Compact grid on mobile */}
                <div className="grid grid-cols-4 gap-1.5 sm:flex sm:flex-wrap sm:items-center sm:gap-3 text-[10px] sm:text-sm">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:gap-1">
                    <span className="font-medium text-gray-600 dark:text-gray-400">Total:</span>
                    <span className="font-bold text-gray-900 dark:text-gray-100">{initialStats.total}</span>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:gap-1">
                    <span className="font-medium text-gray-600 dark:text-gray-400">Sold:</span>
                    <span className="font-bold text-green-600">{initialStats.sold}</span>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:gap-1">
                    <span className="font-medium text-gray-600 dark:text-gray-400">Unsold:</span>
                    <span className="font-bold text-yellow-600">{initialStats.unsold}</span>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:gap-1">
                    <span className="font-medium text-gray-600 dark:text-gray-400">Left:</span>
                    <span className="font-bold text-purple-600">{initialStats.remaining}</span>
                  </div>
                  {/* Progress indicator - Full width on mobile */}
                  <div className="col-span-4 sm:col-span-1 flex items-center gap-2 sm:pl-2 sm:border-l border-gray-300 dark:border-gray-600 mt-1 sm:mt-0">
                    <div className="flex-1 sm:w-24 lg:w-32 bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 sm:h-2">
                      <div 
                        className="h-full bg-gradient-to-r from-green-500 to-emerald-500 rounded-full transition-all duration-500"
                        style={{ width: `${((initialStats.sold + initialStats.unsold) / initialStats.total * 100)}%` }}
                      />
                    </div>
                    <span className="font-bold text-blue-600 dark:text-blue-400 text-[10px] sm:text-xs flex-shrink-0">
                      {((initialStats.sold + initialStats.unsold) / initialStats.total * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
              </div>
              
              {/* Right: Share and Admin Controls - Always visible */}
              <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
                <Link href={`/auction/${auction.id}/teams`} target="_blank" rel="noopener noreferrer">
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 h-8 w-8 sm:w-auto sm:h-9 p-0 sm:px-3"
                  >
                    <Trophy className="h-3.5 w-3.5 sm:h-4 sm:w-4 sm:mr-2" />
                    <span className="hidden sm:inline">Team Stats</span>
                  </Button>
                </Link>
                
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const url = window.location.href
                    navigator.clipboard.writeText(url).then(() => {
                      toast.success('Auction link copied to clipboard!')
                    }).catch(() => {
                      toast.error('Failed to copy link')
                    })
                  }}
                  className="bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 h-8 w-8 sm:w-auto sm:h-9 p-0 sm:px-3"
                >
                  <Share2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 sm:mr-2" />
                  <span className="hidden sm:inline">Share</span>
                </Button>
                
                {viewMode === 'admin' && (
                  <>
                    <Button
                      onClick={() => setIsBidConsoleOpen(true)}
                      size="sm"
                      className="text-xs sm:text-sm px-2 sm:px-3 bg-emerald-600 hover:bg-emerald-700 text-white hidden sm:inline-flex h-9"
                      title="Open Bidding Console"
                    >
                      Console
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8 w-8 sm:w-auto sm:h-9 p-0 sm:px-3">
                          <MoreVertical className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48 z-[100] bg-white dark:bg-gray-800 shadow-xl">
                        <DropdownMenuItem 
                          onSelect={() => setIsBidConsoleOpen(true)}
                          className="text-gray-900 dark:text-gray-100 cursor-pointer sm:hidden"
                        >
                          <TrendingUp className="h-4 w-4 mr-2" />
                          Bidding Console
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onSelect={handleStartAuction} 
                          disabled={isLiveStatus(auction.status)}
                          className="text-gray-900 dark:text-gray-100 cursor-pointer"
                        >
                          <Play className="h-4 w-4 mr-2" />
                          Start Auction
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onSelect={handlePauseResume} 
                          disabled={!isLiveStatus(auction.status)}
                          className="text-gray-900 dark:text-gray-100 cursor-pointer"
                        >
                          {isPaused ? <Play className="h-4 w-4 mr-2" /> : <Pause className="h-4 w-4 mr-2" />}
                          {isPaused ? 'Resume' : 'Pause'}
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onSelect={handleNextPlayer} 
                          disabled={!isLiveStatus(auction.status)}
                          className="text-gray-900 dark:text-gray-100 cursor-pointer"
                        >
                          <SkipForward className="h-4 w-4 mr-2" />
                          Next Player
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onSelect={handleEndAuction} 
                          disabled={!isLiveStatus(auction.status)} 
                          className="text-red-600 dark:text-red-400 cursor-pointer"
                        >
                          <Square className="h-4 w-4 mr-2" />
                          End Auction
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onSelect={handleResetAuction} 
                          className="text-orange-600 dark:text-orange-400 cursor-pointer"
                        >
                          <RotateCcw className="h-4 w-4 mr-2" />
                          Reset Auction
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                )}
            </div>
          </div>
        </div>

        {/* Stats cards removed - now inline in header */}

        {/* Main Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Center Stage - Spotlight */}
          <div className="col-span-1 lg:col-span-2 order-1">
            <Card className="min-h-[300px] sm:min-h-[500px] bg-gradient-to-br from-white via-blue-50/30 to-indigo-50/30 dark:from-gray-800 dark:via-blue-900/10 dark:to-indigo-900/10 border-0">
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
              
              {/* Mobile Current Bid Banner */}
              <div className="lg:hidden sticky top-0 z-30 bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-3 rounded-t-lg shadow-lg">
                {currentBid ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="h-4 w-4" />
                        <span className="font-semibold text-xs uppercase tracking-wide">Current Bid</span>
                      </div>
                      <div className="text-lg font-bold">
                        ₹{currentBid.amount.toLocaleString('en-IN')}
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="opacity-90">By {currentBid.bidderName}</span>
                      {currentBid.teamName && (
                        <span className="bg-white/20 px-2 py-0.5 rounded-full">{currentBid.teamName}</span>
                      )}
                    </div>
                    {bidHistory.length > 1 && (
                      <div className="text-xs opacity-75">
                        {bidHistory.length} bid{bidHistory.length !== 1 ? 's' : ''} placed
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center text-sm py-2">
                    <span className="opacity-90">No bids yet - Be the first to bid!</span>
                  </div>
                )}
              </div>
              
          {/* New Player Spotlight Card (presentational) - client only to avoid SSR drift */}
          {isClient && (
            <div className="mb-4 space-y-4">
              {/* Player Card Container with Animation Overlay */}
              <div className="relative mx-1 sm:mx-0">
                {/* Player Reveal Animation - Inside Player Card */}
                <AnimatePresence mode="wait">
                  {showPlayerReveal && pendingPlayer && (
                    <PlayerRevealAnimation
                      key={`reveal-${pendingPlayer.id}`}
                      allPlayerNames={allPlayerNames}
                      finalPlayerName={pendingPlayerName}
                      onComplete={handleRevealComplete}
                      duration={5000}
                    />
                  )}
                </AnimatePresence>
                
                    {/* Combined Auction Phase Banner + Live Indicators */}
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
                      
                      {/* Right: Status Indicators */}
                      <div className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0">
                        <Badge className="bg-green-500 text-white text-[9px] sm:text-[10px] font-bold px-1 py-0.5 sm:px-1.5 sm:py-0.5 animate-pulse">
                          ● LIVE
                        </Badge>
                        {viewMode === 'admin' && (
                          <Badge className="bg-white/20 text-white border-white/30 text-[9px] sm:text-[10px] font-semibold px-1 py-0 sm:px-1.5 sm:py-0.5">
                            Admin
                          </Badge>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
                <div className={auctionPhase ? 'pt-8 sm:pt-10' : ''}>
                  <PlayerCard
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
                  // Get the Cricheroes Profile link field
                  const link = (playerData as any)?.['Cricheroes Profile link'] || 
                               (playerData as any)?.[' Cricheroes Profile link'] ||
                               (playerData as any)?.['cricheroes profile link']
                  
                  if (link && typeof link === 'string') {
                    // Extract URL from the text (handles cases like "Hey, check out... https://...")
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
              
              {/* Action Buttons Below Player Card (Admin Only) */}
              {viewMode === 'admin' && (
                <div className="px-4">
                  <ActionButtons
                    onMarkSold={handleMarkSold}
                    onMarkUnsold={handleMarkUnsold}
                    onUndoSale={hasSoldPlayers ? () => setUndoSaleDialogOpen(true) : undefined}
                    isMarkingSold={isMarkingSold}
                    isMarkingUnsold={isMarkingUnsold}
                    hasBids={bidHistory.length > 0 || currentBid !== null}
                  />
                </div>
              )}
            </div>
          )}

          <CardHeader className="hidden">
                <div className="flex flex-col items-center gap-3">
                  {(() => {
                    const profilePhotoLink = playerData['Profile Photo'] || playerData['profile photo'] || playerData['Profile photo']
                    
                    // If no profile photo, show placeholder with player name
                    if (!profilePhotoLink) {
                      return (
                        <>
                          <div className="w-48 h-48 sm:w-56 sm:h-56 lg:w-64 lg:h-64 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center ring-4 ring-blue-200 dark:ring-blue-900 shadow-2xl">
                            <span className="text-gray-600 dark:text-gray-400 text-4xl sm:text-5xl lg:text-6xl font-semibold">
                              {playerName.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <CardTitle className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 dark:text-gray-100 text-center">{playerName}</CardTitle>
                            {currentPlayer?.data && (currentPlayer.data as { isIcon?: boolean }).isIcon && (
                              <Badge className="bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg px-3 py-1 text-sm font-bold">
                                ⭐ BIDDER CHOICE
                              </Badge>
                            )}
                          </div>
                        </>
                      )
                    }
                    
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
                        <div className="w-48 h-48 sm:w-56 sm:h-56 lg:w-64 lg:h-64 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center overflow-hidden relative ring-4 ring-blue-200 dark:ring-blue-900 shadow-2xl">
                          {proxyImageUrl ? (
                            <>
                              {isImageLoading && (
                                <div className="absolute inset-0 flex items-center justify-center bg-gray-200 dark:bg-gray-700 rounded-full z-10">
                                  <div className="w-8 h-8 border-4 border-gray-300 border-t-gray-600 dark:border-gray-600 dark:border-t-gray-300 rounded-full animate-spin"></div>
                                </div>
                              )}
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img 
                                src={proxyImageUrl}
                                alt={playerName}
                                className="rounded-full object-contain w-full h-full p-2"
                                onError={(e) => {
                                  setIsImageLoading(false)
                                  console.error('Image failed to load, showing initial')
                                  const img = e.currentTarget
                                  img.style.display = 'none'
                                  const parent = img.parentElement
                                  if (parent) {
                                    parent.innerHTML = `
                                      <span class="text-gray-600 dark:text-gray-400 text-4xl sm:text-5xl lg:text-6xl font-semibold">
                                        ${playerName.charAt(0).toUpperCase()}
                                      </span>
                                    `
                                  }
                                }}
                                onLoad={() => {
                                  setIsImageLoading(false)
                                }}
                              />
                            </>
                          ) : (
                            <span className="text-gray-600 dark:text-gray-400 text-4xl sm:text-5xl lg:text-6xl font-semibold">
                              {playerName.charAt(0).toUpperCase()}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <CardTitle className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 dark:text-gray-100 text-center">{playerName}</CardTitle>
                          {currentPlayer?.data && (currentPlayer.data as { isIcon?: boolean }).isIcon && (
                            <Badge className="bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg px-3 py-1 text-sm font-bold">
                              ⭐ BIDDER CHOICE
                            </Badge>
                          )}
                        </div>
                      </>
                    )
                  })()}
                </div>
              </CardHeader>
              <CardContent className="space-y-3 sm:space-y-4 p-3 sm:p-6">
                {/* Essential Fields */}
                <div className="hidden">
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

                {/* Read More Section (hidden in new design) */}
                {false && (() => {
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
                {/* Current Bid Strip (presentational) */}
                {isClient && (
                  <div className="pt-4 mt-4">
                    <BidAmountStrip
                      amount={currentBid?.amount ?? null}
                      bidderName={currentBid?.bidderName}
                      teamName={currentBid?.teamName}
                      timerSeconds={displayTimer}
                      nextMin={(() => {
                        const currentBidAmount = currentBid?.amount || 0
                        const rules = auction.rules as any
                        const minIncrement = (rules?.minBidIncrement || 1000)
                        return currentBidAmount + minIncrement
                      })()}
                    />
                  </div>
                )}
                
              </CardContent>
            </Card>
          </div>

          {/* Right Sidebar: Bid History (sticky) */}
          <div className="order-2 lg:order-1 hidden lg:block space-y-4">
            
            {/* Bid console moved to sliding drawer */}
            {/* Bidder Controls - Show at top of sidebar for bidders */}
            {viewMode === 'bidder' && userBidder && isLiveStatus(auction.status) && (
              <Card className="bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700 shadow-lg">
                <CardHeader className="p-4 sm:p-6">
                  <CardTitle className="text-base sm:text-lg font-bold text-gray-900 dark:text-gray-100">Place Your Bid</CardTitle>
                  {error && (
                    <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-2 rounded">
                      {error}
                    </div>
                  )}
                </CardHeader>
                <CardContent className="p-4 sm:p-6 space-y-3">
                  {/* Remaining Purse */}
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    Remaining Purse: <span className="text-green-600 font-bold">₹{userBidder.remainingPurse.toLocaleString('en-IN')}</span>
                  </div>
                  
                  {/* Current Bid Display */}
                  {currentBid && (
                    <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded">
                      <div className="text-sm text-gray-700 dark:text-gray-300">
                        Current Bid: <span className="font-bold text-blue-600">₹{currentBid.amount.toLocaleString('en-IN')}</span>
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                        By: {currentBid.bidderName} {currentBid.teamName && `(${currentBid.teamName})`}
                      </div>
                    </div>
                  )}
                  
                  {/* Raise Bid Button */}
                    <Button 
                    className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-6 text-base"
                    onClick={async () => {
                      if (!userBidder) {
                        showBidError('Please log in to place a bid')
                        return
                      }
                      
                      // Check team size BEFORE allowing bid
                      const rules = auction.rules as any
                      // Use maxTeamSize if set, otherwise fall back to mandatoryTeamSize (for existing auctions)
                      const maxTeamSize = rules?.maxTeamSize || rules?.mandatoryTeamSize
                      if (maxTeamSize) {
                        const playersBought = players.filter(p => p.soldTo === userBidder.id && p.status === 'SOLD').length
                        console.log('[Raise Bid] Team size check:', { playersBought, maxTeamSize, maxPlayersCanBuy: maxTeamSize - 1 })
                        if (playersBought >= maxTeamSize - 1) {
                          // Don't show error here - let backend handle it to avoid duplicate messages
                          // The button should already be disabled via isTeamFull, but if clicked, backend will show error
                          return
                        }
                      }
                      
                      // Always use base increment (1000)
                      const currentBidAmount = currentBid?.amount || 0
                      const minIncrement = (rules?.minBidIncrement || 1000)
                      const totalBid = currentBidAmount + minIncrement
                      
                      if (totalBid > userBidder.remainingPurse) {
                        showBidError('Insufficient remaining purse')
                        return
                      }

                      setIsPlacingBid(true)
                      setError('')

                      try {
                        const response = await fetch(`/api/auction/${auction.id}/bid`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            bidderId: userBidder.id,
                            amount: totalBid
                          })
                        })

                        const data = await response.json()

                        if (response.ok) {
                          setBidAmount(0)
                          toast.success('Bid placed successfully!')
                        } else {
                          showBidError(data.error || 'Failed to place bid')
                        }
                      } catch {
                        showBidError('Network error. Please try again.')
                      } finally {
                        setIsPlacingBid(false)
                      }
                    }}
                    disabled={isPlacingBid || !userBidder || (currentBid?.bidderId === userBidder.id) || isTeamFull}
                  >
                    {isPlacingBid ? 'Placing Bid...' : isTeamFull ? 'Team Full' : (() => {
                      const currentBidAmount = currentBid?.amount || 0
                      const rules = auction.rules as AuctionRules | undefined
                      const minIncrement = (rules?.minBidIncrement || 1000)
                      return `Raise Bid (+₹${(minIncrement / 1000).toFixed(0)}K)`
                    })()}
                    </Button>

                  {/* Custom Bid */}
                  <div className="space-y-2">
                    <Label className="text-xs font-medium text-gray-700 dark:text-gray-300">Bid Amount (₹)</Label>
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        placeholder="Enter total bid amount"
                        value={bidAmount === 0 ? '' : bidAmount}
                        onChange={(e) => {
                          const value = e.target.value === '' ? 0 : Number(e.target.value)
                          setBidAmount(value)
                          setError('')
                        }}
                        className="bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-400"
                      />
                      <Button 
                        className="bg-blue-600 hover:bg-blue-700 text-white whitespace-nowrap px-6"
                        onClick={async () => {
                          if (!userBidder) {
                            showBidError('Please log in to place a bid')
                            return
                          }

                          // Check team size BEFORE allowing bid
                          // Note: Backend also validates this, but we check here to prevent unnecessary API calls
                          const rules = auction.rules as any
                          // Use maxTeamSize if set, otherwise fall back to mandatoryTeamSize (for existing auctions)
                          const maxTeamSize = rules?.maxTeamSize || rules?.mandatoryTeamSize
                          if (maxTeamSize) {
                            const playersBought = players.filter(p => p.soldTo === userBidder.id && p.status === 'SOLD').length
                            if (playersBought >= maxTeamSize - 1) {
                              // Don't show error here - let backend handle it to avoid duplicate messages
                              // The button should already be disabled via isTeamFull, but if clicked, backend will show error
                              return
                            }
                          }

                          if (!bidAmount || bidAmount <= 0) {
                            showBidError('Please enter a valid bid amount')
                            return
                          }

                          const currentBidAmount = currentBid?.amount || 0
                          const minIncrement = (rules?.minBidIncrement || 1000)
                          const difference = bidAmount - currentBidAmount

                          if (bidAmount <= currentBidAmount) {
                            showBidError('Bid must exceed current amount')
                            return
                          }

                          if (difference < minIncrement) {
                            showBidError(`Bid must be at least ₹${(currentBidAmount + minIncrement).toLocaleString('en-IN')}`)
                            return
                          }

                          if (bidAmount % 1000 !== 0) {
                            showBidError('Bid must be in multiples of ₹1,000')
                            return
                          }

                          if (bidAmount > userBidder.remainingPurse) {
                            showBidError('Insufficient remaining purse')
                            return
                          }

                          setIsPlacingBid(true)
                          setError('')

                          // Optimistically update currentBid immediately
                          const previousBid = currentBid
                          setCurrentBid({
                            bidderId: userBidder.id,
                            amount: bidAmount,
                            bidderName: userBidder.user?.name || userBidder.username,
                            teamName: userBidder.teamName || undefined
                          })

                          try {
                            const response = await fetch(`/api/auction/${auction.id}/bid`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                bidderId: userBidder.id,
                                amount: bidAmount
                              })
                            })

                            const data = await response.json()

                            if (response.ok) {
                              setBidAmount(0)
                              toast.success('Bid placed successfully!')
                            } else {
                              // Revert optimistic update on error
                              setCurrentBid(previousBid)
                              showBidError(data.error || 'Failed to place bid')
                            }
                          } catch {
                            // Revert optimistic update on error
                            setCurrentBid(previousBid)
                            showBidError('Network error. Please try again.')
                          } finally {
                            setIsPlacingBid(false)
                          }
                        }}
                        disabled={isPlacingBid || isTeamFull}
                      >
                        {isPlacingBid ? 'Placing...' : isTeamFull ? 'Team Full' : 'Place Bid'}
                      </Button>
                    </div>
                  </div>
              </CardContent>
            </Card>
            )}

          {/* Bid History */}
          {bidErrors.length > 0 && (
            <div className="space-y-2 mb-4">
              {bidErrors.map(err => (
                <div
                  key={err.id}
                  className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs sm:text-sm text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200"
                >
                  <span className="mt-0.5 text-red-600 dark:text-red-300">⚠️</span>
                  <span>{err.message}</span>
                </div>
              ))}
            </div>
          )}
          <Card className="border-0 lg:sticky lg:top-[calc(theme(spacing.4)+theme(spacing.4)+theme(spacing.4))]">
            <CardHeader className="p-4 sm:p-6">
              <CardTitle className="text-base sm:text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <span>📋</span> Live Activity
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 sm:p-4">
              <div className="max-h-[200px] sm:max-h-[300px] lg:max-h-[500px] overflow-y-auto pr-2">
                <ActivityLog
                  items={bidHistory as any}
        onUndoBid={viewMode === 'admin' ? async (entry) => {
          console.log('🎯 Undo button clicked for entry:', entry)
          try {
            if (!entry.bidderId) {
              console.log('❌ No bidderId in entry')
              return
            }
            console.log('📡 Calling undo-bid API with bidderId:', entry.bidderId)
            const response = await fetch(`/api/auction/${auction.id}/undo-bid`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ bidderId: entry.bidderId })
            })
            console.log('📡 API response status:', response.status)
            if (!response.ok) {
              const data = await response.json()
              console.log('❌ API error:', data)
              toast.error(data.error || 'Failed to undo bid')
            } else {
              console.log('✅ API success')
              toast.success('Bid undone successfully')
              // Reload page to show updated state (Pusher real-time not working due to React Strict Mode)
              setTimeout(() => window.location.reload(), 500)
            }
          } catch (error) {
            console.log('❌ Exception:', error)
            toast.error('Failed to undo bid')
          }
        } : undefined}
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Quick Bid Banner - Now moved to sidebar */}

        {/* Bidders Grid moved into right-side Bid Console for admin */}
              </div>

      {/* Mobile Bid Controls - Show for bidders */}
      {viewMode === 'bidder' && userBidder && auction.status === 'LIVE' && (
        <>
          {/* Floating action buttons */}
          <div className="lg:hidden fixed bottom-28 right-4 z-50 flex flex-col gap-3 items-end">
            {/* Quick Raise Bid Button */}
                    <Button
              onClick={() => {
                // Always use base increment (1000)
                const currentBidAmount = currentBid?.amount || 0
                const rules = auction.rules as AuctionRules | undefined
                const minIncrement = (rules?.minBidIncrement || 1000)
                const totalBid = currentBidAmount + minIncrement
                
                if (totalBid > userBidder.remainingPurse) {
                  showBidError('Insufficient remaining purse')
                  return
                }
                
                setIsPlacingBid(true)
                
                fetch(`/api/auction/${auction.id}/bid`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    bidderId: userBidder.id,
                    amount: totalBid
                  })
                }).then(response => response.json())
                  .then(data => {
                    if (data.error) {
                      showBidError(data.error)
                    } else {
                      toast.success('Bid placed successfully!')
                    }
                  }).catch(() => {
                    showBidError('Network error. Please try again.')
                  }).finally(() => {
                    setIsPlacingBid(false)
                  })
              }}
              className={`rounded-full px-4 py-5 shadow-2xl text-white flex items-center gap-2 ${
                (isPlacingBid || !userBidder || (currentBid?.bidderId === userBidder.id))
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-green-600 hover:bg-green-700'
              }`}
              disabled={isPlacingBid || !userBidder || (currentBid?.bidderId === userBidder.id) || isTeamFull}
            >
              <TrendingUp className="h-5 w-5" />
              <span className="font-semibold text-sm">{(() => {
                const currentBidAmount = currentBid?.amount || 0
                const rules = auction.rules as AuctionRules | undefined
                const minIncrement = (rules?.minBidIncrement || 1000)
                return `+₹${(minIncrement / 1000).toFixed(0)}K`
              })()}</span>
                    </Button>
            
            {/* Custom Bid Button */}
            <Button 
              onClick={() => setCustomBidModalOpen(true)}
              className="rounded-full px-4 py-5 shadow-2xl bg-blue-600 hover:bg-blue-700 text-white"
            >
              <span className="font-semibold text-sm">Custom</span>
            </Button>
                </div>
        </>
      )}

      {/* Mobile Bid History Floating Button */}
      <div className="lg:hidden fixed bottom-4 right-4 z-50">
        <Button 
          onClick={() => setBidHistoryModalOpen(true)}
          className="rounded-full px-5 py-6 shadow-2xl bg-blue-600 hover:bg-blue-700 text-white whitespace-nowrap"
        >
          <Clock className="h-5 w-5 mr-2" />
          <span className="text-sm font-semibold">History</span>
        </Button>
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
            <div className="px-4 py-2 space-y-2 flex-1 overflow-y-auto">
              {bidHistory.length === 0 ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  <p>No bids yet</p>
                </div>
              ) : (
                bidHistory.map((bid, index) => {
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
                        key={index}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.3 }}
                        className="text-sm border-l-4 border-green-500 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/40 dark:to-emerald-900/40 rounded-lg p-3 mb-2 shadow-lg"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-2xl">🎉</span>
                          <div className="font-bold text-lg text-green-800 dark:text-green-300">
                            {bid.playerName} SOLD!
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
                              ₹{bid.amount.toLocaleString('en-IN')}
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
                      key={index}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.3 }}
                      className="text-sm border-l-4 border-orange-500 bg-gradient-to-r from-orange-50 to-red-50 dark:from-orange-900/40 dark:to-red-900/40 rounded-lg p-3 mb-2 shadow-md"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-2xl">⏭️</span>
                        <div className="font-bold text-lg text-orange-800 dark:text-orange-300">
                          {bid.playerName} - UNSOLD
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
                
                if (bid.type === 'sale-undo') {
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
                      key={index}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.3 }}
                      className="text-sm border-l-4 border-purple-500 bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/40 dark:to-pink-900/40 rounded-lg p-3 mb-2 shadow-md"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-2xl">↩️</span>
                        <div className="font-bold text-lg text-purple-800 dark:text-purple-300">
                          {bid.playerName} - SALE UNDONE
                      </div>
                      </div>
                      {bid.refundedAmount && (
                        <div className="text-sm text-purple-700 dark:text-purple-400 mb-1">
                          Refunded ₹{bid.refundedAmount.toLocaleString('en-IN')} • Player restored to available
                        </div>
                      )}
                      <div className="text-xs text-purple-600 dark:text-purple-400">
                        ⏰ {timeAgo}
                    </div>
                    </motion.div>
                  )
                }
                
                // Handle regular bids - ensure amount exists
                if (!bid.amount) {
                  return null // Skip entries without amount
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
                
                const isLatestBid = index === 0 // Latest bid is first in the array
                const increment = isLatestBid
                  ? bid.amount 
                  : bid.amount - (bidHistory[index - 1]?.amount || bid.amount)
                
                const commentary = isLatestBid
                  ? "🎯 Current Top Bid!"
                  : increment > 50000 
                    ? "🚀 Big Jump!"
                    : "💪 Standard Bid"
                
                // Enhanced styling for auction-like appearance
                const bidStyle = isLatestBid 
                  ? "border-l-4 border-emerald-500 bg-gradient-to-r from-emerald-50 to-green-50 dark:from-emerald-900/30 dark:to-green-900/30 rounded-lg p-3 shadow-md animate-pulse"
                  : increment > 50000
                    ? "border-l-4 border-purple-500 bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/30 dark:to-pink-900/30 rounded-lg p-3"
                    : "border-l-4 border-blue-500 bg-gradient-to-r from-blue-50 to-cyan-50 dark:from-blue-900/30 dark:to-cyan-900/30 rounded-lg p-3"
                
                return (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, delay: index * 0.05 }}
                    className={`text-sm ${bidStyle} mb-2`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-lg text-gray-900 dark:text-gray-100">{bid.bidderName}</span>
                      {bid.teamName && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300">({bid.teamName})</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-semibold px-2 py-1 rounded ${
                          isLatestBid 
                            ? "bg-emerald-600 text-white" 
                            : increment > 50000 
                              ? "bg-purple-600 text-white"
                              : "bg-blue-600 text-white"
                        }`}>
                          {commentary}
                        </span>
                        <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                          ₹{bid.amount.toLocaleString('en-IN')}
                        </span>
                      </div>
                      {isLatestBid && viewMode === 'admin' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            if (!confirm('Undo this bid?')) return
                            try {
                              const response = await fetch(`/api/auction/${auction.id}/undo-bid`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ bidderId: bid.bidderId })
                              })
                              if (!response.ok) {
                                const data = await response.json()
                                toast.error(data.error || 'Failed to undo bid')
                              } else {
                                toast.success('Bid undone successfully')
                              }
                            } catch (error) {
                              toast.error('Failed to undo bid')
                            }
                          }}
                          className="h-7 px-2 text-xs bg-red-500 hover:bg-red-600 text-white border-red-600"
                        >
                          <Undo2 className="h-3 w-3 mr-1" />
                          Undo
                        </Button>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                      <span>⏰ {timeAgo}</span>
                      {increment > 0 && !isLatestBid && (
                        <span className="text-green-600 dark:text-green-400">↑ +₹{increment.toLocaleString('en-IN')}</span>
                      )}
                    </div>
                  </motion.div>
                )
              }))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
    </div>
      )}

    {/* Custom Bid Modal - For Both Admin and Bidder */}
    <Dialog open={customBidModalOpen} onOpenChange={(open) => {
      setCustomBidModalOpen(open)
      if (!open) {
        setSelectedBidderForBid(null)
        setBidAmount(0)
        setError('')
      }
    }}>
      <DialogContent className="sm:max-w-md">
        <DialogTitle className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Custom Bid
          {selectedBidderForBid && (() => {
            const selectedBidder = bidders.find(b => b.id === selectedBidderForBid)
            return selectedBidder ? ` - ${selectedBidder.teamName || selectedBidder.user?.name}` : ''
          })()}
        </DialogTitle>
        <DialogDescription className="sr-only">Place a custom bid amount</DialogDescription>
        <div className="space-y-4">
          
          {/* Remaining Purse */}
          {(() => {
            const activeBidder = selectedBidderForBid 
              ? bidders.find(b => b.id === selectedBidderForBid)
              : userBidder
            
            if (!activeBidder) return null
            
            return (
              <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded">
                <div className="text-sm text-gray-700 dark:text-gray-300">Remaining Purse</div>
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                  ₹{activeBidder.remainingPurse.toLocaleString('en-IN')}
                </div>
              </div>
            )
          })()}
          
          {/* Current Bid */}
          {currentBid && (
            <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded">
              <div className="text-sm text-gray-700 dark:text-gray-300">Current Bid</div>
              <div className="text-xl font-bold text-blue-600 dark:text-blue-400">
                ₹{currentBid.amount.toLocaleString('en-IN')}
              </div>
            </div>
          )}
          
          {/* Error Display */}
          {error && (
            <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-3 rounded">
              {error}
            </div>
          )}
          
          {/* Custom Amount Input */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Total Bid Amount (₹)</Label>
            <Input
              type="number"
              placeholder="Enter total bid amount"
              value={bidAmount || ''}
              onChange={(e) => {
                setBidAmount(Number(e.target.value))
                setError('')
              }}
              className="text-lg font-semibold"
            />
            <p className="text-xs text-gray-500">
              {(() => {
                const currentBidAmount = currentBid?.amount || 0
                const rules = auction.rules as any
                const minInc = (rules?.minBidIncrement || 1000)
                return `Current: ₹${currentBidAmount.toLocaleString('en-IN')} • Minimum: ₹${(currentBidAmount + minInc).toLocaleString('en-IN')} • Must be in multiples of ₹1,000`
              })()}
            </p>
          </div>
          
          {/* Buttons */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800"
              onClick={() => {
                setCustomBidModalOpen(false)
                setError('')
                setBidAmount(0)
              }}
            >
              Cancel
            </Button>
            <Button
              className="flex-1 bg-green-600 hover:bg-green-700 text-white"
              onClick={async () => {
                // Determine which bidder to use (admin selected or user's own)
                const activeBidder = selectedBidderForBid 
                  ? bidders.find(b => b.id === selectedBidderForBid)
                  : userBidder
                
                if (!activeBidder || !bidAmount) return

                const currentBidAmount = currentBid?.amount || 0
                const rules = auction.rules as AuctionRules | undefined
                const minIncrement = (rules?.minBidIncrement || 1000)
                const totalBid = bidAmount
                const difference = totalBid - currentBidAmount

                if (totalBid <= currentBidAmount) {
                  showBidError('Bid must exceed current amount')
                  return
                }

                // For custom bids, only check:
                // 1. Must be at least minIncrement more than current bid
                // 2. Must be in multiples of ₹1,000 (not increment)
                if (difference < minIncrement) {
                  showBidError(`Bid must be at least ₹${(currentBidAmount + minIncrement).toLocaleString('en-IN')}`)
                  return
                }

                if (totalBid % 1000 !== 0) {
                  showBidError('Bid must be in multiples of ₹1,000')
                  return
                }

                if (totalBid > activeBidder.remainingPurse) {
                  showBidError('Insufficient remaining purse')
                  return
                }

                // Optimistic UI updates - batched together
                // Use current state for rollback, but calculate optimistic bid based on latest state
                const previousBid = currentBid
                const previousHighestBidderId = highestBidderId
                
                // Create unique optimistic entry ID to track and remove it later
                const optimisticEntryId = `optimistic-${Date.now()}-${Math.random()}`
                const optimisticEntry: BidHistoryEntry = {
                  type: 'bid',
                  bidderId: activeBidder.id,
                  amount: totalBid,
                  timestamp: new Date(),
                  bidderName: activeBidder.user?.name || activeBidder.username,
                  teamName: activeBidder.teamName || undefined,
                  playerId: currentPlayer?.id,
                  // Add unique identifier for tracking
                  _optimisticId: optimisticEntryId
                } as any

                // Batch all state updates (React 18 auto-batches)
                setIsPlacingBid(true)
                setError('')
                setCurrentBid({
                  bidderId: activeBidder.id,
                  amount: totalBid,
                  bidderName: activeBidder.user?.name || activeBidder.username,
                  teamName: activeBidder.teamName || undefined
                })
                setHighestBidderId(activeBidder.id)
                setFullBidHistory(prev => [optimisticEntry, ...prev])

                // Fire-and-forget API call - don't block UI
                fetch(`/api/auction/${auction.id}/bid`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    bidderId: activeBidder.id,
                    amount: totalBid
                  })
                })
                  .then(async (response) => {
                    if (!response.ok) {
                      const data = await response.json()
                      showBidError(data.error || 'Failed to place bid')
                      // Revert optimistic update - remove by unique ID
                      setCurrentBid(previousBid)
                      setHighestBidderId(previousHighestBidderId)
                      setFullBidHistory(prev => prev.filter(entry => 
                        (entry as any)._optimisticId !== optimisticEntryId
                      ))
                    } else {
                      // Success - close modal and clear form (non-blocking)
                      startTransition(() => {
                        setBidAmount(0)
                        setCustomBidModalOpen(false)
                        setSelectedBidderForBid(null)
                      })
                      toast.success('Bid placed successfully!')
                    }
                  })
                  .catch(() => {
                    showBidError('Network error. Please try again.')
                    // Revert optimistic update - remove by unique ID
                    setCurrentBid(previousBid)
                    setHighestBidderId(previousHighestBidderId)
                    setFullBidHistory(prev => prev.filter(entry => 
                      (entry as any)._optimisticId !== optimisticEntryId
                    ))
                  })
                  .finally(() => {
                    setIsPlacingBid(false)
                  })
              }}
              disabled={isPlacingBid || bidAmount === 0}
            >
              {isPlacingBid ? 'Placing...' : 'Place Bid'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    {/* Sliding Bidding Console (Admin only) */}
    {viewMode === 'admin' && (
      showPinnedConsole ? (
        <div className="hidden lg:flex fixed right-0 top-0 h-full w-[30%] z-40">
          <BidConsolePanel />
        </div>
      ) : (
        <div className={`${isBidConsoleOpen ? 'fixed' : 'hidden'} inset-0 z-50`}>
          <div
            className="absolute inset-0 bg-black/20"
            onClick={() => setIsBidConsoleOpen(false)}
          />
          <div className="absolute right-0 top-0 h-full w-full sm:w-2/3 lg:w-[30%]">
            <BidConsolePanel showClose={true} onClose={() => setIsBidConsoleOpen(false)} />
          </div>
        </div>
      )
    )}

    {/* Public Chat */}
    <PublicChat auctionId={auction.id} rightOffsetClass={chatOffsetClass} />
    
    {/* Undo Sale Dialog */}
    <AlertDialog open={undoSaleDialogOpen} onOpenChange={setUndoSaleDialogOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Undo Last Sale?</AlertDialogTitle>
          <AlertDialogDescription>
            This will restore the last sold player back to the auction and refund the bidder. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleUndoSaleConfirm} className="bg-red-600 hover:bg-red-700 text-white">
            Undo Sale
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}

