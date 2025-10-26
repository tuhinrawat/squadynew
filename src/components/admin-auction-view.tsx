'use client'

import { useState, useEffect, useCallback } from 'react'
import { Auction, Player, Bidder, PlayerStatus, AuctionStatus } from '@prisma/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Clock, Play, Pause, SkipForward, Square, Undo2, TrendingUp, ChevronDown, ChevronUp } from 'lucide-react'
import Image from 'next/image'
import { usePusher } from '@/lib/pusher-client'
import { motion, AnimatePresence } from 'framer-motion'
import { formatCurrency } from '@/lib/currency'
import { TeamsOverview } from '@/components/teams-overview'
import { PlayersSoldTable } from '@/components/players-sold-table'
import { toast } from 'sonner'

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

interface AdminAuctionViewProps {
  auction: Auction & {
    players: Player[]
    bidders: (Bidder & {
      user: {
        id: string
        name: string
        email: string
      }
    })[]
  }
  currentPlayer: Player | null
  stats: {
    total: number
    sold: number
    unsold: number
    remaining: number
  }
  bidHistory: BidHistoryEntry[]
}

export function AdminAuctionView({ auction, currentPlayer: initialPlayer, stats: initialStats, bidHistory: initialHistory }: AdminAuctionViewProps) {
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
  const [players, setPlayers] = useState(auction.players)

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
    } catch (error) {
      console.error('Failed to refresh players list:', error)
    }
  }, [auction.id])

  // Helper function to get player-specific bid history
  const getPlayerBidHistory = (playerId: string | null, fullHistory: BidHistoryEntry[]) => {
    if (!playerId) return []
    
    // Find the last sale/unsold event (for any player)
    let lastSaleEventIndex = -1
    for (let i = fullHistory.length - 1; i >= 0; i--) {
      const entry = fullHistory[i]
      if (entry.type === 'sold' || entry.type === 'unsold') {
        lastSaleEventIndex = i
        break
      }
    }
    
    // If no sale event found, return all bids (first player being auctioned)
    if (lastSaleEventIndex === -1) {
      return fullHistory.slice().reverse()
    }
    
    // Return all bids after the last sale event (current player being auctioned)
    const recentBids = fullHistory.slice(lastSaleEventIndex + 1)
    return recentBids.reverse()
  }

  // Set client-side rendered flag
  useEffect(() => {
    setIsClient(true)
  }, [])

  // Filter bid history for current player whenever player changes
  useEffect(() => {
    console.log('AdminAuctionView: useEffect triggered, currentPlayer:', currentPlayer?.id, 'fullBidHistory length:', fullBidHistory.length)
    if (currentPlayer?.id) {
      const playerBidHistory = getPlayerBidHistory(currentPlayer.id, fullBidHistory)
      console.log('AdminAuctionView: Filtered playerBidHistory:', playerBidHistory)
      setBidHistory(playerBidHistory)
      
      // Get the most recent bid (first item in the reversed array)
      const latestBid = playerBidHistory[0]
      console.log('AdminAuctionView: latestBid:', latestBid, 'current bid state:', currentBid)
      
      // Only update if we have a bid and it's different from current
      if (latestBid && !latestBid.type) {
        console.log('AdminAuctionView: Setting current bid to latest bid')
        setCurrentBid({
          bidderId: latestBid.bidderId,
          amount: latestBid.amount,
          bidderName: latestBid.bidderName,
          teamName: latestBid.teamName
        })
        setHighestBidderId(latestBid.bidderId)
      }
    } else {
      setBidHistory([])
      setCurrentBid(null)
      setHighestBidderId(null)
    }
  }, [currentPlayer?.id, fullBidHistory])

  // Reset image loading when player changes (but not on initial load)
  useEffect(() => {
    if (currentPlayer?.id && initialPlayer?.id && currentPlayer.id !== initialPlayer.id) {
      setIsImageLoading(true)
    }
  }, [currentPlayer?.id, initialPlayer?.id])

  // Memoize callbacks to prevent re-subscription
  const handleNewBid = useCallback((data: any) => {
    console.log('AdminAuctionView: handleNewBid called', data)
    setCurrentBid({
      bidderId: data.bidderId,
      amount: data.amount,
      bidderName: data.bidderName,
      teamName: data.teamName
    })
    setHighestBidderId(data.bidderId)
    setTimer(data.countdownSeconds || 30)
    // Add new bid to full history
    const newBidEntry = {
      type: 'bid' as const,
      bidderId: data.bidderId,
      amount: data.amount,
      timestamp: new Date(),
      bidderName: data.bidderName,
      teamName: data.teamName
    }
    setFullBidHistory(prev => [newBidEntry, ...prev])
    // Also add to current player's filtered history
    setBidHistory(prev => [newBidEntry, ...prev])
  }, [])

  const handleBidUndo = useCallback((data: any) => {
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
    const rules = auction.rules as any
    setTimer(rules?.countdownSeconds || 30)
  }, [auction.rules])

  const handleSaleUndo = useCallback(() => {
    // Reload to get updated state
    window.location.reload()
  }, [])

  const handleTimerUpdate = useCallback((data: any) => {
    if (!isPaused) {
      setTimer(data.seconds)
    }
  }, [isPaused])

  const handlePlayerSold = useCallback(() => {
    setSoldAnimation(true)
    setTimeout(() => {
      setSoldAnimation(false)
      // Don't auto-advance - let admin control it manually
    }, 3000)
  }, [])

  const handleNewPlayer = useCallback((data: any) => {
    console.log('AdminAuctionView: New player loaded', data.player)
    setIsImageLoading(true)
    setCurrentPlayer(data.player)
    setTimer(30)
    setBidHistory([]) // Clear bid history for new player
    setCurrentBid(null) // Clear current bid
    setHighestBidderId(null) // Clear highest bidder
    setSelectedBidderForBid(null) // Clear selected bidder
    setCustomBidAmount('') // Clear custom bid amount
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
    return player.data as Record<string, any>
  }

  const playerData = getPlayerData(currentPlayer)
  const playerName = playerData.name || playerData.Name || 'No Player Selected'

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 p-2 sm:p-4">
      <div className="max-w-7xl mx-auto space-y-2 sm:space-y-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center bg-white dark:bg-gray-800 rounded-lg p-3 sm:p-4 shadow gap-3 sm:gap-0">
          <div>
            <h1 className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-gray-100">{auction.name}</h1>
            <div className="flex gap-2 mt-2">
              <Badge className={auction.status === 'LIVE' ? 'bg-green-500 text-white' : 'bg-gray-500 text-white'}>
                {auction.status}
              </Badge>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleStartAuction} disabled={auction.status === 'LIVE'} size="sm" className="text-xs sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed">
              <Play className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              <span className="hidden sm:inline">Start Auction</span>
              <span className="sm:hidden">Start</span>
            </Button>
            <Button onClick={handlePauseResume} variant="outline" disabled={auction.status !== 'LIVE'} size="sm" className="text-xs sm:text-sm text-gray-900 bg-white border-gray-300 hover:bg-gray-50 dark:text-gray-100 dark:bg-gray-800 dark:border-gray-600 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed disabled:text-gray-500 dark:disabled:text-gray-600 disabled:bg-gray-100 dark:disabled:bg-gray-800">
              {isPaused ? <Play className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" /> : <Pause className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />}
              {isPaused ? <span className="hidden sm:inline">Resume</span> : <span className="hidden sm:inline">Pause</span>}
              <span className="sm:hidden">{isPaused ? 'Resume' : 'Pause'}</span>
            </Button>
            <Button onClick={handleNextPlayer} variant="outline" disabled={auction.status !== 'LIVE'} size="sm" className="text-xs sm:text-sm text-gray-900 bg-white border-gray-300 hover:bg-gray-50 dark:text-gray-100 dark:bg-gray-800 dark:border-gray-600 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed disabled:text-gray-500 dark:disabled:text-gray-600 disabled:bg-gray-100 dark:disabled:bg-gray-800">
              <SkipForward className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              <span className="hidden sm:inline">Next Player</span>
              <span className="sm:hidden">Next</span>
            </Button>
            <Button onClick={handleEndAuction} variant="destructive" disabled={auction.status !== 'LIVE'} size="sm" className="text-xs sm:text-sm">
              <Square className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              <span className="hidden sm:inline">End Auction</span>
              <span className="sm:hidden">End</span>
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-3 sm:p-4 shadow border border-gray-200 dark:border-gray-700">
          <div className="flex flex-wrap gap-4 sm:gap-6">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Total Players:</span>
              <span className="text-lg font-bold text-gray-900 dark:text-gray-100">{initialStats.total}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Sold:</span>
              <span className="text-lg font-bold text-green-600">{initialStats.sold}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Unsold:</span>
              <span className="text-lg font-bold text-yellow-600">{initialStats.unsold}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Remaining:</span>
              <span className="text-lg font-bold text-blue-600">{initialStats.remaining}</span>
            </div>
          </div>
        </div>

        {/* Main Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 sm:gap-4">
          {/* Center Stage */}
          <div className="col-span-1 lg:col-span-2 order-1">
            <Card className="min-h-[300px] sm:min-h-[500px]">
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
                                className="rounded-full object-cover w-full h-full"
                                onError={(e) => {
                                  setIsImageLoading(false)
                                  console.error('Image failed to load, showing initial')
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
                                  console.log('✅ Image loaded successfully via proxy')
                                }}
                              />
                            </>
                          ) : (
                            <span className="text-gray-600 dark:text-gray-400 text-2xl sm:text-3xl lg:text-4xl font-semibold">
                              {playerName.charAt(0).toUpperCase()}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
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
                <div className="border-t pt-2 sm:pt-4">
                  <div className="text-xs sm:text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1 sm:mb-2">Current Bid</div>
                  {currentBid ? (
                    <div className="text-lg sm:text-xl lg:text-2xl font-bold text-blue-600">
                      ₹{currentBid.amount.toLocaleString('en-IN')} - {currentBid.bidderName}
                      {currentBid.teamName && ` (${currentBid.teamName})`}
                    </div>
                  ) : (
                    <div className="text-sm sm:text-base lg:text-lg font-medium text-gray-700 dark:text-gray-300">No bids yet</div>
                  )}
                </div>
                <div className="flex flex-col gap-3 border-t pt-2 sm:pt-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 sm:gap-4">
                      <Clock className="h-4 w-4 sm:h-6 sm:w-6" />
                      <div className="text-xl sm:text-2xl lg:text-3xl font-bold" style={{ color: timer <= 5 ? 'red' : 'inherit' }}>
                        {timer}s
                      </div>
                    </div>
                  </div>
                  {currentBid && (
                    <div className="bg-green-50 dark:bg-green-900/10 p-2 rounded border border-green-200 dark:border-green-800">
                      <div className="text-xs font-semibold text-green-700 dark:text-green-300 mb-2">⚡ Finalize This Sale:</div>
                      <div className="flex gap-2">
                        <Button 
                          variant="default"
                          size="sm" 
                          className="text-xs sm:text-sm bg-green-600 hover:bg-green-700"
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
                        <AlertDialogAction onClick={handleUndoSaleConfirm} className="bg-red-600 hover:bg-red-700">
                          Undo Sale
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Bid History */}
          <div className="order-2 lg:order-1 hidden lg:block">
            <Card>
              <CardHeader className="p-3 sm:p-6">
                <CardTitle className="text-sm sm:text-base text-gray-900 dark:text-gray-100">Bid History</CardTitle>
              </CardHeader>
              <CardContent className="p-3 sm:p-6">
                <div className="space-y-2 max-h-[200px] sm:max-h-[300px] lg:max-h-[500px] overflow-y-auto">
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
                        <div key={index} className="text-sm border-l-2 pl-2 border-green-500 bg-green-50 dark:bg-green-900/10 rounded hover:border-green-600 transition-colors">
                          <div className="font-semibold text-green-800 dark:text-green-300">
                            ✅ {bid.playerName} SOLD!
                          </div>
                          <div className="text-xs text-green-700 dark:text-green-400">
                            To: {bid.bidderName} {bid.teamName && `(${bid.teamName})`} for ₹{bid.amount.toLocaleString('en-IN')}
                          </div>
                          <div className="text-xs text-green-600 dark:text-green-500 mt-1">
                            {timeAgo}
                          </div>
                        </div>
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
                        <div key={index} className="text-sm border-l-2 pl-2 border-orange-500 bg-orange-50 dark:bg-orange-900/10 rounded hover:border-orange-600 transition-colors">
                          <div className="font-semibold text-orange-800 dark:text-orange-300">
                            ⏭️ {bid.playerName} - UNSOLD
                          </div>
                          <div className="text-xs text-orange-700 dark:text-orange-400">
                            No buyer • Moving to next player
                          </div>
                          <div className="text-xs text-orange-600 dark:text-orange-500 mt-1">
                            {timeAgo}
                          </div>
                        </div>
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
                    
                    const increment = index === 0 
                      ? bid.amount 
                      : bid.amount - bidHistory[index + 1]?.amount || 0
                    
                    const commentary = index === 0 
                      ? "🎯 Current Top Bid!"
                      : increment > 50000 
                        ? "🚀 Big Jump!"
                        : "💪 Standard Bid"
                    
                    return (
                      <div key={index} className="text-sm border-l-2 pl-2 border-blue-500 hover:border-blue-600 transition-colors">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-900 dark:text-gray-100">{bid.bidderName}</span>
                          {bid.teamName && (
                            <span className="text-xs text-gray-600 dark:text-gray-400">({bid.teamName})</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-700 dark:text-gray-300">
                          {commentary} • ₹{bid.amount.toLocaleString('en-IN')}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          {timeAgo}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Quick Bid Banner - Global */}
        {selectedBidderForBid && (
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
                      const amount = parseFloat(customBidAmount)
                      if (isNaN(amount) || amount <= 0) {
                        alert('Please enter a valid bid amount')
                        return
                      }
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

        {/* Bidders Grid */}
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
                  <Button
                    size="sm"
                    className="mt-2 w-full text-xs sm:text-sm"
                    onClick={() => {
                      setSelectedBidderForBid(bidder.id)
                    }}
                    disabled={bidder.id === highestBidderId}
                  >
                    {bidder.id === highestBidderId ? 'Highest' : 'Select'}
                  </Button>
                </motion.div>
              ))}
            </div>
          </CardContent>
        </Card>


        {/* Teams Overview */}
        <TeamsOverview 
          auction={{
            ...auction,
            players: players as any
          }} 
        />

        {/* Players Sold Table */}
        <PlayersSoldTable auction={{ ...auction, players: players as any, bidHistory }} />
      </div>

      {/* Mobile Bid History Floating Button */}
      <div className="lg:hidden fixed bottom-4 right-4 z-50">
        <Button 
          onClick={() => setBidHistoryModalOpen(true)}
          className="rounded-full px-4 py-6 shadow-lg bg-blue-600 hover:bg-blue-700 text-white whitespace-nowrap"
        >
          <Clock className="h-5 w-5 mr-2" />
          <span className="text-sm font-semibold">Live Bid</span>
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
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Live Bid History</h3>
            </div>
            
            {/* Bid History Content */}
            <div className="px-4 py-2 space-y-2 flex-1 overflow-y-auto">
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
                    <div key={index} className="text-sm border-l-2 pl-2 border-green-500 bg-green-50 dark:bg-green-900/10 rounded p-2">
                      <div className="font-semibold text-green-800 dark:text-green-300">
                        ✅ {bid.playerName} SOLD!
                      </div>
                      <div className="text-xs text-green-700 dark:text-green-400">
                        To: {bid.bidderName} {bid.teamName && `(${bid.teamName})`} for ₹{bid.amount.toLocaleString('en-IN')}
                      </div>
                      <div className="text-xs text-green-600 dark:text-green-500 mt-1">
                        {timeAgo}
                      </div>
                    </div>
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
                    <div key={index} className="text-sm border-l-2 pl-2 border-orange-500 bg-orange-50 dark:bg-orange-900/10 rounded p-2">
                      <div className="font-semibold text-orange-800 dark:text-orange-300">
                        ⏭️ {bid.playerName} - UNSOLD
                      </div>
                      <div className="text-xs text-orange-700 dark:text-orange-400">
                        No buyer • Moving to next player
                      </div>
                      <div className="text-xs text-orange-600 dark:text-orange-500 mt-1">
                        {timeAgo}
                      </div>
                    </div>
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
                
                const increment = index === 0 
                  ? bid.amount 
                  : bid.amount - bidHistory[index + 1]?.amount || 0
                
                const commentary = index === 0 
                  ? "🎯 Current Top Bid!"
                  : increment > 50000 
                    ? "🚀 Big Jump!"
                    : "💪 Standard Bid"
                
                return (
                  <div key={index} className="text-sm border-l-2 pl-2 border-blue-500 rounded p-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900 dark:text-gray-100">{bid.bidderName}</span>
                      {bid.teamName && (
                        <span className="text-xs text-gray-600 dark:text-gray-400">({bid.teamName})</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-700 dark:text-gray-300">
                      {commentary} • ₹{bid.amount.toLocaleString('en-IN')}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {timeAgo}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

