'use client'

import { useState, useEffect, useCallback, useMemo, useRef, startTransition } from 'react'
import { Auction, Player, Bidder } from '@prisma/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Clock, Play, Pause, SkipForward, Square, Undo2, TrendingUp, ChevronDown, ChevronUp, Share2, MoreVertical, Trophy } from 'lucide-react'
import Link from 'next/link'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { usePusher } from '@/lib/pusher-client'
import { motion, AnimatePresence } from 'framer-motion'
import { PublicChat } from '@/components/public-chat'
import { ActivityLog } from '@/components/activity-log'
import PlayerCard from '@/components/player-card'
import BidAmountStrip from '@/components/bid-amount-strip'
import ActionButtons from '@/components/action-buttons'
import { toast } from 'sonner'
import { useSession } from 'next-auth/react'
import { preloadImage } from '@/lib/image-preloader'

interface BidHistoryEntry {
  bidderId: string
  amount: number
  timestamp: Date
  bidderName: string
  teamName?: string
  type?: 'bid' | 'sold' | 'unsold'
  playerId?: string
  playerName?: string
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
  previousBid: number | null
  remainingPurse?: number // Added for instant UI updates
  currentBid?: {
    bidderId: string
    amount: number
    bidderName: string
    teamName?: string
  }
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
  const { data: session } = useSession()
  const [currentPlayer, setCurrentPlayer] = useState(initialPlayer)
  const [currentBid, setCurrentBid] = useState<{ bidderId: string; amount: number; bidderName: string; teamName?: string } | null>(null)
  const [timer, setTimer] = useState(30)
  const [isPaused, setIsPaused] = useState(false)
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
  const [customBidModalOpen, setCustomBidModalOpen] = useState(false)
  const [players, setPlayers] = useState(auction.players)
  const [bidAmount, setBidAmount] = useState(0)
  const [isPlacingBid, setIsPlacingBid] = useState(false)
  const [placingBidFor, setPlacingBidFor] = useState<string | null>(null) // Track which bidder's bid is being placed
  const [error, setError] = useState('')
  const [bidders, setBidders] = useState(auction.bidders)
  const [pinnedBidderIds, setPinnedBidderIds] = useState<string[]>([])
  const [isBidConsoleOpen, setIsBidConsoleOpen] = useState(false)
  const [isBidConsolePinned, setIsBidConsolePinned] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    try {
      const v = localStorage.getItem('admin.bidConsole.pinned')
      return v === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem('admin.bidConsole.pinned', isBidConsolePinned ? '1' : '0')
    } catch {}
  }, [isBidConsolePinned])

  // Find current user's bidder profile (for bidder view)
  const userBidder = bidders.find((b) => b.userId === session?.user?.id)

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

  // Memoize player bid history for performance
  const playerBidHistory = useMemo(() => {
    if (!currentPlayer?.id) return []
    // Filter bids to only include those for the current player
    const filteredBids = fullBidHistory.filter(bid => {
      // Only include bids that have playerId matching current player
      return bid.playerId === currentPlayer.id
    })
    // Keep latest first (no reverse needed since fullBidHistory adds new bids at beginning)
    return filteredBids
  }, [currentPlayer?.id, fullBidHistory])

  // Filter bid history for current player whenever player changes
  useEffect(() => {
    if (currentPlayer?.id) {
      setBidHistory(playerBidHistory)
      
      // Get the most recent bid (first item, since latest is first)
      const latestBid = playerBidHistory.length > 0 ? playerBidHistory[0] : null
      
      // Update current bid to the latest bid (only if it's a bid event, not a sale event)
      if (latestBid && (!latestBid.type || latestBid.type === 'bid')) {
        // Only update if there's actually a valid bid
        if (latestBid.amount && latestBid.bidderId) {
        setCurrentBid({
            bidderId: latestBid.bidderId,
            amount: latestBid.amount,
            bidderName: latestBid.bidderName,
            teamName: latestBid.teamName
          })
          setHighestBidderId(latestBid.bidderId)
        }
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
      
      // Update state from Pusher (this is the source of truth, corrects any API response discrepancies)
      setCurrentBid({
        bidderId: data.bidderId,
        amount: data.amount,
        bidderName: data.bidderName,
        teamName: data.teamName
      })
      setHighestBidderId(data.bidderId) // Update from server-confirmed data
      
      // Auto-pin logic: Keep only last 2 bidders pinned
      setPinnedBidderIds(prev => {
        // If this bidder is already pinned, keep current pins
        if (prev.includes(data.bidderId)) {
          return prev
        }
        // Add new bidder and keep only last 2
        const newPins = [...prev, data.bidderId]
        return newPins.slice(-2) // Keep only the last 2 bidders
      })
      
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
        // Deduplicate if the same top-of-list bid already exists for this player
        if (last && last.type === 'bid' && last.playerId === newBidEntry.playerId && last.bidderId === newBidEntry.bidderId && last.amount === newBidEntry.amount) {
          return prev
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
      // Clear bid placement state when bid is undone
      setIsPlacingBid(false)
      setPlacingBidFor(null)
      
      // Remove last bid from history
      setBidHistory(prev => prev.slice(1))
      setFullBidHistory(prev => prev.slice(1))
      // Update current bid
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
      const rules = auction.rules as AuctionRules | undefined
      setTimer(rules?.countdownSeconds || 30)
      
      // Update purse instantly from Pusher data if available
      if (data.remainingPurse !== undefined && data.bidderId) {
        setBidders(prev => prev.map(b => 
          b.id === data.bidderId 
            ? { ...b, remainingPurse: data.remainingPurse! }
            : b
        ))
      }
  }, [auction.rules])

  const handleSaleUndo = useCallback(() => {
      // Reload to get updated state
      window.location.reload()
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
    
    // Update player status instantly
    if (currentPlayer?.id === data.playerId) {
      setPlayers(prev => prev.map(p => 
        p.id === data.playerId 
          ? { ...p, status: 'SOLD' as const, soldTo: data.bidderId, soldPrice: data.amount }
          : p
      ))
    }
  }, [currentPlayer])

  const handleNewPlayer = useCallback((data: PusherPlayerData) => {
      setIsImageLoading(true)
      setCurrentPlayer(data.player)
      setTimer(30)
      setBidHistory([]) // Clear bid history for new player
    setCurrentBid(null) // Clear current bid
    setHighestBidderId(null) // Clear highest bidder
    setSelectedBidderForBid(null) // Clear selected bidder
    setCustomBidAmount('') // Clear custom bid amount
    setBidAmount(0) // Clear bid amount for bidder
    setPinnedBidderIds([]) // Clear pinned bidders for new player
      // Keep console state if pinned; otherwise leave current behavior
      if (isBidConsolePinned) {
        setIsBidConsoleOpen(true)
      }
      // Refresh full bid history from server when new player loads
      refreshAuctionState()
  }, [refreshAuctionState, isBidConsolePinned])

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
      }
      
      if (data.bidders) {
        setBidders(prev => prev.map(b => {
          const update = data.bidders!.find(ub => ub.id === b.id)
          return update ? { ...b, remainingPurse: update.remainingPurse } : b
        }))
      }
  }, [])
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

  const handleMarkSold = async () => {
    if (!currentPlayer || !currentBid) return

    // Don't use optimistic state - wait for server confirmation
    // The server will use the actual highest bidder from bid history
    
    try {
    const response = await fetch(`/api/auction/${auction.id}/mark-sold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: currentPlayer.id })
    })

    if (response.ok) {
      const data = await response.json()
      // Show sold animation after server confirms
      setSoldAnimation(true)
      toast.success('Player marked as sold!')
      
      setTimeout(() => {
        setCurrentPlayer(data.nextPlayer)
        setCurrentBid(null)
        setBidHistory([])
        setHighestBidderId(null)
        setSoldAnimation(false)
      }, 3000)
      } else {
        const errorData = await response.json()
        toast.error(errorData.error || 'Failed to mark as sold')
      }
    } catch {
      toast.error('Network error')
    }
  }

  const handleMarkUnsold = async () => {
    if (!currentPlayer) return

    // Optimistic UI - show toast immediately
    toast.info('Marking player as unsold...')

    try {
    const response = await fetch(`/api/auction/${auction.id}/mark-unsold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: currentPlayer.id })
    })

    if (response.ok) {
      const data = await response.json()
      setCurrentPlayer(data.nextPlayer)
      setCurrentBid(null)
      setBidHistory([])
      setHighestBidderId(null)
        toast.success('Player marked as unsold')
      } else {
        toast.error('Failed to mark as unsold')
      }
    } catch {
      toast.error('Network error')
    }
  }

  const handleUndoSaleConfirm = async () => {
    const response = await fetch(`/api/auction/${auction.id}/undo-sale`, { method: 'POST' })
    const data = await response.json()
    if (response.ok) {
      setUndoSaleDialogOpen(false)
      // Refetch auction to get updated state
      window.location.reload()
    } else {
      alert(data.error || 'Failed to undo sale')
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
  const playerName = useMemo(() => 
    playerData.name || playerData.Name || 'No Player Selected',
    [playerData]
  )

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

  if (!isClient) {
    // Avoid SSR/CSR markup drift by rendering after mount
    return null
  }

  return (
    <>
    <div className={`${isBidConsoleOpen ? 'lg:mr-[30%]' : ''} p-4 sm:p-6 transition-all duration-200`}>
      <div className="max-w-7xl mx-auto space-y-4">
        {/* Enhanced Header */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          {/* Top Section */}
          <div className="px-6 py-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              {/* Left: Title, Status, and Stats */}
              <div className="flex-1 w-full sm:w-auto">
                <div className="flex items-center gap-3 flex-wrap mb-2">
                  <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-900 dark:text-gray-100">{auction.name}</h1>
                  <Badge className={`px-3 py-1 text-xs sm:text-sm font-semibold rounded-full ${
                    auction.status === 'LIVE' 
                      ? 'bg-green-500 text-white animate-pulse shadow-lg shadow-green-500/50' 
                      : auction.status === 'PAUSED'
                      ? 'bg-yellow-500 text-white'
                      : 'bg-gray-500 text-white'
                  }`}>
                {auction.status}
              </Badge>
            </div>
                
                {auction.description && (
                  <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mb-2">{auction.description}</p>
                )}
                
                {/* Inline Stats with Progress - Stack on mobile */}
                <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs sm:text-sm">
                  <div className="flex items-center gap-1">
                    <span className="font-medium text-gray-600 dark:text-gray-400">Total:</span>
                    <span className="font-bold text-gray-900 dark:text-gray-100">{initialStats.total}</span>
          </div>
                  <div className="flex items-center gap-1">
                    <span className="font-medium text-gray-600 dark:text-gray-400">Sold:</span>
                    <span className="font-bold text-green-600">{initialStats.sold}</span>
          </div>
                  <div className="flex items-center gap-1">
                    <span className="font-medium text-gray-600 dark:text-gray-400">Unsold:</span>
                    <span className="font-bold text-yellow-600">{initialStats.unsold}</span>
        </div>
                  <div className="flex items-center gap-1">
                    <span className="font-medium text-gray-600 dark:text-gray-400">Remaining:</span>
                    <span className="font-bold text-purple-600">{initialStats.remaining}</span>
            </div>
                  {/* Progress indicator */}
                  <div className="flex items-center gap-2 pl-2 border-l border-gray-300 dark:border-gray-600">
                    <div className="w-20 sm:w-24 lg:w-32 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                      <div 
                        className="h-full bg-gradient-to-r from-green-500 to-emerald-500 rounded-full transition-all duration-500"
                        style={{ width: `${((initialStats.sold + initialStats.unsold) / initialStats.total * 100)}%` }}
                      />
            </div>
                    <span className="font-bold text-blue-600 dark:text-blue-400 text-xs">
                      {((initialStats.sold + initialStats.unsold) / initialStats.total * 100).toFixed(0)}%
                    </span>
            </div>
                </div>
              </div>
              
              {/* Right: Share and Admin Controls - Always visible */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <Link href={`/auction/${auction.id}/teams`} target="_blank" rel="noopener noreferrer">
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 px-2 sm:px-3"
                  >
                    <Trophy className="h-4 w-4 sm:mr-2" />
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
                  className="bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 px-2 sm:px-3"
                >
                  <Share2 className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">Share</span>
                </Button>
                
                {viewMode === 'admin' && (
                  <>
                    <Button
                      onClick={() => setIsBidConsoleOpen(true)}
                      size="sm"
                      className="text-xs sm:text-sm px-2 sm:px-3 bg-emerald-600 hover:bg-emerald-700 text-white hidden sm:inline-flex"
                      title="Open Bidding Console"
                    >
                      Console
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="px-2 sm:px-3 min-w-[36px]">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48 z-[100] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                        <DropdownMenuItem 
                          onSelect={() => setIsBidConsoleOpen(true)}
                          className="text-gray-900 dark:text-gray-100 cursor-pointer sm:hidden"
                        >
                          <TrendingUp className="h-4 w-4 mr-2" />
                          Bidding Console
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onSelect={handleStartAuction} 
                          disabled={auction.status === 'LIVE'}
                          className="text-gray-900 dark:text-gray-100 cursor-pointer"
                        >
                          <Play className="h-4 w-4 mr-2" />
                          Start Auction
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onSelect={handlePauseResume} 
                          disabled={auction.status !== 'LIVE'}
                          className="text-gray-900 dark:text-gray-100 cursor-pointer"
                        >
                          {isPaused ? <Play className="h-4 w-4 mr-2" /> : <Pause className="h-4 w-4 mr-2" />}
                          {isPaused ? 'Resume' : 'Pause'}
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onSelect={handleNextPlayer} 
                          disabled={auction.status !== 'LIVE'}
                          className="text-gray-900 dark:text-gray-100 cursor-pointer"
                        >
                          <SkipForward className="h-4 w-4 mr-2" />
                          Next Player
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onSelect={handleEndAuction} 
                          disabled={auction.status !== 'LIVE'} 
                          className="text-red-600 dark:text-red-400 cursor-pointer"
                        >
                          <Square className="h-4 w-4 mr-2" />
                          End Auction
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
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 sm:gap-4">
          {/* Center Stage - Spotlight */}
          <div className="col-span-1 lg:col-span-2 order-1">
            <Card className="min-h-[300px] sm:min-h-[500px] bg-gradient-to-br from-white via-blue-50/30 to-indigo-50/30 dark:from-gray-800 dark:via-blue-900/10 dark:to-indigo-900/10 border-2 border-blue-100 dark:border-blue-900 shadow-xl">
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
            <div className="mb-4">
              <PlayerCard
                name={playerName}
                imageUrl={undefined}
                tags={((currentPlayer as any)?.isIcon || (currentPlayer?.data as any)?.isIcon) ? [{ label: 'Icon', color: 'purple' }] : []}
                fields={(() => {
                  const essentials: Array<{ label: string; value: string }> = []
                  const add = (label: string, key: string) => {
                    const v = (playerData as any)[key]
                    if (v) essentials.push({ label, value: String(v) })
                  }
                  add('Speciality', 'Speciality')
                  add('Batting Type', 'Batting Type')
                  add('Bowling Type', 'Bowling Type')
                  return essentials
                })()}
              />
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
                                ⭐ ICON PLAYER
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
                                className="rounded-full object-cover w-full h-full"
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
                              ⭐ ICON PLAYER
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
                      timerSeconds={timer}
                      nextMin={(currentBid?.amount || 0) + ((auction.rules as any)?.minBidIncrement || 1000)}
                    />
                  </div>
                )}
                
              </CardContent>
            </Card>
          </div>

          {/* Right Sidebar: Bid History (sticky) */}
          <div className="order-2 lg:order-1 hidden lg:block space-y-4">
            {/* Admin Controls - Above Live Activity */}
            {viewMode === 'admin' && (
              <div className="space-y-3">
                <ActionButtons
                  onMarkSold={handleMarkSold}
                  onMarkUnsold={handleMarkUnsold}
                  onUndoSale={() => setUndoSaleDialogOpen(true)}
                />
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
              </div>
            )}
            
            {/* Bid console moved to sliding drawer */}
            {/* Bidder Controls - Show at top of sidebar for bidders */}
            {viewMode === 'bidder' && userBidder && auction.status === 'LIVE' && (
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
                        setError('Please log in to place a bid')
                        return
                      }
                      
                      const rules = auction.rules as AuctionRules | undefined
                      const minIncrement = rules?.minBidIncrement || 1000
                      const totalBid = (currentBid?.amount || 0) + minIncrement
                      
                      if (totalBid > userBidder.remainingPurse) {
                        setError('Insufficient remaining purse')
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
                          setError(data.error || 'Failed to place bid')
                        }
                      } catch {
                        setError('Network error. Please try again.')
                      } finally {
                        setIsPlacingBid(false)
                      }
                    }}
                    disabled={isPlacingBid || !userBidder || (currentBid?.bidderId === userBidder.id)}
                  >
                    {isPlacingBid ? 'Placing Bid...' : `Raise Bid (+₹1,000)`}
                    </Button>

                  {/* Custom Bid */}
                  <div className="space-y-2">
                    <Label className="text-xs font-medium text-gray-700 dark:text-gray-300">Custom Bid Amount (in ₹1000s):</Label>
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        placeholder="Enter amount in thousands"
                        value={bidAmount}
                        onChange={(e) => {
                          setBidAmount(Number(e.target.value))
                          setError('')
                        }}
                        min="1000"
                        step="1000"
                        className="bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                      />
                      <Button 
                        className="bg-blue-600 hover:bg-blue-700 text-white whitespace-nowrap px-6"
                        onClick={async () => {
                          if (!userBidder) {
                            setError('Please log in to place a bid')
                            return
                          }

                          if (!bidAmount || bidAmount <= 0) {
                            setError('Please enter a valid bid amount')
                            return
                          }

                          // Validate bid is a multiple of 1000
                          if (bidAmount % 1000 !== 0) {
                            setError('Bid amount must be in multiples of ₹1,000')
                            return
                          }

                          const rules = auction.rules as AuctionRules | undefined
                          const minIncrement = rules?.minBidIncrement || 1000
                          
                          if (bidAmount < (currentBid?.amount || 0) + minIncrement) {
                            setError(`Bid must be at least ₹${((currentBid?.amount || 0) + minIncrement).toLocaleString('en-IN')}`)
                            return
                          }

                          if (bidAmount > userBidder.remainingPurse) {
                            setError('Insufficient remaining purse')
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
                                amount: bidAmount
                              })
                            })

                            const data = await response.json()

                            if (response.ok) {
                              setBidAmount(0)
                              toast.success('Bid placed successfully!')
                            } else {
                              setError(data.error || 'Failed to place bid')
                            }
                          } catch {
                            setError('Network error. Please try again.')
                          } finally {
                            setIsPlacingBid(false)
                          }
                        }}
                        disabled={isPlacingBid}
                      >
                        {isPlacingBid ? 'Placing...' : 'Place Bid'}
                      </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
            )}

          {/* Bid History */}
            <Card className="shadow-lg border-2 border-blue-100 dark:border-blue-900 lg:sticky lg:top-[calc(theme(spacing.4)+theme(spacing.4)+theme(spacing.4))]">
              <CardHeader className="p-4 sm:p-6 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20">
                <CardTitle className="text-base sm:text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                  <span>📋</span> Live Activity
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 sm:p-4">
                <div className="max-h-[200px] sm:max-h-[300px] lg:max-h-[500px] overflow-y-auto pr-2">
                  {isClient && (
                    <ActivityLog
                      items={bidHistory as any}
                      onUndoBid={async (entry) => {
                        try {
                          if (!entry.bidderId) return
                          const response = await fetch(`/api/auction/${auction.id}/undo-bid`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ bidderId: entry.bidderId })
                          })
                          if (!response.ok) {
                            const data = await response.json()
                            toast.error(data.error || 'Failed to undo bid')
                          }
                        } catch {
                          toast.error('Failed to undo bid')
                        }
                      }}
                    />
                  )}
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
                const rules = auction.rules as AuctionRules | undefined
                const minIncrement = rules?.minBidIncrement || 1000
                const totalBid = (currentBid?.amount || 0) + minIncrement
                
                if (totalBid > userBidder.remainingPurse) {
                  alert('Insufficient remaining purse')
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
                      alert(data.error)
                          } else {
                      toast.success('Bid placed successfully!')
                    }
                  }).catch(() => {
                    alert('Network error. Please try again.')
                  }).finally(() => {
                    setIsPlacingBid(false)
                  })
              }}
              className={`rounded-full px-4 py-5 shadow-2xl text-white flex items-center gap-2 ${
                (isPlacingBid || !userBidder || (currentBid?.bidderId === userBidder.id))
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-green-600 hover:bg-green-700'
              }`}
              disabled={isPlacingBid || !userBidder || (currentBid?.bidderId === userBidder.id)}
            >
              <TrendingUp className="h-5 w-5" />
              <span className="font-semibold text-sm">+₹1K</span>
                    </Button>
            
            {/* Custom Bid Button */}
            <Button 
              onClick={() => setCustomBidModalOpen(true)}
              className="rounded-full px-4 py-5 shadow-2xl bg-blue-600 hover:bg-blue-700 text-white"
            >
              <span className="font-semibold text-sm">Custom</span>
            </Button>
                </div>
                
          {/* Custom Bid Modal */}
          <Dialog open={customBidModalOpen} onOpenChange={setCustomBidModalOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogTitle className="text-lg font-semibold text-gray-900 dark:text-gray-100">Custom Bid</DialogTitle>
              <DialogDescription className="sr-only">Place a custom bid amount</DialogDescription>
              <div className="space-y-4">
                
                {/* Remaining Purse */}
                <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded">
                  <div className="text-sm text-gray-700 dark:text-gray-300">Remaining Purse</div>
                  <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                    ₹{userBidder.remainingPurse.toLocaleString('en-IN')}
                    </div>
                  </div>
                
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
                  <Label className="text-sm font-medium">Amount to Add (₹)</Label>
                  <Input
                    type="number"
                    placeholder="Enter amount to add to current bid"
                    value={bidAmount || ''}
                    onChange={(e) => {
                      setBidAmount(Number(e.target.value))
                      setError('')
                    }}
                    className="text-lg font-semibold"
                  />
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
                      if (!userBidder || !bidAmount) return

                      const rules = auction.rules as AuctionRules | undefined
                      const minIncrement = rules?.minBidIncrement || 1000
                      
                      // Calculate total bid = current bid + custom increment (additive)
                      const totalBid = (currentBid?.amount || 0) + bidAmount
                      
                      if (bidAmount < minIncrement) {
                        setError(`Bid increment must be at least ₹${minIncrement.toLocaleString('en-IN')}`)
                        return
                      }

                      if (totalBid > userBidder.remainingPurse) {
                        setError('Insufficient remaining purse')
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
                          setCustomBidModalOpen(false)
                          toast.success('Bid placed successfully!')
                        } else {
                          setError(data.error || 'Failed to place bid')
                        }
                      } catch {
                        setError('Network error. Please try again.')
                      } finally {
                        setIsPlacingBid(false)
                      }
                    }}
                    disabled={isPlacingBid || bidAmount === 0}
                  >
                    {isPlacingBid ? 'Placing...' : 'Place Bid'}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
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
                          <span className="text-xl font-bold text-green-600 dark:text-green-400">
                            ₹{bid.amount.toLocaleString('en-IN')}
                          </span>
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
                
                // Handle regular bids
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

    {/* Sliding Bidding Console (Admin only) */}
    {viewMode === 'admin' && (
      <div className={`${isBidConsoleOpen ? 'fixed' : 'hidden'} inset-0 z-50 ${isBidConsolePinned ? 'pointer-events-none' : ''}`}>
        {/* Backdrop (disabled when pinned to allow page interaction) */}
        {!isBidConsolePinned && (
          <div
            className="absolute inset-0 bg-black/20"
            onClick={() => { if (!isBidConsolePinned) setIsBidConsoleOpen(false) }}
          />
        )}
        {/* Panel */}
        <div className="absolute right-0 top-0 h-full w-full sm:w-2/3 lg:w-[30%] bg-gradient-to-b from-white to-gray-50 dark:from-gray-900 dark:to-gray-950 border-l-4 border-emerald-500 shadow-[-8px_0_24px_rgba(0,0,0,0.3)] flex flex-col pointer-events-auto">
          {/* Header */}
          <div className="p-4 bg-gradient-to-r from-emerald-600 to-teal-600 dark:from-emerald-700 dark:to-teal-700 shadow-lg flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-white" />
              <div className="text-base font-bold text-white">Bidding Console</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                className={`text-white/90 hover:text-white hover:bg-white/20 rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${isBidConsolePinned ? 'bg-white/20' : ''}`}
                onClick={() => setIsBidConsolePinned(p => !p)}
                title={isBidConsolePinned ? 'Unpin console' : 'Pin console'}
              >
                {isBidConsolePinned ? 'Pinned' : 'Pin'}
              </button>
              <button 
                className="text-white/90 hover:text-white hover:bg-white/20 rounded-lg px-3 py-1.5 text-sm font-medium transition-all" 
                onClick={() => setIsBidConsoleOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
          {/* Pinned */}
          {pinnedBidderIds.length > 0 && (
            <div className="p-3 bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-950/30 dark:to-yellow-950/30 border-b-2 border-amber-200 dark:border-amber-800">
              <div className="text-xs font-bold text-amber-800 dark:text-amber-300 mb-2 flex items-center gap-1">
                <span>⚡</span>
                <span>Active Bidders (Last 2)</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {pinnedBidderIds
                  .map(id => bidders.find(b => b.id === id))
                  .filter((b): b is BidderWithUser => Boolean(b))
                  .map(bidder => (
                    <div key={bidder.id} className={`p-2 rounded-lg border shadow-sm hover:shadow-md transition-shadow ${bidder.id === highestBidderId ? 'border-green-500 bg-green-50 dark:bg-green-900/20 shadow-green-200 dark:shadow-green-900/50' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-xs font-semibold truncate text-gray-900 dark:text-gray-100">{bidder.teamName || bidder.username}</div>
                          <div className="text-[10px] text-gray-600 dark:text-gray-400 truncate">{bidder.user?.name || bidder.username}</div>
                          <div className="text-[11px] font-medium text-gray-700 dark:text-gray-300">₹{bidder.remainingPurse.toLocaleString('en-IN')}</div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 w-32">
                          <Button size="sm" className={`h-10 w-full text-xs !px-3 whitespace-nowrap ${bidder.id === highestBidderId || isPlacingBid ? 'bg-gray-400 text-white/90 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 text-white'}`} 
                            disabled={bidder.id === highestBidderId || isPlacingBid}
                            onClick={async (e) => {
                              // Prevent multiple simultaneous bids
                              if (isPlacingBid) return
                              
                              // Instant feedback: disable button imperatively (before React re-render)
                              const btn = e.currentTarget
                              btn.disabled = true
                              btn.style.opacity = '0.5'
                              
                              const rules = auction.rules as AuctionRules | undefined
                              const minInc = rules?.minBidIncrement || 1000
                              const totalBid = (currentBid?.amount || 0) + minInc
                              
                              // Optimistic state updates
                              setIsPlacingBid(true)
                              setPlacingBidFor(bidder.id)
                              const previousPurse = bidder.remainingPurse
                              const previousBid = currentBid
                              const previousHighestBidderId = highestBidderId
                              
                              // Optimistic UI: set new bid immediately
                              setCurrentBid({
                                bidderId: bidder.id,
                                amount: totalBid,
                                bidderName: bidder.user?.name || bidder.username,
                                teamName: bidder.teamName || undefined
                              })
                              setHighestBidderId(bidder.id)
                              
                              // Optimistic activity log entry
                              const optimisticEntry: BidHistoryEntry = {
                                bidderId: bidder.id,
                                amount: totalBid,
                                timestamp: new Date(),
                                bidderName: bidder.user?.name || bidder.username,
                                teamName: bidder.teamName || undefined,
                                type: 'bid'
                              }
                              setFullBidHistory(prev => [optimisticEntry, ...prev])
                              
                              try {
                                const response = await fetch(`/api/auction/${auction.id}/bid`, {
                                  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bidderId: bidder.id, amount: totalBid })
                                })
                                if (!response.ok) { 
                                  const err = await response.json()
                                  toast.error(err.error || 'Failed to place bid')
                                  // Rollback optimistic updates
                                  setCurrentBid(previousBid)
                                  setHighestBidderId(previousHighestBidderId)
                                  setFullBidHistory(prev => prev.filter(entry => entry !== optimisticEntry))
                                  setIsPlacingBid(false)
                                  setPlacingBidFor(null)
                                  btn.disabled = false
                                  btn.style.opacity = '1'
                                } else {
                                  // Success - Pusher event will arrive shortly for reconciliation
                                  // Use startTransition for non-critical state updates
                                  startTransition(() => {
                                    setIsPlacingBid(false)
                                    setPlacingBidFor(null)
                                  })
                                }
                              } catch { 
                                toast.error('Network error')
                                // Rollback optimistic updates
                                setCurrentBid(previousBid)
                                setHighestBidderId(previousHighestBidderId)
                                setFullBidHistory(prev => prev.filter(entry => entry !== optimisticEntry))
                                setIsPlacingBid(false)
                                setPlacingBidFor(null)
                                btn.disabled = false
                                btn.style.opacity = '1'
                              }
                            }}>
                            Raise
                          </Button>
                          <Button size="sm" className="h-10 w-full text-xs !px-3 whitespace-nowrap bg-indigo-600 hover:bg-indigo-700 text-white disabled:bg-gray-400 disabled:text-white/90" 
                            disabled={bidder.id === highestBidderId || isPlacingBid}
                            onClick={() => {
                              if (!isPlacingBid) {
                                setSelectedBidderForBid(bidder.id)
                              }
                            }}>
                            Custom
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
          {/* All bidders */}
          <div className="p-3 flex-1 overflow-y-auto bg-white dark:bg-gray-900">
            <div className="text-xs font-bold text-gray-800 dark:text-gray-200 mb-2 pb-2 border-b border-gray-200 dark:border-gray-700 flex items-center gap-1">
              <span>👥</span>
              <span>All Bidders</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {bidders.slice().sort((a, b) => b.remainingPurse - a.remainingPurse).map(bidder => (
                <div key={bidder.id} className={`p-2 rounded-lg border shadow-sm hover:shadow-md transition-shadow ${bidder.id === highestBidderId ? 'border-green-500 bg-green-50 dark:bg-green-900/20 shadow-green-200 dark:shadow-green-900/50' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold truncate text-gray-900 dark:text-gray-100">{bidder.teamName || bidder.username}</div>
                      <div className="text-[10px] text-gray-600 dark:text-gray-400 truncate">{bidder.user?.name || bidder.username}</div>
                      <div className="text-[11px] font-medium text-gray-700 dark:text-gray-300">₹{bidder.remainingPurse.toLocaleString('en-IN')}</div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 w-32">
                      <Button size="sm" className={`h-10 w-full text-xs !px-3 whitespace-nowrap ${bidder.id === highestBidderId || isPlacingBid ? 'bg-gray-400 text-white/90 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 text-white'}`} 
                        disabled={bidder.id === highestBidderId || isPlacingBid}
                        onClick={async (e) => {
                          if (isPlacingBid) return
                          
                          // Instant feedback: disable button imperatively (before React re-render)
                          const btn = e.currentTarget
                          btn.disabled = true
                          btn.style.opacity = '0.5'
                          
                          const rules = auction.rules as AuctionRules | undefined
                          const minInc = rules?.minBidIncrement || 1000
                          const totalBid = (currentBid?.amount || 0) + minInc
                          
                          // Optimistic state updates
                          setIsPlacingBid(true)
                          setPlacingBidFor(bidder.id)
                          const previousPurse = bidder.remainingPurse
                          const previousBid = currentBid
                          const previousHighestBidderId = highestBidderId
                          
                          // Optimistic UI: set new bid immediately
                          setCurrentBid({
                            bidderId: bidder.id,
                            amount: totalBid,
                            bidderName: bidder.user?.name || bidder.username,
                            teamName: bidder.teamName || undefined
                          })
                          setHighestBidderId(bidder.id)
                          
                          // Optimistic activity log entry
                          const optimisticEntry: BidHistoryEntry = {
                            bidderId: bidder.id,
                            amount: totalBid,
                            timestamp: new Date(),
                            bidderName: bidder.user?.name || bidder.username,
                            teamName: bidder.teamName || undefined,
                            type: 'bid'
                          }
                          setFullBidHistory(prev => [optimisticEntry, ...prev])
                          
                          try {
                            const response = await fetch(`/api/auction/${auction.id}/bid`, {
                              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bidderId: bidder.id, amount: totalBid })
                            })
                            if (!response.ok) { 
                              const err = await response.json()
                              toast.error(err.error || 'Failed to place bid')
                              // Rollback optimistic updates
                              setCurrentBid(previousBid)
                              setHighestBidderId(previousHighestBidderId)
                              setFullBidHistory(prev => prev.filter(entry => entry !== optimisticEntry))
                              setIsPlacingBid(false)
                              setPlacingBidFor(null)
                              btn.disabled = false
                              btn.style.opacity = '1'
                            } else {
                              // Success - Pusher event will arrive shortly for reconciliation
                              // Use startTransition for non-critical state updates
                              startTransition(() => {
                                setIsPlacingBid(false)
                                setPlacingBidFor(null)
                              })
                            }
                          } catch { 
                            toast.error('Network error')
                            // Rollback optimistic updates
                            setCurrentBid(previousBid)
                            setHighestBidderId(previousHighestBidderId)
                            setFullBidHistory(prev => prev.filter(entry => entry !== optimisticEntry))
                            setIsPlacingBid(false)
                            setPlacingBidFor(null)
                            btn.disabled = false
                            btn.style.opacity = '1'
                          }
                        }}>
                        Raise
                      </Button>
                      <Button size="sm" className="h-10 w-full text-xs !px-3 whitespace-nowrap bg-indigo-600 hover:bg-indigo-700 text-white disabled:bg-gray-400 disabled:text-white/90" 
                        disabled={bidder.id === highestBidderId || isPlacingBid}
                        onClick={() => {
                          if (!isPlacingBid) {
                            setSelectedBidderForBid(bidder.id)
                          }
                        }}>
                        Custom
                      </Button>
                    </div>
                  </div>
                  {/* compact inline buttons already added above; remove old vertical button group */}
                </div>
              ))}
            </div>
          </div>
          
          {/* Custom Bid Section - Appears at bottom when a bidder is selected */}
          {selectedBidderForBid && (
            <div className="p-3 border-t-2 border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20">
              <div className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-2">
                Custom Bid: {(() => {
                  const bidder = bidders.find(b => b.id === selectedBidderForBid)
                  return bidder ? `${bidder.teamName || bidder.username}` : ''
                })()}
              </div>
              
              {/* Quick increment buttons */}
              <div className="grid grid-cols-4 gap-1 mb-2">
                {[1000, 2000, 3000, 5000].map((amount) => (
                  <Button
                    key={amount}
                    size="sm"
                    className="h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white disabled:bg-gray-400 disabled:text-white/90"
                    disabled={isPlacingBid}
                    onClick={async (e) => {
                      // Prevent multiple simultaneous bids
                      if (isPlacingBid) return
                      
                      // Instant feedback: disable button imperatively
                      const btn = e.currentTarget
                      btn.disabled = true
                      btn.style.opacity = '0.5'
                      
                      const totalBid = (currentBid?.amount || 0) + amount
                      const bidder = bidders.find(b => b.id === selectedBidderForBid)
                      
                      // Optimistic state updates
                      setIsPlacingBid(true)
                      setPlacingBidFor(selectedBidderForBid!)
                      const previousPurse = bidder?.remainingPurse || 0
                      const previousBid = currentBid
                      const previousHighestBidderId = highestBidderId
                      
                      // Optimistic UI: set new bid immediately
                      setCurrentBid({
                        bidderId: selectedBidderForBid!,
                        amount: totalBid,
                        bidderName: bidder?.user?.name || bidder?.username || '',
                        teamName: bidder?.teamName || undefined
                      })
                      setHighestBidderId(selectedBidderForBid!)
                      
                      // Optimistic activity log entry
                      const optimisticEntry: BidHistoryEntry = {
                        bidderId: selectedBidderForBid!,
                        amount: totalBid,
                        timestamp: new Date(),
                        bidderName: bidder?.user?.name || bidder?.username || '',
                        teamName: bidder?.teamName || undefined,
                        type: 'bid'
                      }
                      setFullBidHistory(prev => [optimisticEntry, ...prev])
                      
                      try {
                        const response = await fetch(`/api/auction/${auction.id}/bid`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ bidderId: selectedBidderForBid, amount: totalBid })
                        })
                        if (!response.ok) {
                          const error = await response.json()
                          toast.error(error.error || 'Failed to place bid')
                          // Rollback optimistic updates
                          setCurrentBid(previousBid)
                          setHighestBidderId(previousHighestBidderId)
                          setFullBidHistory(prev => prev.filter(entry => entry !== optimisticEntry))
                          setIsPlacingBid(false)
                          setPlacingBidFor(null)
                          btn.disabled = false
                          btn.style.opacity = '1'
                        } else {
                          // Success - clear form and use startTransition for cleanup
                          setSelectedBidderForBid(null)
                          setCustomBidAmount('')
                          
                          startTransition(() => {
                            setIsPlacingBid(false)
                            setPlacingBidFor(null)
                          })
                        }
                      } catch {
                        toast.error('Network error')
                        // Rollback optimistic updates
                        setCurrentBid(previousBid)
                        setHighestBidderId(previousHighestBidderId)
                        setFullBidHistory(prev => prev.filter(entry => entry !== optimisticEntry))
                        setIsPlacingBid(false)
                        setPlacingBidFor(null)
                        btn.disabled = false
                        btn.style.opacity = '1'
                      }
                    }}
                  >
                    +₹{(amount/1000).toFixed(0)}k
                  </Button>
                ))}
              </div>
              
              {/* Custom amount input */}
              <div className="flex gap-2">
                <Input
                  type="number"
                  placeholder="Custom (₹1000s)"
                  value={customBidAmount}
                  onChange={(e) => setCustomBidAmount(e.target.value)}
                  min="1000"
                  step="1000"
                  className="flex-1 h-8 text-xs bg-white dark:bg-gray-800"
                />
                <Button
                  size="sm"
                  className="h-8 text-xs px-3 bg-green-600 hover:bg-green-700 text-white disabled:bg-gray-400 disabled:text-white/90"
                  disabled={isPlacingBid}
                  onClick={async () => {
                    // Prevent multiple simultaneous bids
                    if (isPlacingBid) return
                    
                    if (!customBidAmount) return
                    const incrementAmount = parseFloat(customBidAmount)
                    if (isNaN(incrementAmount) || incrementAmount <= 0) {
                      toast.error('Invalid amount')
                      return
                    }
                    
                    // Validate bid is a multiple of 1000
                    if (incrementAmount % 1000 !== 0) {
                      toast.error('Bid amount must be in multiples of ₹1,000')
                      return
                    }
                    
                    const totalBid = (currentBid?.amount || 0) + incrementAmount
                    const bidder = bidders.find(b => b.id === selectedBidderForBid)
                    
                    // Disable all buttons globally
                    setIsPlacingBid(true)
                    setPlacingBidFor(selectedBidderForBid)
                    
                    // Optimistically update purse only (not highestBidderId - wait for Pusher)
                    const previousPurse = bidder?.remainingPurse || 0
                    if (bidder) {
                      setBidders(prev => prev.map(b => 
                        b.id === selectedBidderForBid 
                          ? { ...b, remainingPurse: b.remainingPurse - incrementAmount }
                          : b
                      ))
                    }
                    
                    try {
                      const response = await fetch(`/api/auction/${auction.id}/bid`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ bidderId: selectedBidderForBid, amount: totalBid })
                      })
                      if (!response.ok) {
                        const error = await response.json()
                        toast.error(error.error || 'Failed to place bid')
                        // Revert optimistic purse update on error
                        if (bidder) {
                          setBidders(prev => prev.map(b => 
                            b.id === selectedBidderForBid 
                              ? { ...b, remainingPurse: previousPurse }
                              : b
                          ))
                        }
                        setIsPlacingBid(false)
                        setPlacingBidFor(null)
                      } else {
                        // Re-enable buttons immediately after successful API response
                        const data = await response.json()
                        setIsPlacingBid(false)
                        setPlacingBidFor(null)
                        
                        // Optimistically update state from API response
                        setCurrentBid({
                          bidderId: selectedBidderForBid,
                          amount: totalBid,
                          bidderName: bidder?.user?.name || bidder?.username || '',
                          teamName: bidder?.teamName || undefined
                        })
                        setHighestBidderId(selectedBidderForBid)
                        
                        // Use API response purse if available
                        if (data.remainingPurse !== undefined && bidder) {
                          setBidders(prev => prev.map(b => 
                            b.id === selectedBidderForBid 
                              ? { ...b, remainingPurse: data.remainingPurse }
                              : b
                          ))
                        }
                        
                        // Clear selected bidder after successful bid
                        setSelectedBidderForBid(null)
                        setCustomBidAmount('')
                      }
                      // Pusher event will still arrive and correct any state, but we don't block on it
                    } catch {
                      toast.error('Network error')
                      // Revert on network error
                      if (bidder) {
                        setBidders(prev => prev.map(b => 
                          b.id === selectedBidderForBid 
                            ? { ...b, remainingPurse: previousPurse }
                            : b
                        ))
                      }
                      setIsPlacingBid(false)
                      setPlacingBidFor(null)
                    }
                  }}
                >
                  Bid
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs px-2"
                  onClick={() => {
                    setSelectedBidderForBid(null)
                    setCustomBidAmount('')
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    )}

    {/* Public Chat */}
    <PublicChat auctionId={auction.id} rightOffsetClass={isBidConsoleOpen ? 'lg:right-[calc(30%+24px)]' : 'lg:right-20'} />
    </>
  )
}

