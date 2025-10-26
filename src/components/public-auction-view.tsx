'use client'

import { useState, useEffect } from 'react'
import { Auction, Player } from '@prisma/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Clock, ChevronDown, ChevronUp } from 'lucide-react'
import { usePusher } from '@/lib/pusher-client'
import { motion, AnimatePresence } from 'framer-motion'
import { TeamsOverview } from '@/components/teams-overview'
import { PlayersSoldTable } from '@/components/players-sold-table'

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
  const [bidHistoryModalOpen, setBidHistoryModalOpen] = useState(false)
  const [players, setPlayers] = useState(auction.players)

  // Set client-side rendered flag
  useEffect(() => {
    setIsClient(true)
  }, [])

  // Initialize bid history and current bid from initial data
  useEffect(() => {
    console.log('PublicAuctionView: Initializing bid history, length:', initialHistory.length, 'currentPlayer:', currentPlayer?.id)
    
    // Filter bid history to only show bids for the current player
    if (currentPlayer?.id) {
      const filteredHistory = initialHistory.filter(bid => {
        // Show bids that match the current player OR don't have a playerId (legacy bids)
        return !bid.playerId || bid.playerId === currentPlayer.id
      })
      console.log('PublicAuctionView: Filtered history length:', filteredHistory.length)
      // Reverse to have oldest first, newest last (matching admin view)
      const reversedHistory = [...filteredHistory].reverse()
      setBidHistory(reversedHistory)
      
      // Set current bid if there's a bid in the filtered history
      if (reversedHistory.length > 0) {
        // Get the latest bid (last item is most recent since we append to end)
        const latestBid = reversedHistory[reversedHistory.length - 1]
        if (latestBid && (!latestBid.type || latestBid.type === 'bid')) {
          console.log('PublicAuctionView: Setting initial current bid:', latestBid)
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

  // Refresh players list from server
  const refreshPlayersList = async () => {
    try {
      const response = await fetch(`/api/auctions/${auction.id}`)
      const data = await response.json()
      if (data.auction?.players) {
        setPlayers(data.auction.players)
      }
    } catch (error) {
      console.error('Failed to refresh players list:', error)
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
      console.log('PublicAuctionView: onNewBid called', data)
      setCurrentBid({
        bidderId: data.bidderId,
        amount: data.amount,
        bidderName: data.bidderName,
        teamName: data.teamName
      })
      setHighestBidderId(data.bidderId)
      setTimer(data.countdownSeconds || 30)
      setBidHistory(prev => {
        console.log('PublicAuctionView: Updating bid history, prev length:', prev.length)
        // Add newest bid at the end (matching admin view order)
        return [...prev, {
          bidderId: data.bidderId,
          amount: data.amount,
          timestamp: new Date(),
          bidderName: data.bidderName,
          teamName: data.teamName,
          playerId: currentPlayer?.id, // Associate bid with current player
          type: 'bid'
        }]
      })
    },
    onPlayerSold: (data) => {
      console.log('PublicAuctionView: Player sold', data)
      
      // Add sold event to bid history using the latest bid in history
      setBidHistory(prev => {
        const latestBid = prev.length > 0 ? prev[prev.length - 1] : null
        if (latestBid && latestBid.type === 'bid') {
          return [...prev, {
            type: 'sold',
            playerName: data?.playerName || (currentPlayer as any)?.data?.name || 'Player',
            bidderId: latestBid.bidderId,
            bidderName: latestBid.bidderName,
            teamName: latestBid.teamName,
            amount: latestBid.amount,
            timestamp: new Date(),
            playerId: currentPlayer?.id
          }]
        }
        return prev
      })
      
      setSoldAnimation(true)
      setTimeout(() => {
        setSoldAnimation(false)
        window.location.reload()
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
      // Remove last bid (newest) since we append to end
      setBidHistory(prev => prev.slice(0, -1))
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
    },
    onSaleUndo: () => {
      window.location.reload()
    },
    onPlayersUpdated: () => {
      refreshPlayersList()
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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 p-2 sm:p-4">
      <div className="max-w-7xl mx-auto space-y-2 sm:space-y-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:justify-between items-start sm:items-center bg-white dark:bg-gray-800 rounded-lg p-3 sm:p-4 shadow gap-2 sm:gap-0">
          <div>
            <h1 className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-gray-100">{auction.name}</h1>
            <div className="flex gap-2 mt-2">
              <Badge className="bg-green-500 text-white text-xs sm:text-sm">
                LIVE
              </Badge>
              <Badge variant="outline" className="text-xs sm:text-sm text-gray-900 bg-white border-gray-300 hover:bg-gray-50 dark:text-gray-100 dark:bg-gray-800 dark:border-gray-600 dark:hover:bg-gray-700">Public Viewer</Badge>
            </div>
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
                    // Try to find profile photo with various field name patterns
                    const profilePhotoLink = playerData['Profile Photo'] || playerData['profile photo'] || playerData['Profile photo'] || 
                      playerData['ProfilePhoto'] || playerData['profilePhoto'] || playerData['ProfilePHOTO'] || 
                      playerData['profile_photo'] || playerData['Profile_Photo'] || playerData['PHOTO']
                    
                    if (!profilePhotoLink) {
                      console.log('No profile photo found. Available fields:', Object.keys(playerData))
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
                    
                    console.log('Profile photo link found:', profilePhotoLink)
                    
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
                <div className="flex items-center gap-2 sm:gap-4 border-t pt-2 sm:pt-4">
                  <Clock className="h-4 w-4 sm:h-6 sm:w-6" />
                  <div className="text-xl sm:text-2xl lg:text-3xl font-bold" style={{ color: timer <= 5 ? 'red' : 'inherit' }}>
                    {timer}s
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Bid History */}
          <div className="order-2 lg:order-1">
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
                            To: {bid.bidderName} {bid.teamName && `(${bid.teamName})`} for ₹{bid.amount?.toLocaleString('en-IN') || 'N/A'}
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
                    
                    const isLatestBid = index === bidHistory.length - 1
                    // Calculate increment compared to previous bid (index-1 is older)
                    const increment = index === 0
                      ? bid.amount 
                      : bid.amount - bidHistory[index - 1]?.amount || 0
                    
                    const commentary = isLatestBid
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
                          {commentary} • ₹{bid.amount?.toLocaleString('en-IN') || 'N/A'}
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

        {/* Teams Overview */}
        <TeamsOverview auction={{ ...auction, bidders: bidders.map(b => ({ ...b, user: { name: b.username } })), players: players as any }} />

        {/* Players Sold Table */}
        <PlayersSoldTable auction={{ ...auction, players: players as any, bidders: bidders.map(b => ({ ...b, user: { name: b.username } })), bidHistory }} />
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
                  <motion.div 
                    key={index} 
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="text-sm border-l-2 pl-2 border-green-500 bg-gradient-to-r from-green-50 to-transparent dark:from-green-900/10 rounded p-2"
                  >
                    <div className="font-semibold text-green-800 dark:text-green-300">
                      ✅ {bid.playerName} SOLD!
                    </div>
                    <div className="text-xs text-green-700 dark:text-green-400">
                      To: {bid.bidderName} {bid.teamName && `(${bid.teamName})`} for ₹{bid.amount?.toLocaleString('en-IN') || 'N/A'}
                    </div>
                    <div className="text-xs text-green-600 dark:text-green-500 mt-1">
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
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="text-sm border-l-2 pl-2 border-orange-500 bg-gradient-to-r from-orange-50 to-transparent dark:from-orange-900/10 rounded p-2"
                  >
                    <div className="font-semibold text-orange-800 dark:text-orange-300">
                      ⏭️ {bid.playerName} - UNSOLD
                    </div>
                    <div className="text-xs text-orange-700 dark:text-orange-400">
                      No buyer • Moving to next player
                    </div>
                    <div className="text-xs text-orange-600 dark:text-orange-500 mt-1">
                      {timeAgo}
                    </div>
                  </motion.div>
                )
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
              
              const isLatestBid = index === bidHistory.length - 1
              // Calculate increment compared to previous bid (index-1 is older)
              const increment = index === 0
                ? bid.amount 
                : bid.amount - bidHistory[index - 1]?.amount || 0
              
              const commentary = isLatestBid
                ? "🎯 Current Top Bid!"
                : increment > 50000 
                  ? "🚀 Big Jump!"
                  : "💪 Standard Bid"
              
              return (
                <motion.div 
                  key={index}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className={`text-sm border-l-2 pl-2 border-blue-500 ${isLatestBid ? 'bg-gradient-to-r from-blue-50 to-transparent dark:from-blue-900/10' : ''} rounded p-2`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900 dark:text-gray-100">{bid.bidderName}</span>
                    {bid.teamName && (
                      <span className="text-xs text-gray-600 dark:text-gray-400">({bid.teamName})</span>
                    )}
                    {isLatestBid && <Badge className="text-xs bg-blue-500">LATEST</Badge>}
                  </div>
                  <div className="text-xs text-gray-700 dark:text-gray-300">
                    {commentary} • ₹{bid.amount?.toLocaleString('en-IN') || 'N/A'}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {timeAgo}
                  </div>
                </motion.div>
              )
            })}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

