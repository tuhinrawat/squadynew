'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, Brain, TrendingUp, TrendingDown, AlertCircle } from 'lucide-react'
import { Auction, Player, Bidder } from '@prisma/client'
import { usePusher } from '@/lib/pusher-client'

interface BidAnalyticsProps {
  auction: Auction & {
    players: Player[]
    bidders: (Bidder & {
      user: {
        id: string
        name: string | null
        email: string
      } | null
    })[]
  }
  selectedBidder: Bidder & {
    user: {
      id: string
      name: string | null
      email: string
    } | null
  }
  currentPlayer: Player | null
  bidHistory: any[]
  onCurrentPlayerChange?: (player: Player | null) => void
  onAuctionUpdate?: (auction: any) => void
}

interface AnalyticsData {
  predictions: {
    likelyBidders: Array<{
      bidderId: string
      bidderName: string
      teamName: string
      probability: number
      maxBid: number
      reasoning: string
    }>
    recommendedAction: {
      action: 'bid' | 'pass' | 'wait'
      recommendedBid?: number
      reasoning: string
      confidence: number
    }
    marketAnalysis: {
      averageBid: number
      highestBid: number
      competitionLevel: 'low' | 'medium' | 'high'
      remainingPoolImpact?: 'high' | 'medium' | 'low'
      remainingPoolSummary?: {
        bowlersLeft: number
        battersLeft: number
        allroundersLeft: number
        keepersLeft: number
        totalLeft: number
      }
      teamNeeds: Array<{
        bidderId: string
        teamName: string
        needs: string[]
        urgency: number
      }>
    }
  }
  loading: boolean
  error: string | null
}

export function BidAnalytics({ auction, selectedBidder, currentPlayer, bidHistory, onCurrentPlayerChange, onAuctionUpdate }: BidAnalyticsProps) {
  const [analytics, setAnalytics] = useState<AnalyticsData>({
    predictions: {
      likelyBidders: [],
      recommendedAction: {
        action: 'wait',
        reasoning: 'Loading analysis...',
        confidence: 0
      },
      marketAnalysis: {
        averageBid: 0,
        highestBid: 0,
        competitionLevel: 'low',
        teamNeeds: []
      }
    },
    loading: false,
    error: null
  })
  
  const [localCurrentPlayer, setLocalCurrentPlayer] = useState<Player | null>(currentPlayer)
  const [localAuction, setLocalAuction] = useState(auction)
  const [analyticsCache, setAnalyticsCache] = useState<Map<string, AnalyticsData['predictions']>>(new Map())
  const [lastBidTime, setLastBidTime] = useState<number>(0)
  const [bidCountForCurrentPlayer, setBidCountForCurrentPlayer] = useState<number>(0)
  const [lastOpenAICallTime, setLastOpenAICallTime] = useState<number>(0)

  // Update local state when props change
  useEffect(() => {
    setLocalCurrentPlayer(currentPlayer)
  }, [currentPlayer])
  
  useEffect(() => {
    setLocalAuction(auction)
  }, [auction])

  const fetchAnalytics = useCallback(async (forceRefresh = false, useAI = true) => {
    if (!localCurrentPlayer) return

    // Check cache first (unless force refresh)
    const cacheKey = `${localCurrentPlayer.id}-${localAuction.id}`
    const cached = analyticsCache.get(cacheKey)
    
    if (!forceRefresh && cached) {
      console.log('[Analytics] Using cached analytics for player:', localCurrentPlayer.id)
      setAnalytics({
        predictions: cached,
        loading: false,
        error: null
      })
      return
    }

    // Smart OpenAI usage strategy:
    // 1. Always use OpenAI for new players (first analysis)
    // 2. Use OpenAI if significant changes (multiple bids, high-value bids)
    // 3. Use fallback predictions for minor updates (single bids)
    // 4. Rate limit: Don't call OpenAI more than once per 30 seconds for same player
    const now = Date.now()
    const timeSinceLastAI = now - lastOpenAICallTime
    const shouldUseAI = useAI && (
      !cached || // First time for this player
      forceRefresh && timeSinceLastAI > 30000 || // Force refresh and 30s passed
      bidCountForCurrentPlayer === 0 || // No bids yet (initial analysis)
      bidCountForCurrentPlayer >= 3 || // Multiple bids (significant change)
      timeSinceLastAI > 60000 // 1 minute passed (periodic refresh)
    )

    setAnalytics(prev => ({ ...prev, loading: true, error: null }))

    try {
      // Get custom columns from analytics table (if available)
      const customColumns = (localAuction as any).analyticsVisibleColumns || []
      
      const response = await fetch(`/api/analytics/${localAuction.id}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: localCurrentPlayer.id,
          tusharBidderId: selectedBidder.id,
          customColumns: customColumns,
          useOpenAI: shouldUseAI // Tell API whether to use OpenAI or fallback
        })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to fetch analytics' }))
        throw new Error(errorData.error || 'Failed to fetch analytics')
      }

      let data
      try {
        data = await response.json()
      } catch (jsonError) {
        console.error('Error parsing response JSON:', jsonError)
        throw new Error('Invalid response from server')
      }

      // Validate response structure
      if (!data || !data.predictions) {
        console.error('Invalid response structure:', data)
        throw new Error('Invalid response structure from server')
      }

      // Cache the results
      const cacheKey = `${localCurrentPlayer.id}-${localAuction.id}`
      setAnalyticsCache(prev => {
        const newCache = new Map(prev)
        newCache.set(cacheKey, data.predictions)
        return newCache
      })

      // Update last OpenAI call time if we used AI
      if (shouldUseAI) {
        setLastOpenAICallTime(now)
      }

      setAnalytics({
        predictions: data.predictions,
        loading: false,
        error: null
      })
    } catch (error) {
      setAnalytics(prev => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }))
    }
  }, [localCurrentPlayer?.id, selectedBidder.id, localAuction.id, (localAuction as any).analyticsVisibleColumns, analyticsCache, lastOpenAICallTime, bidCountForCurrentPlayer])

  // Fetch analytics on mount and when current player changes (only if not cached)
  useEffect(() => {
    if (localCurrentPlayer) {
      const cacheKey = `${localCurrentPlayer.id}-${localAuction.id}`
      const cached = analyticsCache.get(cacheKey)
      // Reset bid count for new player
      setBidCountForCurrentPlayer(0)
      setLastOpenAICallTime(0) // Reset timer for new player
      
      if (!cached) {
        // First time for this player - use OpenAI
        fetchAnalytics(false, true)
      } else {
        // Use cached data
        setAnalytics({
          predictions: cached,
          loading: false,
          error: null
        })
      }
    }
  }, [localCurrentPlayer?.id]) // Only depend on player ID, not fetchAnalytics

  // Real-time updates via Pusher
  usePusher(auction.id, {
    onNewBid: (data) => {
      // New bid placed - increment bid count
      setBidCountForCurrentPlayer(prev => prev + 1)
      setLastBidTime(Date.now())
      
      // Smart refresh strategy:
      // - First 2 bids: Use fallback (no OpenAI) - just update with new bid data
      // - 3rd+ bid or significant price change: Use OpenAI for deeper analysis
      // - Debounce to avoid rapid calls
      if (localCurrentPlayer) {
        const currentBidCount = bidCountForCurrentPlayer + 1
        const shouldUseAI = currentBidCount >= 3 // Use AI after 3 bids
        
        console.log(`[Analytics] New bid received (count: ${currentBidCount}). Using ${shouldUseAI ? 'OpenAI' : 'fallback'}...`)
        
        // Debounce: wait 1-2 seconds before refreshing to batch multiple rapid bids
        setTimeout(() => {
          fetchAnalytics(true, shouldUseAI) // Use AI only if significant change
        }, shouldUseAI ? 1000 : 1500) // Longer debounce for fallback
      }
    },
    onPlayerSold: (data) => {
      // Player sold - no need to refresh analytics (player is gone)
      // Analytics will refresh when new player comes
      console.log('[Analytics] Player sold, will refresh when new player comes')
      setLastBidTime(Date.now())
      // Don't call fetchAnalytics here - wait for new player
    },
    onNewPlayer: (data) => {
      // New player in auction - update current player and refresh analytics
      console.log('[Analytics] New player in auction, updating analytics...')
      if (data.player) {
        setLocalCurrentPlayer(data.player as Player)
        onCurrentPlayerChange?.(data.player as Player)
        // Reset counters for new player
        setBidCountForCurrentPlayer(0)
        setLastOpenAICallTime(0)
        // Clear cache for new player and fetch fresh analytics with OpenAI
        const newCacheKey = `${data.player.id}-${localAuction.id}`
        setAnalyticsCache(prev => {
          const newCache = new Map(prev)
          newCache.delete(newCacheKey) // Clear cache for new player
          return newCache
        })
        setTimeout(() => {
          fetchAnalytics(true, true) // Force refresh with OpenAI for new player
        }, 500)
      }
    },
    onPlayersUpdated: (data) => {
      // Players or bidders updated - use fallback (purse changes don't need AI)
      console.log('[Analytics] Players/bidders updated, using fallback predictions...')
      setLastBidTime(Date.now())
      if (data.bidders) {
        // Update local auction with new bidder data
        setLocalAuction(prev => ({
          ...prev,
          bidders: prev.bidders.map(b => {
            const update = data.bidders!.find(ub => ub.id === b.id)
            return update ? { ...b, remainingPurse: update.remainingPurse } : b
          })
        }))
        onAuctionUpdate?.(localAuction)
      }
      // Refresh analytics with fallback (no OpenAI) - just update purse data
      setTimeout(() => {
        fetchAnalytics(true, false) // Use fallback for purse updates
      }, 500)
    },
    onBidUndo: (data) => {
      // Bid undone - decrement bid count and use fallback
      setBidCountForCurrentPlayer(prev => Math.max(0, prev - 1))
      console.log('[Analytics] Bid undone, using fallback predictions...')
      setLastBidTime(Date.now())
      if (localCurrentPlayer) {
        setTimeout(() => {
          fetchAnalytics(true, false) // Use fallback for undo
        }, 500)
      }
    },
    onSaleUndo: (data) => {
      // Sale undone - refresh analytics with OpenAI (significant change)
      console.log('[Analytics] Sale undone, refreshing with OpenAI...')
      setLastBidTime(Date.now())
      if (data.player) {
        setLocalCurrentPlayer(data.player as Player)
        onCurrentPlayerChange?.(data.player as Player)
        // Reset counters
        setBidCountForCurrentPlayer(0)
        setLastOpenAICallTime(0)
        // Clear cache for the player
        const cacheKey = `${data.player.id}-${localAuction.id}`
        setAnalyticsCache(prev => {
          const newCache = new Map(prev)
          newCache.delete(cacheKey)
          return newCache
        })
      }
      setTimeout(() => {
        fetchAnalytics(true, true) // Use OpenAI for sale undo (significant change)
      }, 1000)
    }
  })

  if (!localCurrentPlayer) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-gray-500">
          No player currently in auction
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Action Card */}
      <Card className="border-2 border-blue-200 dark:border-blue-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5" />
            AI-Powered Recommendation
          </CardTitle>
          <CardDescription>
            Analysis for {((localCurrentPlayer.data as any)?.Name || 'Current Player')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {analytics.loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
              <span className="ml-2">Analyzing bidding patterns...</span>
            </div>
          ) : analytics.error ? (
            <div className="flex items-center gap-2 text-red-600">
              <AlertCircle className="w-5 h-5" />
              <span>{analytics.error}</span>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 rounded-lg">
                <div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Recommended Action</p>
                  <p className="text-2xl font-bold mt-1">
                    {analytics.predictions.recommendedAction.action.toUpperCase()}
                  </p>
                  {analytics.predictions.recommendedAction.recommendedBid && (
                    <p className="text-lg text-gray-700 dark:text-gray-300 mt-1">
                      Suggested Bid: ₹{analytics.predictions.recommendedAction.recommendedBid.toLocaleString('en-IN')}
                    </p>
                  )}
                </div>
                <Badge variant="outline" className="text-lg px-4 py-2">
                  {Math.round(analytics.predictions.recommendedAction.confidence * 100)}% Confidence
                </Badge>
              </div>
              <p className="text-sm text-gray-700 dark:text-gray-300">
                {analytics.predictions.recommendedAction.reasoning}
              </p>
              <Button onClick={() => fetchAnalytics(true, true)} variant="outline" className="w-full">
                Refresh Analysis (with AI)
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Likely Bidders - Tabular View */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5" />
            Likely Bidders Analysis
          </CardTitle>
          <CardDescription>
            Advanced probability model based on multiple factors: purse balance, team needs, spending patterns, and bidding history
          </CardDescription>
        </CardHeader>
        <CardContent>
          {analytics.loading ? (
            <div className="text-center py-4 text-gray-500">Loading...</div>
          ) : (
            <div className="overflow-x-auto">
              {analytics.predictions.likelyBidders.length > 0 ? (
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Team / Bidder</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Probability</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Ideal Bid Price</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Purse</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Utilization</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Avg/Player</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Analysis</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.predictions.likelyBidders.map((bidder, index) => {
                      // Try multiple ways to find the bidder
                      const auctionBidder = localAuction.bidders.find(b => 
                        b.id === bidder.bidderId || 
                        (b as any).id === bidder.bidderId
                      )
                      
                      // Check if this is the selected bidder
                      const isSelectedBidder = bidder.bidderId === selectedBidder.id
                      
                      // Extract team name with better fallback logic
                      let teamName = 'Unknown Team'
                      if (bidder.teamName && bidder.teamName !== 'Unknown Team') {
                        teamName = bidder.teamName
                      } else if (auctionBidder) {
                        teamName = auctionBidder.teamName || 
                                   (auctionBidder as any).teamName ||
                                   'Unknown Team'
                      } else if (isSelectedBidder) {
                        teamName = selectedBidder.teamName || selectedBidder.username || 'Unknown Team'
                      }
                      
                      // Extract bidder name with better fallback logic
                      let bidderName = 'Unknown Bidder'
                      if (bidder.bidderName && bidder.bidderName !== 'Unknown Bidder') {
                        bidderName = bidder.bidderName
                      } else if (auctionBidder) {
                        bidderName = auctionBidder.user?.name || 
                                     (auctionBidder as any).user?.name ||
                                     auctionBidder.username || 
                                     (auctionBidder as any).username || 
                                     'Unknown Bidder'
                      } else if (isSelectedBidder) {
                        bidderName = selectedBidder.user?.name || selectedBidder.username || 'Unknown Bidder'
                      }
                      
                      const probability = Math.round(bidder.probability * 100)
                      const probabilityColor = probability >= 70 ? 'text-green-600 dark:text-green-400' : 
                                               probability >= 40 ? 'text-yellow-600 dark:text-yellow-400' : 
                                               'text-gray-600 dark:text-gray-400'
                      
                      return (
                        <tr
                          key={bidder.bidderId}
                          className={`border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors ${isSelectedBidder ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                        >
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">#{index + 1}</span>
                                <span className="font-semibold text-sm">{teamName}</span>
                                {isSelectedBidder && (
                                  <Badge variant="outline" className="text-xs ml-1">You</Badge>
                                )}
                              </div>
                              <span className="text-xs text-gray-600 dark:text-gray-400 ml-5">{bidderName}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex flex-col items-center">
                              <span className={`text-lg font-bold ${probabilityColor}`}>{probability}%</span>
                              <div className="w-16 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full mt-1">
                                <div 
                                  className={`h-full rounded-full ${
                                    probability >= 70 ? 'bg-green-500' : 
                                    probability >= 40 ? 'bg-yellow-500' : 
                                    'bg-gray-400'
                                  }`}
                                  style={{ width: `${probability}%` }}
                                />
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            {bidder.maxBid && bidder.maxBid > 0 ? (
                              <span className="font-semibold text-sm">₹{bidder.maxBid.toLocaleString('en-IN')}</span>
                            ) : (
                              <span className="text-gray-400 text-sm">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="text-sm">{auctionBidder?.remainingPurse ? `₹${auctionBidder.remainingPurse.toLocaleString('en-IN')}` : '-'}</span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            {auctionBidder && auctionBidder.purseAmount ? (
                              <span className="text-sm">
                                {Math.round(((auctionBidder.purseAmount - (auctionBidder.remainingPurse || 0)) / auctionBidder.purseAmount) * 100)}%
                              </span>
                            ) : (
                              <span className="text-gray-400 text-sm">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {(() => {
                              // Calculate avg spent per player from actual data
                              if (!auctionBidder) return <span className="text-gray-400 text-sm">-</span>
                              
                              // Get all players sold to this bidder
                              const soldPlayers = localAuction.players.filter(p => 
                                p.status === 'SOLD' && p.soldTo === auctionBidder.id
                              )
                              
                              if (soldPlayers.length === 0) {
                                return <span className="text-gray-400 text-sm">-</span>
                              }
                              
                              const totalSpent = soldPlayers.reduce((sum, p) => sum + (p.soldPrice || 0), 0)
                              const avgSpent = totalSpent / soldPlayers.length
                              
                              return (
                                <span className="text-sm">₹{avgSpent.toLocaleString('en-IN')}</span>
                              )
                            })()}
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2">{bidder.reasoning}</p>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="text-center py-4 text-gray-500">No likely bidders identified at this time.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Market Analysis - Tabular View */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingDown className="w-5 h-5" />
            Market Analysis & Team Needs
          </CardTitle>
          <CardDescription>
            Comprehensive market metrics and team composition analysis
          </CardDescription>
        </CardHeader>
        <CardContent>
          {analytics.loading ? (
            <div className="text-center py-4 text-gray-500">Loading...</div>
          ) : (
            <div className="space-y-6">
              {/* Market Metrics Table */}
              <div>
                <h3 className="text-sm font-semibold mb-3 text-gray-700 dark:text-gray-300">Market Metrics</h3>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Metric</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Value</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                             <tr className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                               <td className="px-4 py-3 font-medium text-sm">
                                 <div className="flex flex-col">
                                   <span>Average Bid</span>
                                   <span className="text-xs text-gray-500 dark:text-gray-400 font-normal">(for this player)</span>
                                 </div>
                               </td>
                               <td className="px-4 py-3 text-right">
                                 {analytics.predictions.marketAnalysis.averageBid > 0 ? (
                                   <span className="text-lg font-bold">₹{analytics.predictions.marketAnalysis.averageBid.toLocaleString('en-IN')}</span>
                                 ) : (
                                   <span className="text-sm text-gray-400">No bids yet</span>
                                 )}
                               </td>
                               <td className="px-4 py-3 text-center">
                                 {analytics.predictions.marketAnalysis.averageBid > 0 ? (
                                   <Badge variant="outline" className="text-xs">Market Avg</Badge>
                                 ) : (
                                   <Badge variant="secondary" className="text-xs">N/A</Badge>
                                 )}
                               </td>
                             </tr>
                             <tr className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                               <td className="px-4 py-3 font-medium text-sm">
                                 <div className="flex flex-col">
                                   <span>Highest Bid</span>
                                   <span className="text-xs text-gray-500 dark:text-gray-400 font-normal">(for this player)</span>
                                 </div>
                               </td>
                               <td className="px-4 py-3 text-right">
                                 {analytics.predictions.marketAnalysis.highestBid > 0 ? (
                                   <span className="text-lg font-bold">₹{analytics.predictions.marketAnalysis.highestBid.toLocaleString('en-IN')}</span>
                                 ) : (
                                   <span className="text-sm text-gray-400">No bids yet</span>
                                 )}
                               </td>
                               <td className="px-4 py-3 text-center">
                                 {analytics.predictions.marketAnalysis.highestBid > 0 ? (
                                   <Badge variant="outline" className="text-xs">Peak</Badge>
                                 ) : (
                                   <Badge variant="secondary" className="text-xs">N/A</Badge>
                                 )}
                               </td>
                             </tr>
                      <tr className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                        <td className="px-4 py-3 font-medium text-sm">Competition Level</td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-sm text-gray-600 dark:text-gray-400">
                            {analytics.predictions.marketAnalysis.competitionLevel === 'high' ? 'High' : 
                             analytics.predictions.marketAnalysis.competitionLevel === 'medium' ? 'Medium' : 'Low'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Badge
                            variant={
                              analytics.predictions.marketAnalysis.competitionLevel === 'high'
                                ? 'destructive'
                                : analytics.predictions.marketAnalysis.competitionLevel === 'medium'
                                ? 'default'
                                : 'secondary'
                            }
                            className="text-xs"
                          >
                            {analytics.predictions.marketAnalysis.competitionLevel.toUpperCase()}
                          </Badge>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Team Needs Table */}
              <div>
                <h3 className="text-sm font-semibold mb-3 text-gray-700 dark:text-gray-300">Team Needs Analysis</h3>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Team</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Needs</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Urgency</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Priority</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.predictions.marketAnalysis.teamNeeds.length > 0 ? (
                        analytics.predictions.marketAnalysis.teamNeeds
                          .sort((a, b) => b.urgency - a.urgency)
                          .map(team => {
                            // Try multiple ways to find the bidder
                            const auctionBidder = localAuction.bidders.find(b => 
                              b.id === team.bidderId || 
                              (b as any).id === team.bidderId
                            )
                            
                            // Extract team name with better fallback logic
                            let displayTeamName = 'Unknown Team'
                            if (team.teamName && team.teamName !== 'Unknown Team') {
                              displayTeamName = team.teamName
                            } else if (auctionBidder) {
                              displayTeamName = auctionBidder.teamName || 
                                               (auctionBidder as any).teamName ||
                                               auctionBidder.user?.name || 
                                               (auctionBidder as any).user?.name ||
                                               auctionBidder.username || 
                                               (auctionBidder as any).username || 
                                               'Unknown Team'
                            }
                            
                            const urgencyColor = team.urgency >= 8 ? 'text-red-600 dark:text-red-400' : 
                                                 team.urgency >= 5 ? 'text-yellow-600 dark:text-yellow-400' : 
                                                 'text-green-600 dark:text-green-400'
                            
                            return (
                              <tr key={team.bidderId} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                <td className="px-4 py-3">
                                  <span className="font-semibold text-sm">{displayTeamName}</span>
                                </td>
                                <td className="px-4 py-3">
                                  <span className="text-sm text-gray-600 dark:text-gray-400">
                                    {team.needs && team.needs.length > 0 ? team.needs.join(', ') : 'Balanced team'}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <div className="flex flex-col items-center">
                                    <span className={`text-lg font-bold ${urgencyColor}`}>{team.urgency}/10</span>
                                    <div className="w-16 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full mt-1">
                                      <div 
                                        className={`h-full rounded-full ${
                                          team.urgency >= 8 ? 'bg-red-500' : 
                                          team.urgency >= 5 ? 'bg-yellow-500' : 
                                          'bg-green-500'
                                        }`}
                                        style={{ width: `${(team.urgency / 10) * 100}%` }}
                                      />
                                    </div>
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <Badge 
                                    variant={team.urgency >= 8 ? 'destructive' : team.urgency >= 5 ? 'default' : 'secondary'}
                                    className="text-xs"
                                  >
                                    {team.urgency >= 8 ? 'High' : team.urgency >= 5 ? 'Medium' : 'Low'}
                                  </Badge>
                                </td>
                              </tr>
                            )
                          })
                      ) : (
                        <tr>
                          <td colSpan={4} className="px-4 py-4 text-center text-gray-500">No team needs data available.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

