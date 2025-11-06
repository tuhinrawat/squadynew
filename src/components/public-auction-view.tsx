'use client'

import { useState, useEffect } from 'react'
import { Auction, Player } from '@prisma/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Clock, ChevronDown, ChevronUp, TrendingUp, Eye, Trophy } from 'lucide-react'
import Link from 'next/link'
import { DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { usePusher } from '@/lib/pusher-client'
import { motion, AnimatePresence } from 'framer-motion'
import { logger } from '@/lib/logger'
import { useViewerCount } from '@/hooks/use-viewer-count'
import { PublicChat } from '@/components/public-chat'
import { ActivityLog } from '@/components/activity-log'
import PlayerCard from '@/components/player-card'
import BidAmountStrip from '@/components/bid-amount-strip'

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
  const [bidHistoryModalOpen, setBidHistoryModalOpen] = useState(false)
  const [players, setPlayers] = useState(auction.players)
  const [biddersState, setBiddersState] = useState(bidders)

  // Set client-side rendered flag
  useEffect(() => {
    setIsClient(true)
  }, [])

  // Sync biddersState with bidders prop when it changes
  useEffect(() => {
    setBiddersState(bidders)
  }, [bidders])

  // Initialize bid history and current bid from initial data
  useEffect(() => {
    logger.log('PublicAuctionView init', { historyLength: initialHistory.length, currentPlayerId: currentPlayer?.id })
    
    // Filter bid history to only show bids for the current player
    if (currentPlayer?.id) {
      const filteredHistory = initialHistory.filter(bid => {
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
      setCurrentBid({
        bidderId: data.bidderId,
        amount: data.amount,
        bidderName: data.bidderName,
        teamName: data.teamName
      })
      setHighestBidderId(data.bidderId)
      setTimer(data.countdownSeconds || 30)
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
      setIsImageLoading(true)
      setCurrentPlayer(data.player as Player)
      setCurrentBid(null)
      setHighestBidderId(null)
      setBidHistory([]) // Clear bid history for new player
    },
    onAuctionEnded: () => {
      window.location.reload()
    },
    onBidUndo: (data) => {
      // Remove first bid (newest) since we prepend to beginning
      setBidHistory(prev => prev.slice(1))
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
  })

  // Extract player data from JSON
  const getPlayerData = (player: Player | null) => {
    if (!player || !player.data) return {}
    return player.data as Record<string, any>
  }

  const playerData = getPlayerData(currentPlayer)
  const playerName = playerData.name || playerData.Name || 'No Player Selected'

  return (
    <div className="p-4 sm:p-6">
      <div className="max-w-7xl mx-auto space-y-4">
        {/* Compact Dark Header */}
        <div className="relative bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 rounded-lg overflow-hidden px-4 py-3">
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
              {/* Inline Stats */}
              <div className="hidden sm:flex items-center gap-3 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-400">Total:</span>
                  <span className="font-bold text-white">{initialStats.total}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-400">Sold:</span>
                  <span className="font-bold text-green-400">{initialStats.sold}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-400">Unsold:</span>
                  <span className="font-bold text-yellow-400">{initialStats.unsold}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-400">Left:</span>
                  <span className="font-bold text-purple-400">{initialStats.remaining}</span>
                </div>
                <div className="flex items-center gap-2 pl-3 border-l border-white/20">
                  <div className="w-20 bg-white/10 rounded-full h-1.5">
                    <div 
                      className="h-full bg-gradient-to-r from-green-500 to-blue-500 rounded-full transition-all"
                      style={{ width: `${((initialStats.sold + initialStats.unsold) / initialStats.total * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs font-bold text-blue-400">
                    {((initialStats.sold + initialStats.unsold) / initialStats.total * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
              
              <Link href={`/auction/${auction.id}/teams`} target="_blank" rel="noopener noreferrer">
                <Button className="bg-white/10 hover:bg-white/20 text-white border-white/20 h-8 text-xs" size="sm">
                  <Trophy className="h-3 w-3 mr-1" />
                  <span className="hidden sm:inline">Teams</span>
                </Button>
              </Link>
            </div>
          </div>
          
          {/* Mobile Stats - Two Rows */}
          <div className="sm:hidden mt-3 space-y-2">
            {/* Stats Row */}
            <div className="flex items-center justify-between text-[10px]">
              <div className="flex items-center gap-1">
                <span className="text-gray-400">Total:</span>
                <span className="font-bold text-white">{initialStats.total}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-gray-400">Sold:</span>
                <span className="font-bold text-green-400">{initialStats.sold}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-gray-400">Unsold:</span>
                <span className="font-bold text-yellow-400">{initialStats.unsold}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-gray-400">Left:</span>
                <span className="font-bold text-purple-400">{initialStats.remaining}</span>
              </div>
            </div>
            
            {/* Progress Bar Row */}
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-white/10 rounded-full h-1.5">
                <div 
                  className="h-full bg-gradient-to-r from-green-500 to-blue-500 rounded-full transition-all"
                  style={{ width: `${((initialStats.sold + initialStats.unsold) / initialStats.total * 100)}%` }}
                />
              </div>
              <span className="text-xs font-bold text-blue-400">
                {((initialStats.sold + initialStats.unsold) / initialStats.total * 100).toFixed(0)}%
              </span>
            </div>
          </div>
        </div>

        {/* Mobile Current Bid Banner */}
        <div className="lg:hidden sticky top-0 z-30 bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-3 rounded-lg shadow-lg">
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

        {/* Main Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 sm:gap-4">
          {/* Center Stage */}
          <div className="col-span-1 lg:col-span-2 order-1">
            {/* Sold Animation */}
            <Card className="min-h-[300px] sm:min-h-[500px] relative overflow-hidden">
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
              
              <CardContent className="p-4 space-y-4">
                {/* New Player Card */}
                {isClient && (
                  <PlayerCard
                    name={playerName}
                    imageUrl={(() => {
                      const profilePhotoLink = playerData['Profile Photo'] || playerData['profile photo'] || playerData['Profile photo']
                      if (!profilePhotoLink) return undefined
                      const match = profilePhotoLink.match(/\/d\/([a-zA-Z0-9_-]+)/)
                      if (match && match[1]) {
                        return `/api/proxy-image?id=${match[1]}`
                      }
                      return profilePhotoLink
                    })()}
                    basePrice={(currentPlayer?.data as any)?.['Base Price'] || (currentPlayer?.data as any)?.['base price']}
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
                )}
                
                {/* Bid Amount Strip */}
                {isClient && (
                  <BidAmountStrip
                    currentBid={currentBid}
                    timer={timer}
                    basePrice={(currentPlayer?.data as any)?.['Base Price'] || (currentPlayer?.data as any)?.['base price'] || 0}
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
                                className="rounded-full object-cover w-full h-full"
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
          </div>

          {/* Bid History */}
          <div className="order-2 lg:order-1">
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

      {/* Mobile Bid History Bottom Modal - Same content as admin view */}
      <Dialog open={bidHistoryModalOpen} onOpenChange={setBidHistoryModalOpen}>
        <DialogContent className="!fixed !bottom-0 !left-0 !right-0 !top-auto !translate-x-0 !translate-y-0 !w-full !max-w-full rounded-t-lg p-0 sm:hidden bg-gray-50 dark:bg-gray-900" style={{ maxHeight: '70vh', display: 'flex', flexDirection: 'column' }} showCloseButton={false}>
          <div className="flex flex-col" style={{ maxHeight: '70vh' }}>
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

      {/* Public Chat */}
      <PublicChat auctionId={auction.id} />
    </div>
  )
}



