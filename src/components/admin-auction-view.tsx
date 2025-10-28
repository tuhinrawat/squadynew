'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Auction, Player, Bidder } from '@prisma/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Clock, Play, Pause, SkipForward, Square, Undo2, TrendingUp, ChevronDown, ChevronUp, Share2 } from 'lucide-react'
import { usePusher } from '@/lib/pusher-client'
import { motion, AnimatePresence } from 'framer-motion'
import { TeamsOverview } from '@/components/teams-overview'
import { PlayersSoldTable } from '@/components/players-sold-table'
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
  const [error, setError] = useState('')
  const [bidders, setBidders] = useState(auction.bidders)

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
    return filteredBids.slice().reverse()
  }, [currentPlayer?.id, fullBidHistory])

  // Filter bid history for current player whenever player changes
  useEffect(() => {
    if (currentPlayer?.id) {
      setBidHistory(playerBidHistory)
      
      // Get the most recent bid (last item after filtering, since it's the newest)
      const latestBid = playerBidHistory.length > 0 ? playerBidHistory[playerBidHistory.length - 1] : null
      
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
      setCurrentBid({
        bidderId: data.bidderId,
        amount: data.amount,
        bidderName: data.bidderName,
        teamName: data.teamName
      })
      setHighestBidderId(data.bidderId)
      // Add new bid to full history
      const newBidEntry = {
        type: 'bid' as const,
        bidderId: data.bidderId,
        amount: data.amount,
        timestamp: new Date(),
        bidderName: data.bidderName,
      teamName: data.teamName,
      playerId: currentPlayer?.id // Associate bid with current player
      }
      setFullBidHistory(prev => [newBidEntry, ...prev])
      // Also add to current player's filtered history
      setBidHistory(prev => [newBidEntry, ...prev])
    // Refresh bidders to update remaining purse
    refreshPlayersList()
  }, [currentPlayer?.id, refreshPlayersList])

  const handleBidUndo = useCallback((data: PusherBidUndoData) => {
      // Remove last bid from history
      setBidHistory(prev => prev.slice(1))
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
    // Refresh bidders to update remaining purse
    refreshPlayersList()
  }, [auction.rules, refreshPlayersList])

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
    
    // Refresh bidders and players to update remaining purse and player status
    refreshPlayersList()
    // Also refresh auction state to get updated bid history
    refreshAuctionState()
  }, [refreshPlayersList, refreshAuctionState, currentPlayer])

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
      // Refresh full bid history from server when new player loads
      refreshAuctionState()
  }, [refreshAuctionState])

  const handleAuctionPaused = useCallback(() => setIsPaused(true), [])
  const handleAuctionResumed = useCallback(() => setIsPaused(false), [])
  const handlePlayersUpdated = useCallback(() => {
      refreshPlayersList()
  }, [refreshPlayersList])
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

    const response = await fetch(`/api/auction/${auction.id}/mark-sold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: currentPlayer.id })
    })

    if (response.ok) {
      const data = await response.json()
      setSoldAnimation(true)
      setTimeout(() => {
        setCurrentPlayer(data.nextPlayer)
        setCurrentBid(null)
        setBidHistory([])
        setHighestBidderId(null)
        setSoldAnimation(false)
      }, 3000)
    }
  }

  const handleMarkUnsold = async () => {
    if (!currentPlayer) return

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

  return (
    <div className="p-4 sm:p-6">
      <div className="max-w-7xl mx-auto space-y-4">
        {/* Enhanced Header */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          {/* Top Section */}
          <div className="px-6 py-4">
            <div className="flex items-center justify-between gap-4">
              {/* Left: Title and Status */}
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100">{auction.name}</h1>
                  <Badge className={`px-4 py-1.5 text-sm font-semibold rounded-full ${
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
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{auction.description}</p>
                )}
          </div>
              
              {/* Right: Share and Admin Controls */}
              <div className="flex items-center gap-3">
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
                  className="bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  <Share2 className="h-4 w-4 mr-2" />
                  <span className="hidden sm:inline">Share</span>
            </Button>
                
                {viewMode === 'admin' && (
                  <div className="flex gap-2">
                    <Button onClick={handleStartAuction} disabled={auction.status === 'LIVE'} size="sm" className="text-sm px-3 disabled:opacity-50">
                      <Play className="h-4 w-4 mr-2" />
                      <span className="hidden sm:inline">Start</span>
            </Button>
                    <Button onClick={handlePauseResume} variant="outline" disabled={auction.status !== 'LIVE'} size="sm" className="text-sm px-3 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800">
                      {isPaused ? <Play className="h-4 w-4 mr-2" /> : <Pause className="h-4 w-4 mr-2" />}
                      <span className="hidden sm:inline">{isPaused ? 'Resume' : 'Pause'}</span>
            </Button>
                    <Button onClick={handleNextPlayer} variant="outline" disabled={auction.status !== 'LIVE'} size="sm" className="text-sm px-3 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800">
                      <SkipForward className="h-4 w-4 mr-2" />
                      <span className="hidden sm:inline">Next</span>
                    </Button>
                    <Button onClick={handleEndAuction} variant="destructive" disabled={auction.status !== 'LIVE'} size="sm" className="text-sm px-3">
                      <Square className="h-4 w-4 mr-2" />
                      <span className="hidden sm:inline">End</span>
            </Button>
                  </div>
                )}
              </div>
          </div>
        </div>

          {/* Progress Bar Section */}
          <div className="px-6 py-4 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border-t border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="font-medium text-gray-700 dark:text-gray-300">Progress</span>
                  <span className="font-bold text-blue-600 dark:text-blue-400">
                    {((initialStats.sold + initialStats.unsold) / initialStats.total * 100).toFixed(0)}% Complete
                  </span>
            </div>
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-green-500 to-emerald-500 rounded-full transition-all duration-500"
                    style={{ width: `${((initialStats.sold + initialStats.unsold) / initialStats.total * 100)}%` }}
                  />
            </div>
            </div>
            </div>
          </div>
        </div>

        {/* Enhanced Stats Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-4 hover:shadow-lg transition-shadow">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                  <span className="text-2xl">📊</span>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">Total</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{initialStats.total}</p>
                </div>
              </div>
            </div>
          </div>
          
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-4 hover:shadow-lg transition-shadow">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
                  <span className="text-2xl">✅</span>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">Sold</p>
                  <p className="text-2xl font-bold text-green-600">{initialStats.sold}</p>
                </div>
              </div>
            </div>
          </div>
          
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-4 hover:shadow-lg transition-shadow">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
                  <span className="text-2xl">⏸️</span>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">Unsold</p>
                  <p className="text-2xl font-bold text-yellow-600">{initialStats.unsold}</p>
                </div>
              </div>
            </div>
          </div>
          
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-4 hover:shadow-lg transition-shadow">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                  <span className="text-2xl">⏳</span>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">Remaining</p>
                  <p className="text-2xl font-bold text-purple-600">{initialStats.remaining}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

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
              
              <CardHeader>
                <div className="flex flex-col items-center gap-3">
                  {(() => {
                    const profilePhotoLink = playerData['Profile Photo'] || playerData['profile photo'] || playerData['Profile photo']
                    if (!profilePhotoLink) return null
                    
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
                {/* Spotlight Section - Current Bid */}
                <div className="border-t-4 border-blue-200 dark:border-blue-900 pt-6 mt-6">
                  <div className="text-center space-y-3">
                    <div className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                      Current Bid
                    </div>
                  {currentBid ? (
                      <div className="space-y-2">
                        <div className="text-5xl sm:text-6xl lg:text-7xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">
                          ₹{currentBid.amount.toLocaleString('en-IN')}
                        </div>
                        <div className="text-lg sm:text-xl font-semibold text-gray-700 dark:text-gray-300">
                          {currentBid.bidderName}
                          {currentBid.teamName && (
                            <span className="text-blue-600 font-bold"> ({currentBid.teamName})</span>
                          )}
                        </div>
                    </div>
                  ) : (
                      <div className="py-8 text-xl font-semibold text-gray-400 dark:text-gray-500">
                        No bids yet
                      </div>
                  )}
                </div>
                </div>
                
                {/* Timer Section */}
                <div className="border-t-4 border-orange-200 dark:border-orange-900 pt-6 mt-6">
                  <div className="text-center space-y-3">
                    <div className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                      Time Remaining
                    </div>
                    <div className="flex items-center justify-center gap-4">
                      <Clock className={`h-12 w-12 sm:h-16 sm:w-16 ${timer <= 5 ? 'text-red-500 animate-pulse' : 'text-blue-500'}`} />
                      <div className={`text-6xl sm:text-7xl lg:text-8xl font-black ${timer <= 5 ? 'text-red-500 animate-pulse' : 'text-gray-900 dark:text-gray-100'}`}>
                        {timer}s
                      </div>
                    </div>
                    {timer <= 5 && (
                      <div className="text-xs font-semibold text-red-500 animate-pulse uppercase tracking-wider">
                        ⚠️ Final Moments
                  </div>
                    )}
                  </div>
                </div>
                
                {/* Admin Controls */}
                {viewMode === 'admin' && (
                  <div className="mt-6 space-y-3">
                  {currentBid && (
                    <div className="bg-green-50 dark:bg-green-900/10 p-2 rounded border border-green-200 dark:border-green-800">
                      <div className="text-xs font-semibold text-green-700 dark:text-green-300 mb-2">⚡ Finalize This Sale:</div>
                      <div className="flex gap-2">
                        <Button 
                          variant="default"
                          size="sm" 
                          className="text-xs sm:text-sm bg-green-600 hover:bg-green-700 text-white"
                          onClick={handleMarkSold}
                        >
                          <TrendingUp className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                          <span className="hidden sm:inline">Mark Sold</span>
                          <span className="sm:hidden">Sold</span>
                        </Button>
                      </div>
                    </div>
                  )}
                  <div className="flex gap-2 flex-wrap">
                    <Button 
                      variant="outline"
                      size="sm" 
                      className="text-xs sm:text-sm bg-orange-50 text-orange-700 hover:bg-orange-100 dark:bg-orange-900/20 dark:text-orange-300 dark:hover:bg-orange-900/30 border-orange-200 dark:border-orange-800"
                      onClick={handleMarkUnsold}
                    >
                      <SkipForward className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                      <span className="hidden sm:inline">Mark Unsold</span>
                      <span className="sm:hidden">Unsold</span>
                    </Button>
                    <AlertDialog open={undoSaleDialogOpen} onOpenChange={setUndoSaleDialogOpen}>
                      <Button 
                        variant="destructive" 
                        size="sm" 
                        className="text-xs sm:text-sm"
                        onClick={() => setUndoSaleDialogOpen(true)}
                      >
                        <Undo2 className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                        <span className="hidden sm:inline">Undo Last Sale</span>
                        <span className="sm:hidden">Undo</span>
                      </Button>
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
                </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Bid History Sidebar */}
          <div className="order-2 lg:order-1 hidden lg:block space-y-4">
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
                    <Label className="text-xs font-medium text-gray-700 dark:text-gray-300">Custom Bid Amount:</Label>
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        placeholder="Enter custom bid amount"
                        value={bidAmount}
                        onChange={(e) => {
                          setBidAmount(Number(e.target.value))
                          setError('')
                        }}
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
            <Card className="shadow-lg border-2 border-blue-100 dark:border-blue-900">
              <CardHeader className="p-4 sm:p-6 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20">
                <CardTitle className="text-base sm:text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                  <span>📋</span> Live Bidding Activity
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 sm:p-6">
                <div className="space-y-3 max-h-[200px] sm:max-h-[300px] lg:max-h-[500px] overflow-y-auto pr-2">
                  {bidHistory.map((bid, index) => {
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
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="rounded-lg border-2 border-green-500 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 p-3 shadow-md"
                        >
                          <div className="font-bold text-base text-green-800 dark:text-green-300 mb-2">
                            ✅ SOLD!
                          </div>
                          <div className="text-sm text-green-700 dark:text-green-400 mb-1">
                            To: <span className="font-semibold">{bid.bidderName}</span> {bid.teamName && `(${bid.teamName})`}
                          </div>
                          <div className="text-xl font-black text-green-600 dark:text-green-400 mb-1">
                            ₹{bid.amount.toLocaleString('en-IN')}
                          </div>
                          <div className="text-xs text-green-600 dark:text-green-500">
                            {timeAgo}
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
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="rounded-lg border-2 border-orange-500 bg-gradient-to-br from-orange-50 to-amber-50 dark:from-orange-900/20 dark:to-amber-900/20 p-3 shadow-md"
                        >
                          <div className="font-bold text-base text-orange-800 dark:text-orange-300 mb-2">
                            ⏭️ UNSOLD
                          </div>
                          <div className="text-sm text-orange-700 dark:text-orange-400">
                            No buyer • Moving to next player
                          </div>
                          <div className="text-xs text-orange-600 dark:text-orange-500 mt-2">
                            {timeAgo}
                          </div>
                        </motion.div>
                      )
                    }
                    
                    // Handle regular bids
                    const bidTime = new Date(bid.timestamp)
                    
                    let timeAgo = ''
                    if (isClient) {
                      const now = new Date()
                      const timeDiff = Math.floor((now.getTime() - bidTime.getTime()) / 1000) // seconds ago
                      
                      if (timeDiff < 60) {
                        timeAgo = `${timeDiff} second${timeDiff !== 1 ? 's' : ''} ago`
                      } else if (timeDiff < 3600) {
                        const minutes = Math.floor(timeDiff / 60)
                        timeAgo = `${minutes} minute${minutes !== 1 ? 's' : ''} ago`
                      } else {
                        timeAgo = bidTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      }
                    } else {
                      // Render static time during SSR
                      timeAgo = bidTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    }
                    
                    const isLatestBid = index === bidHistory.length - 1
                    const increment = isLatestBid
                      ? bid.amount 
                      : bid.amount - bidHistory[index + 1]?.amount || 0
                    
                    const commentary = isLatestBid
                      ? "🎯 Current Top Bid!"
                      : increment > 50000 
                        ? "🚀 Big Jump!"
                        : "💪 Standard Bid"
                    
                    return (
                      <motion.div
                        key={index}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className={`rounded-lg p-3 shadow-md transition-all ${
                          isLatestBid
                            ? 'border-2 border-blue-500 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20'
                            : 'border border-blue-200 dark:border-blue-800 bg-white dark:bg-gray-800'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <span className="font-bold text-base text-gray-900 dark:text-gray-100">{bid.bidderName}</span>
                          {bid.teamName && (
                              <Badge variant="outline" className="text-xs">{bid.teamName}</Badge>
                          )}
                        </div>
                          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">{timeAgo}</span>
                        </div>
                        <div className="flex items-baseline justify-between">
                          <div className="text-xl font-black text-blue-600 dark:text-blue-400">
                            ₹{bid.amount.toLocaleString('en-IN')}
                        </div>
                          <Badge className={`text-xs ${
                            isLatestBid
                              ? 'bg-green-500 text-white'
                              : increment > 50000
                              ? 'bg-purple-500 text-white'
                              : 'bg-gray-500 text-white'
                          }`}>
                            {commentary}
                          </Badge>
                      </div>
                        {!isLatestBid && increment > 0 && (
                          <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                            +₹{increment.toLocaleString('en-IN')}
                          </div>
                        )}
                      </motion.div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Quick Bid Banner - Global - Only for admin */}
        {viewMode === 'admin' && selectedBidderForBid && (
          <Card className="mb-4 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700">
            <CardContent className="p-4">
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
                Selected Bidder: <span className="text-blue-700 dark:text-blue-300">{(() => {
                  const bidder = auction.bidders.find(b => b.id === selectedBidderForBid)
                  return bidder ? `${bidder.teamName || bidder.username} (${bidder.user?.name || 'Admin'})` : ''
                })()}</span>
              </div>
              <div className="space-y-3">
                {/* Quick Bid Options */}
                <div className="flex flex-wrap gap-2">
                  {[1000, 2000, 3000, 4000].map((amount) => (
                    <Button
                      key={amount}
                      size="sm"
                      className="bg-blue-600 hover:bg-blue-700 text-white"
                      onClick={async () => {
                        if (!selectedBidderForBid) return
                        try {
                          // Calculate total bid = current bid + increment
                          const totalBid = (currentBid?.amount || 0) + amount
                          // Admin placing bid
                          const response = await fetch(`/api/auction/${auction.id}/bid`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ bidderId: selectedBidderForBid, amount: totalBid })
                          })
                          if (response.ok) {
                            setSelectedBidderForBid(null)
                            setCustomBidAmount('')
                          } else {
                            const error = await response.json()
                            alert(error.error || 'Failed to place bid')
                          }
                        } catch (error) {
                          console.error('Error placing bid:', error)
                          alert('Failed to place bid')
                        }
                      }}
                    >
                      ₹{amount.toLocaleString('en-IN')}
                    </Button>
                  ))}
                </div>
                
                {/* Custom Bid Input */}
                <div className="flex gap-2">
                  <Input
                    type="number"
                    placeholder="Enter custom bid amount"
                    value={customBidAmount}
                    onChange={(e) => setCustomBidAmount(e.target.value)}
                    className="flex-1 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  />
                  <Button
                    size="sm"
                    className="bg-green-600 hover:bg-green-700 text-white"
                    onClick={async () => {
                      if (!selectedBidderForBid || !customBidAmount) return
                      const incrementAmount = parseFloat(customBidAmount)
                      if (isNaN(incrementAmount) || incrementAmount <= 0) {
                        alert('Please enter a valid bid amount')
                        return
                      }
                      // Add custom bid amount to current bid (cumulative)
                      const amount = (currentBid?.amount || 0) + incrementAmount
                      try {
                        const response = await fetch(`/api/auction/${auction.id}/bid`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ bidderId: selectedBidderForBid, amount })
                        })
                        if (response.ok) {
                          setSelectedBidderForBid(null)
                          setCustomBidAmount('')
                        } else {
                          const error = await response.json()
                          alert(error.error || 'Failed to place bid')
                        }
                      } catch (error) {
                        console.error('Error placing bid:', error)
                        alert('Failed to place bid')
                      }
                    }}
                  >
                    Place Bid
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Bidders Grid - Only for admin */}
        {viewMode === 'admin' && (
        <Card>
          <CardHeader className="p-3 sm:p-6">
            <CardTitle className="text-sm sm:text-base text-gray-900 dark:text-gray-100">Bidders - Admin Bid Control</CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-4">
              {auction.bidders.map((bidder) => (
                <motion.div
                  key={bidder.id}
                  animate={bidder.id === highestBidderId ? { scale: 1.05 } : { scale: 1 }}
                  className={`p-2 sm:p-4 rounded-lg border-2 ${
                    bidder.id === highestBidderId ? 'border-green-500 bg-green-50 dark:bg-green-900/20' : 'border-gray-200 dark:border-gray-700'
                  }`}
                >
                  <div className="flex items-center gap-2 sm:gap-3">
                    {bidder.logoUrl && (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={bidder.logoUrl || ''} alt={bidder.teamName || ''} className="w-8 h-8 sm:w-12 sm:h-12 rounded flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-xs sm:text-sm text-gray-900 dark:text-gray-100 truncate">{bidder.teamName || bidder.username}</div>
                      <div className="text-xs text-gray-600 dark:text-gray-400 truncate">{bidder.user?.name || bidder.username}</div>
                      <div className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300">
                        ₹{bidder.remainingPurse.toLocaleString('en-IN')} remaining
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-2">
                  <Button
                    size="sm"
                      className="flex-1 text-xs sm:text-sm bg-green-600 hover:bg-green-700 text-white"
                      onClick={async () => {
                        if (bidder.id === highestBidderId) {
                          alert('This bidder already has the highest bid')
                          return
                        }
                        try {
                          // Calculate total bid = current bid + 1000
                          const totalBid = (currentBid?.amount || 0) + 1000
                          const response = await fetch(`/api/auction/${auction.id}/bid`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ bidderId: bidder.id, amount: totalBid })
                          })
                          if (!response.ok) {
                            const error = await response.json()
                            alert(error.error || 'Failed to place bid')
                          }
                        } catch (error) {
                          console.error('Error placing bid:', error)
                          alert('Failed to place bid')
                        }
                      }}
                      disabled={bidder.id === highestBidderId}
                    >
                      Raise Bid (+1K)
                    </Button>
                    <Button
                      size="sm"
                      className="flex-1 text-xs sm:text-sm bg-blue-600 hover:bg-blue-700 text-white"
                    onClick={() => {
                      setSelectedBidderForBid(bidder.id)
                    }}
                    disabled={bidder.id === highestBidderId}
                  >
                      {bidder.id === highestBidderId ? 'Highest' : 'Custom'}
                  </Button>
                  </div>
                </motion.div>
              ))}
            </div>
          </CardContent>
        </Card>
        )}

        {/* Teams Overview */}
        <TeamsOverview 
          auction={{
            ...auction,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            players: players as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            bidders: bidders as any
          }}
        />

        {/* Players Sold Table */}
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <PlayersSoldTable auction={{ ...auction, players: players as any, bidders: bidders as any, bidHistory: fullBidHistory }} />
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
                
                const isLatestBid = index === bidHistory.length - 1
                const increment = isLatestBid
                  ? bid.amount 
                  : bid.amount - bidHistory[index + 1]?.amount || 0
                
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
                    <div className="flex items-center gap-2 mb-1">
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
  )
}

