'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, Brain, TrendingUp, TrendingDown, AlertCircle, BarChart3, Star, Users } from 'lucide-react'
import { Auction, Player, Bidder } from '@prisma/client'
import { usePusher } from '@/lib/pusher-client'
import { calculatePlayerScoreFromData } from '@/lib/playerStats'

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
      suggestedBuyPrice?: number
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
        reasoning?: string
        purchasedCount?: number
        remainingSlots?: number
        remainingPurse?: number
        mustSpendPerSlot?: number
        composition?: {
          batters: number
          bowlers: number
          allrounders: number
        }
      }>
    }
    upcomingHighValuePlayers?: Array<{
      id: string
      name: string
      speciality: string
      predictedSpeciality: string
      predictedStats: string
      batting: string
      bowling: string
      isIcon: boolean
      basePrice: number
      brillianceScore: number
      overallRating: number
      predictedPrice: number
      minPrice: number
      maxPrice: number
      factors: string[]
    }>
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
  const [bidderPriorities, setBidderPriorities] = useState<Record<string, Record<string, number>>>({})
  
  // Track factors that should trigger OpenAI calls
  const [lastTeamCompositionHash, setLastTeamCompositionHash] = useState<string>('')
  const [lastBidderPrioritiesHash, setLastBidderPrioritiesHash] = useState<string>('')
  const [lastPlayerStatsHash, setLastPlayerStatsHash] = useState<string>('')
  const [lastPlayerPosition, setLastPlayerPosition] = useState<number>(-1)
  
  // Refs to store timeout IDs for cleanup
  const timeoutRefs = useRef<Set<NodeJS.Timeout>>(new Set())
  // Ref to store cache for efficient access without causing re-renders
  const cacheRef = useRef<Map<string, AnalyticsData['predictions']>>(new Map())
  // Ref to store current analytics for access in callbacks
  const analyticsRef = useRef<AnalyticsData>(analytics)
  
  // Keep refs in sync with state
  useEffect(() => {
    cacheRef.current = analyticsCache
  }, [analyticsCache])
  
  useEffect(() => {
    analyticsRef.current = analytics
  }, [analytics])

  // Update local state when props change
  useEffect(() => {
    setLocalCurrentPlayer(currentPlayer)
  }, [currentPlayer])
  
  useEffect(() => {
    setLocalAuction(auction)
  }, [auction])

  // Helper function to calculate hash of team composition (players sold to bidder)
  const calculateTeamCompositionHash = useCallback((bidderId: string) => {
    const soldPlayers = localAuction.players
      .filter(p => p.soldTo === bidderId && p.status === 'SOLD')
      .map(p => p.id)
      .sort()
      .join(',')
    return `${bidderId}:${soldPlayers}`
  }, [localAuction.players])

  // Helper function to calculate hash of bidder priorities
  const calculateBidderPrioritiesHash = useCallback(() => {
    return JSON.stringify(bidderPriorities)
  }, [bidderPriorities])

  // Helper function to calculate hash of player stats
  const calculatePlayerStatsHash = useCallback((player: Player | null) => {
    if (!player) return ''
    const data = player.data as any
    return JSON.stringify({
      batting: data?.Batting || data?.batting,
      bowling: data?.Bowling || data?.bowling,
      experience: data?.Experience || data?.experience,
      form: data?.Form || data?.form
    })
  }, [])

  // Helper function to get player position in auction (order in which players are auctioned)
  const getPlayerPosition = useCallback((player: Player | null) => {
    if (!player) return -1
    // Players are ordered by createdAt, so position is index in sorted array
    const sortedPlayers = [...localAuction.players].sort((a, b) => 
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    )
    return sortedPlayers.findIndex(p => p.id === player.id)
  }, [localAuction.players])

  // Check if any OpenAI-triggering factors have changed
  const checkIfFactorsChanged = useCallback((player: Player | null) => {
    if (!player) return false

    const currentTeamHash = calculateTeamCompositionHash(selectedBidder.id)
    const currentPrioritiesHash = calculateBidderPrioritiesHash()
    const currentStatsHash = calculatePlayerStatsHash(player)
    const currentPosition = getPlayerPosition(player)

    const factorsChanged = 
      currentTeamHash !== lastTeamCompositionHash ||
      currentPrioritiesHash !== lastBidderPrioritiesHash ||
      currentStatsHash !== lastPlayerStatsHash ||
      currentPosition !== lastPlayerPosition

    if (factorsChanged) {
      console.log('[Analytics] OpenAI-triggering factors changed:', {
        teamComposition: currentTeamHash !== lastTeamCompositionHash,
        bidderPriorities: currentPrioritiesHash !== lastBidderPrioritiesHash,
        playerStats: currentStatsHash !== lastPlayerStatsHash,
        playerPosition: currentPosition !== lastPlayerPosition
      })
      
      // Update tracked values
      setLastTeamCompositionHash(currentTeamHash)
      setLastBidderPrioritiesHash(currentPrioritiesHash)
      setLastPlayerStatsHash(currentStatsHash)
      setLastPlayerPosition(currentPosition)
    }

    return factorsChanged
  }, [
    selectedBidder.id,
    lastTeamCompositionHash,
    lastBidderPrioritiesHash,
    lastPlayerStatsHash,
    lastPlayerPosition,
    calculateTeamCompositionHash,
    calculateBidderPrioritiesHash,
    calculatePlayerStatsHash,
    getPlayerPosition
  ])

  // Monitor bidder priorities changes - refresh with mathematical model (default)
  useEffect(() => {
    if (Object.keys(bidderPriorities).length > 0) {
      const currentHash = calculateBidderPrioritiesHash()
      if (currentHash !== lastBidderPrioritiesHash && lastBidderPrioritiesHash !== '') {
        console.log('[Analytics] Bidder priorities changed - refreshing with mathematical model')
        setLastBidderPrioritiesHash(currentHash)
        if (localCurrentPlayer) {
          // Clear cache and refresh with mathematical model (default)
          const cacheKey = `${localCurrentPlayer.id}-${localAuction.id}`
          setAnalyticsCache(prev => {
            const newCache = new Map(prev)
            newCache.delete(cacheKey)
            return newCache
          })
          fetchAnalytics(true, false) // Use mathematical model (default)
        }
      } else if (lastBidderPrioritiesHash === '') {
        // First time - just set the hash
        setLastBidderPrioritiesHash(currentHash)
      }
    }
  }, [bidderPriorities, calculateBidderPrioritiesHash, lastBidderPrioritiesHash, localCurrentPlayer, localAuction.id])

  // Fetch bidder priorities on mount
  useEffect(() => {
    const fetchPriorities = async () => {
      try {
        const response = await fetch(`/api/analytics/${auction.id}/bidder-priorities?key=tushkiKILLS`)
        if (response.ok) {
          const data = await response.json()
          setBidderPriorities(data.bidderPriorities || {})
        }
      } catch (error) {
        console.error('Error fetching bidder priorities:', error)
      }
    }
    fetchPriorities()
  }, [auction.id])
  
  // Cleanup all timeouts on unmount
  useEffect(() => {
    return () => {
      timeoutRefs.current.forEach(timeout => clearTimeout(timeout))
      timeoutRefs.current.clear()
    }
  }, [])
  
  // Limit cache size to prevent memory bloat (keep only last 10 players)
  useEffect(() => {
    if (analyticsCache.size > 10) {
      setAnalyticsCache(prev => {
        const newCache = new Map(prev)
        // Remove oldest entries (keep last 10)
        const entries = Array.from(newCache.entries())
        const toKeep = entries.slice(-10)
        return new Map(toKeep)
      })
    }
  }, [analyticsCache.size])

  const fetchAnalytics = useCallback(async (forceRefresh = false, useAI = false) => {
    if (!localCurrentPlayer) {
      console.log('[Analytics] No current player, skipping fetch')
      return
    }

    console.log('[Analytics] fetchAnalytics called', { 
      playerId: localCurrentPlayer.id, 
      forceRefresh, 
      useAI 
    })

    // Check cache first (unless force refresh) - use ref for efficient access
    const cacheKey = `${localCurrentPlayer.id}-${localAuction.id}`
    const cached = cacheRef.current.get(cacheKey)
    
    if (!forceRefresh && cached) {
      console.log('[Analytics] Using cached analytics for player:', localCurrentPlayer.id)
      setAnalytics({
        predictions: cached,
        loading: false,
        error: null
      })
      return
    }

    // Mathematical model is now the DEFAULT (faster, cheaper, real-time)
    // OpenAI is optional enhancement - only use if explicitly requested
    // The mathematical model already handles:
    // - Multi-factor probability calculations (8 weighted factors)
    // - Stats-based pricing
    // - Team composition analysis
    // - Bidder priority matrix
    // - Pool supply impact
    // - Budget pressure calculations
    // - Real-time auction state
    const now = Date.now()
    const timeSinceLastAI = now - lastOpenAICallTime
    
    // Check if factors changed
    const factorsChanged = checkIfFactorsChanged(localCurrentPlayer)
    
    // Only use OpenAI if explicitly requested AND factors changed (cost optimization)
    const shouldUseAI = useAI && (
      factorsChanged || // Any factor changed (priorities, team composition, stats, position)
      (forceRefresh && timeSinceLastAI > 30000) // Force refresh and 30s passed (manual refresh)
    )
    
    if (shouldUseAI) {
      console.log('[Analytics] Using OpenAI enhancement because:', {
        factorsChanged,
        forceRefresh: forceRefresh && timeSinceLastAI > 30000
      })
    } else {
      console.log('[Analytics] Using mathematical model (default) - real-time, cost-effective')
    }

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
          useOpenAI: shouldUseAI // Mathematical model is default (false), set true for OpenAI enhancement
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

      // Cache the results (with size limit)
      const cacheKey = `${localCurrentPlayer.id}-${localAuction.id}`
      setAnalyticsCache(prev => {
        const newCache = new Map(prev)
        newCache.set(cacheKey, data.predictions)
        // Limit cache to 10 entries to prevent memory bloat
        if (newCache.size > 10) {
          const entries = Array.from(newCache.entries())
          const toKeep = entries.slice(-10)
          return new Map(toKeep)
        }
        return newCache
      })

      // Update last OpenAI call time if we used AI
      if (shouldUseAI) {
        setLastOpenAICallTime(now)
      }

      console.log('[Analytics] Successfully fetched analytics', data.predictions)
      setAnalytics({
        predictions: data.predictions,
        loading: false,
        error: null
      })
    } catch (error) {
      console.error('[Analytics] Error fetching analytics:', error)
      setAnalytics(prev => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }))
    }
  }, [localCurrentPlayer?.id, selectedBidder.id, localAuction.id, (localAuction as any).analyticsVisibleColumns, lastOpenAICallTime, bidCountForCurrentPlayer, checkIfFactorsChanged])

  // Fetch analytics on mount and when current player changes
  // Only use OpenAI if factors changed or first time
  useEffect(() => {
    if (localCurrentPlayer) {
      const cacheKey = `${localCurrentPlayer.id}-${localAuction.id}`
      const cached = cacheRef.current.get(cacheKey)
      // Reset bid count for new player
      setBidCountForCurrentPlayer(0)
      
      // Check if factors changed
      const factorsChanged = checkIfFactorsChanged(localCurrentPlayer)
      
      if (!cached) {
        // First time for this player - use mathematical model (default)
        console.log('[Analytics] Fetching analytics for new player using mathematical model')
        fetchAnalytics(false, false) // Use mathematical model (default)
      } else if (factorsChanged) {
        // Factors changed - optionally use OpenAI enhancement
        console.log('[Analytics] Factors changed - using OpenAI enhancement')
        setLastOpenAICallTime(0) // Reset timer
        fetchAnalytics(false, true) // Use OpenAI (optional enhancement)
      } else {
        // Use cached data (factors unchanged)
        console.log('[Analytics] Using cached analytics (factors unchanged)')
        setAnalytics({
          predictions: cached,
          loading: false,
          error: null
        })
      }
    }
  }, [localCurrentPlayer?.id, fetchAnalytics, checkIfFactorsChanged, localAuction.id]) // Include dependencies

  // Real-time updates via Pusher
  usePusher(auction.id, {
    onNewBid: (data) => {
      // New bid placed - DO NOT call OpenAI (too costly)
      // Only track bid count for display purposes
      setBidCountForCurrentPlayer(prev => prev + 1)
      setLastBidTime(Date.now())
      console.log('[Analytics] New bid received - NOT calling OpenAI (cost optimization)')
      // Analytics will be refreshed when factors change (team composition, priorities, etc.)
    },
    onPlayerSold: (data) => {
      // Player sold - team composition changed, trigger OpenAI refresh
      console.log('[Analytics] Player sold - team composition changed, triggering OpenAI refresh')
      setLastBidTime(Date.now())
      
      // Reset team composition hash to force refresh on next player
      setLastTeamCompositionHash('')
      
      // Don't call fetchAnalytics here - wait for new player
      // The new player will trigger a refresh with updated team composition
    },
    onNewPlayer: (data) => {
      // New player in auction - check if factors changed and refresh with OpenAI
      console.log('[Analytics] New player in auction, checking if OpenAI refresh needed...')
      if (data.player) {
        const newPlayer = data.player as Player
        setLocalCurrentPlayer(newPlayer)
        onCurrentPlayerChange?.(newPlayer)
        // Reset counters for new player
        setBidCountForCurrentPlayer(0)
        
        // Check if factors changed (team composition, priorities, stats, position)
        const factorsChanged = checkIfFactorsChanged(newPlayer)
        
        // Clear cache for new player
        const newCacheKey = `${newPlayer.id}-${localAuction.id}`
        setAnalyticsCache(prev => {
          const newCache = new Map(prev)
          newCache.delete(newCacheKey)
          return newCache
        })
        
        // Use mathematical model by default (faster, cheaper, real-time)
        // Only use OpenAI if factors changed (optional enhancement)
        const shouldUseAI = factorsChanged
        
        if (shouldUseAI) {
          console.log('[Analytics] Factors changed - using OpenAI enhancement')
          setLastOpenAICallTime(0) // Reset timer
          const timeout = setTimeout(() => {
            timeoutRefs.current.delete(timeout)
            fetchAnalytics(true, true) // Force refresh with OpenAI (optional)
          }, 500)
          timeoutRefs.current.add(timeout)
        } else {
          console.log('[Analytics] Using mathematical model (default) - real-time predictions')
          // Use cached data if available
          const cached = cacheRef.current.get(newCacheKey)
          if (cached) {
            setAnalytics({
              predictions: cached,
              loading: false,
              error: null
            })
          } else {
            // Fetch with mathematical model (default, no OpenAI)
            fetchAnalytics(true, false)
          }
        }
      }
    },
    onPlayersUpdated: (data) => {
      // Players or bidders updated - check if team composition changed
      console.log('[Analytics] Players/bidders updated, checking for team composition changes...')
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
      
      // Check if team composition changed (player sold)
      if (localCurrentPlayer) {
        const factorsChanged = checkIfFactorsChanged(localCurrentPlayer)
        const shouldUseAI = factorsChanged
        
        if (shouldUseAI) {
          console.log('[Analytics] Team composition changed - using OpenAI enhancement')
          const timeout = setTimeout(() => {
            timeoutRefs.current.delete(timeout)
            fetchAnalytics(true, true) // Use OpenAI if team composition changed (optional)
          }, 500)
          timeoutRefs.current.add(timeout)
        } else {
          // Use mathematical model (default) for purse updates
          const timeout = setTimeout(() => {
            timeoutRefs.current.delete(timeout)
            fetchAnalytics(true, false) // Use mathematical model (default)
          }, 500)
          timeoutRefs.current.add(timeout)
        }
      }
    },
    onBidUndo: (data) => {
      // Bid undone - DO NOT call OpenAI (just update bid count)
      setBidCountForCurrentPlayer(prev => Math.max(0, prev - 1))
      console.log('[Analytics] Bid undone - NOT calling OpenAI (cost optimization)')
      setLastBidTime(Date.now())
      // No analytics refresh needed - factors haven't changed
    },
    onSaleUndo: (data) => {
      // Sale undone - team composition changed, refresh with mathematical model (default)
      console.log('[Analytics] Sale undone - refreshing with mathematical model')
      setLastBidTime(Date.now())
      if (data.player) {
        const player = data.player as Player
        setLocalCurrentPlayer(player)
        onCurrentPlayerChange?.(player)
        // Reset counters
        setBidCountForCurrentPlayer(0)
        setLastOpenAICallTime(0)
        
        // Reset team composition hash to force refresh
        setLastTeamCompositionHash('')
        
        // Clear cache for the player
        const cacheKey = `${player.id}-${localAuction.id}`
        setAnalyticsCache(prev => {
          const newCache = new Map(prev)
          newCache.delete(cacheKey)
          return newCache
        })
        
        // Check if factors changed
        const factorsChanged = checkIfFactorsChanged(player)
        if (factorsChanged) {
          const timeout = setTimeout(() => {
            timeoutRefs.current.delete(timeout)
            fetchAnalytics(true, true) // Use OpenAI for sale undo (optional enhancement)
          }, 1000)
          timeoutRefs.current.add(timeout)
        } else {
          // Use mathematical model (default) if no factor changes
          const timeout = setTimeout(() => {
            timeoutRefs.current.delete(timeout)
            fetchAnalytics(true, false) // Use mathematical model (default)
          }, 500)
          timeoutRefs.current.add(timeout)
        }
      }
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

  // Calculate player stats
  const playerStats = useMemo(() => {
    if (!localCurrentPlayer) return null
    try {
      return calculatePlayerScoreFromData(localCurrentPlayer)
    } catch (error) {
      console.error('Error calculating player stats:', error)
      return null
    }
  }, [localCurrentPlayer])

  // Extract raw stats from player data
  const playerData = localCurrentPlayer?.data as any
  const rawStats = useMemo(() => {
    if (!playerData) return null
    return {
      matches: playerData?.Matches || playerData?.matches || 'N/A',
      runs: playerData?.Runs || playerData?.runs || 'N/A',
      avg: playerData?.Average || playerData?.Avg || playerData?.average || 'N/A',
      eco: playerData?.Economy || playerData?.Eco || playerData?.eco || 'N/A',
      wickets: playerData?.Wickets || playerData?.wickets || 'N/A',
      catches: playerData?.Catches || playerData?.catches || 'N/A',
      strength: playerData?.Strength || playerData?.strength || 'N/A'
    }
  }, [playerData])

  return (
    <div className="space-y-6">
      {/* Player Stats Card */}
      {(playerStats || rawStats) && (
        <Card className="border-2 border-purple-200 dark:border-purple-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5" />
              Player Statistics & Performance Analysis
            </CardTitle>
            <CardDescription>
              Performance metrics and stats-based scoring for {((localCurrentPlayer.data as any)?.Name || 'Current Player')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Raw Stats */}
              {rawStats && (
                <div>
                  <h3 className="text-sm font-semibold mb-3 text-gray-700 dark:text-gray-300">Performance Statistics</h3>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center py-2 border-b border-gray-200 dark:border-gray-700">
                      <span className="text-sm text-gray-600 dark:text-gray-400">Matches</span>
                      <span className="text-sm font-semibold">{rawStats.matches}</span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-gray-200 dark:border-gray-700">
                      <span className="text-sm text-gray-600 dark:text-gray-400">Runs</span>
                      <span className="text-sm font-semibold">{rawStats.runs}</span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-gray-200 dark:border-gray-700">
                      <span className="text-sm text-gray-600 dark:text-gray-400">Batting Average</span>
                      <span className="text-sm font-semibold">{rawStats.avg}</span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-gray-200 dark:border-gray-700">
                      <span className="text-sm text-gray-600 dark:text-gray-400">Economy Rate</span>
                      <span className="text-sm font-semibold">{rawStats.eco}</span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-gray-200 dark:border-gray-700">
                      <span className="text-sm text-gray-600 dark:text-gray-400">Wickets</span>
                      <span className="text-sm font-semibold">{rawStats.wickets}</span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-gray-200 dark:border-gray-700">
                      <span className="text-sm text-gray-600 dark:text-gray-400">Catches</span>
                      <span className="text-sm font-semibold">{rawStats.catches}</span>
                    </div>
                    {rawStats.strength !== 'N/A' && (
                      <div className="flex justify-between items-center py-2">
                        <span className="text-sm text-gray-600 dark:text-gray-400">Strength</span>
                        <span className="text-sm font-semibold">{rawStats.strength}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Calculated Scores */}
              {playerStats && (
                <div>
                  <h3 className="text-sm font-semibold mb-3 text-gray-700 dark:text-gray-300">Stats-Based Scoring</h3>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center py-2 border-b border-gray-200 dark:border-gray-700">
                      <span className="text-sm text-gray-600 dark:text-gray-400">Overall Rating</span>
                      <Badge variant="outline" className="text-sm font-semibold">
                        {playerStats.overallRating}/100
                      </Badge>
                    </div>
                    {playerStats.breakdown && (
                      <>
                        <div className="flex justify-between items-center py-2 border-b border-gray-200 dark:border-gray-700">
                          <span className="text-sm text-gray-600 dark:text-gray-400">Batting Score</span>
                          <span className="text-sm font-semibold">{playerStats.breakdown.battingScore}/100</span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-b border-gray-200 dark:border-gray-700">
                          <span className="text-sm text-gray-600 dark:text-gray-400">Bowling Score</span>
                          <span className="text-sm font-semibold">{playerStats.breakdown.bowlingScore}/100</span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-b border-gray-200 dark:border-gray-700">
                          <span className="text-sm text-gray-600 dark:text-gray-400">Experience Score</span>
                          <span className="text-sm font-semibold">{playerStats.breakdown.experienceScore}/100</span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-b border-gray-200 dark:border-gray-700">
                          <span className="text-sm text-gray-600 dark:text-gray-400">Form Score</span>
                          <span className="text-sm font-semibold">{playerStats.breakdown.formScore}/100</span>
                        </div>
                        {playerStats.breakdown.allrounderBonus > 0 && (
                          <div className="flex justify-between items-center py-2 border-b border-gray-200 dark:border-gray-700">
                            <span className="text-sm text-gray-600 dark:text-gray-400">Allrounder Bonus</span>
                            <Badge className="bg-green-600 text-white">+{playerStats.breakdown.allrounderBonus}</Badge>
                          </div>
                        )}
                        {playerStats.breakdown.keeperBonus > 0 && (
                          <div className="flex justify-between items-center py-2">
                            <span className="text-sm text-gray-600 dark:text-gray-400">Keeper Bonus</span>
                            <Badge className="bg-blue-600 text-white">+{playerStats.breakdown.keeperBonus}</Badge>
                          </div>
                        )}
                      </>
                    )}
                    <div className="mt-4 pt-4 border-t-2 border-purple-300 dark:border-purple-700">
                      <div className="flex justify-between items-center py-2">
                        <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Stats-Based Predicted Price</span>
                        <span className="text-lg font-bold text-purple-600 dark:text-purple-400">
                          ₹{playerStats.predictedPrice.toLocaleString('en-IN')}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Range: ₹{playerStats.minPrice.toLocaleString('en-IN')} - ₹{playerStats.maxPrice.toLocaleString('en-IN')}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

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
                  {(analytics.predictions.recommendedAction.suggestedBuyPrice || analytics.predictions.recommendedAction.recommendedBid) && (
                    <div className="mt-2 space-y-1">
                      {analytics.predictions.recommendedAction.suggestedBuyPrice && (
                        <>
                          <p className="text-lg font-semibold text-purple-600 dark:text-purple-400">
                            Suggested Buy Price: ₹{analytics.predictions.recommendedAction.suggestedBuyPrice.toLocaleString('en-IN')}
                          </p>
                          {/* Show warning if current bid exceeds suggested price */}
                          {analytics.predictions.marketAnalysis.highestBid > 0 && 
                           analytics.predictions.recommendedAction.suggestedBuyPrice && 
                           analytics.predictions.marketAnalysis.highestBid > analytics.predictions.recommendedAction.suggestedBuyPrice && (
                            <div className="mt-2 p-2 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded-lg">
                              <p className="text-sm font-semibold text-red-700 dark:text-red-300 flex items-center gap-1">
                                <AlertCircle className="w-4 h-4" />
                                ⚠️ Current Bid Exceeds Target
                              </p>
                              <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                                Current bid (₹{analytics.predictions.marketAnalysis.highestBid.toLocaleString('en-IN')}) is ₹{(analytics.predictions.marketAnalysis.highestBid - analytics.predictions.recommendedAction.suggestedBuyPrice).toLocaleString('en-IN')} above your suggested buy price
                              </p>
                            </div>
                          )}
                        </>
                      )}
                      {analytics.predictions.recommendedAction.recommendedBid && analytics.predictions.recommendedAction.action === 'bid' && (
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          Next Bid: ₹{analytics.predictions.recommendedAction.recommendedBid.toLocaleString('en-IN')}
                        </p>
                      )}
                    </div>
                  )}
                </div>
                <Badge variant="outline" className="text-lg px-4 py-2">
                  {Math.round(analytics.predictions.recommendedAction.confidence * 100)}% Confidence
                </Badge>
              </div>
              <p className="text-sm text-gray-700 dark:text-gray-300">
                {analytics.predictions.recommendedAction.reasoning}
              </p>
              <Button onClick={() => fetchAnalytics(true, false)} variant="outline" className="w-full">
                Refresh Analysis (Mathematical Model)
              </Button>
              <Button onClick={() => fetchAnalytics(true, true)} variant="outline" className="w-full mt-2">
                Refresh with AI Enhancement (Optional)
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
            Advanced probability model based on multiple factors: bidder priorities, purse balance, team needs, spending patterns, and bidding history
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
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Priority</th>
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
                      
                      // Get priority for this bidder-player combination
                      const currentPlayerName = (localCurrentPlayer?.data as any)?.Name || (localCurrentPlayer?.data as any)?.name || ''
                      let playerPriority: number | null = null
                      if (currentPlayerName && Object.keys(bidderPriorities).length > 0) {
                        const bidderKey = Object.keys(bidderPriorities).find(key => {
                          const keyLower = key.toLowerCase()
                          const bidderNameLower = bidderName.toLowerCase()
                          const teamNameLower = teamName.toLowerCase()
                          return keyLower === bidderNameLower || keyLower === teamNameLower
                        })
                        if (bidderKey && bidderPriorities[bidderKey]) {
                          playerPriority = bidderPriorities[bidderKey][currentPlayerName] || 
                                          bidderPriorities[bidderKey][currentPlayerName.toLowerCase()] ||
                                          bidderPriorities[bidderKey][(currentPlayerName.split(' ')[0] || '').toLowerCase()] ||
                                          null
                        }
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
                            {playerPriority ? (
                              <Badge 
                                variant={playerPriority <= 3 ? 'default' : playerPriority <= 6 ? 'secondary' : 'outline'}
                                className="text-xs"
                              >
                                #{playerPriority}
                              </Badge>
                            ) : (
                              <span className="text-gray-400 text-xs">-</span>
                            )}
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
                          <td className="px-4 py-3 max-w-md">
                            <p className="text-xs text-gray-600 dark:text-gray-400 whitespace-normal break-words">{bidder.reasoning || 'No analysis available'}</p>
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
                                  <div className="flex flex-col gap-1">
                                    <div className="flex flex-wrap gap-1">
                                      {team.needs && team.needs.length > 0 ? (
                                        team.needs.map((need: string, idx: number) => (
                                          <Badge key={idx} variant="outline" className="text-xs">
                                            {need}
                                          </Badge>
                                        ))
                                      ) : (
                                        <Badge variant="secondary" className="text-xs">Balanced Team</Badge>
                                      )}
                                    </div>
                                    {team.reasoning && (
                                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 whitespace-normal">
                                        {team.reasoning}
                                      </p>
                                    )}
                                    {(team as any).composition && (
                                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                        <span>Composition: {(team as any).composition.batters} batters, {(team as any).composition.bowlers} bowlers, {(team as any).composition.allrounders} allrounders</span>
                                        {(team as any).remainingSlots !== undefined && (
                                          <span> • {(team as any).remainingSlots} slots remaining</span>
                                        )}
                                        {(team as any).mustSpendPerSlot !== undefined && (
                                          <span> • Must spend ₹{(team as any).mustSpendPerSlot.toLocaleString('en-IN')}/slot</span>
                                        )}
                                      </div>
                                    )}
                                  </div>
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

      {/* Upcoming High-Value Players */}
      {analytics.predictions.upcomingHighValuePlayers && analytics.predictions.upcomingHighValuePlayers.length > 0 && (
        <Card className="border-2 border-yellow-200 dark:border-yellow-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              Upcoming High-Value Players
            </CardTitle>
            <CardDescription>
              Players with strong stats/ratings that haven't come up yet - consider saving budget for these
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Player</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Rating</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Predicted Price</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Predicted Speciality</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Predicted Stats</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Score</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Key Factors</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.predictions.upcomingHighValuePlayers
                    .sort((a, b) => b.brillianceScore - a.brillianceScore)
                    .map((player, index) => (
                      <tr
                        key={player.id}
                        className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">#{index + 1}</span>
                            <div className="flex flex-col">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-sm">{player.name}</span>
                                {player.isIcon && (
                                  <Badge variant="outline" className="text-xs bg-yellow-100 dark:bg-yellow-900 border-yellow-400">
                                    <Star className="w-3 h-3 mr-1" />
                                    Icon
                                  </Badge>
                                )}
                              </div>
                              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                {player.batting !== 'N/A' && player.batting} {player.batting !== 'N/A' && player.bowling !== 'N/A' && '•'} {player.bowling !== 'N/A' && player.bowling}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Badge variant="outline" className="text-sm font-semibold">
                            {player.overallRating}/100
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex flex-col">
                            <span className="font-semibold text-sm">₹{player.predictedPrice.toLocaleString('en-IN')}</span>
                            {player.minPrice > 0 && player.maxPrice > 0 && (
                              <span className="text-xs text-gray-500 dark:text-gray-400">
                                ₹{player.minPrice.toLocaleString('en-IN')} - ₹{player.maxPrice.toLocaleString('en-IN')}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Badge variant="secondary" className="text-xs">
                            {player.predictedSpeciality || player.speciality}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="text-xs text-gray-600 dark:text-gray-400 max-w-xs">
                            {player.predictedStats || 'N/A'}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex flex-col items-center">
                            <span className="text-sm font-bold text-yellow-600 dark:text-yellow-400">{player.brillianceScore}</span>
                            <div className="w-12 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full mt-1">
                              <div 
                                className="h-full rounded-full bg-yellow-500"
                                style={{ width: `${Math.min(100, (player.brillianceScore / 100) * 100)}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {player.factors.slice(0, 3).map((factor, idx) => (
                              <Badge key={idx} variant="outline" className="text-xs">
                                {factor}
                              </Badge>
                            ))}
                            {player.factors.length > 3 && (
                              <Badge variant="secondary" className="text-xs">
                                +{player.factors.length - 3} more
                              </Badge>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
              <p className="text-xs text-yellow-800 dark:text-yellow-200">
                <strong>Strategic Note:</strong> These players have high stats-based ratings and predicted prices. If you have significant remaining budget, consider saving for these players rather than overspending on the current player. The brilliance score indicates overall value (higher = more valuable).
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

