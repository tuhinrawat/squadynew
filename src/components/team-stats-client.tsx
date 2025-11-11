'use client'

import { useState, useEffect, useMemo } from 'react'
import { Auction, Player, Bidder, User } from '@prisma/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Users, Trophy, TrendingUp, Grid3x3, List, ChevronRight, User as UserIcon, Eye, ExternalLink } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { ActivityLog } from '@/components/activity-log'
import Link from 'next/link'
import { initializePusher } from '@/lib/pusher-client'

type BidderWithUser = Bidder & { user: { id: string; name: string | null; email: string | null } }
type AuctionWithRelations = Auction & {
  players: Player[]
  bidders: BidderWithUser[]
}

interface TeamStatsClientProps {
  auction: AuctionWithRelations
}

// IPL team colors mapping
const teamColors = [
  { from: 'from-yellow-400', to: 'to-orange-500', bg: 'bg-gradient-to-br from-yellow-400 to-orange-500' },
  { from: 'from-blue-500', to: 'to-blue-700', bg: 'bg-gradient-to-br from-blue-500 to-blue-700' },
  { from: 'from-teal-500', to: 'to-teal-700', bg: 'bg-gradient-to-br from-teal-500 to-teal-700' },
  { from: 'from-purple-500', to: 'to-purple-700', bg: 'bg-gradient-to-br from-purple-500 to-purple-700' },
  { from: 'from-orange-400', to: 'to-orange-600', bg: 'bg-gradient-to-br from-orange-400 to-orange-600' },
  { from: 'from-blue-600', to: 'to-blue-800', bg: 'bg-gradient-to-br from-blue-600 to-blue-800' },
  { from: 'from-red-500', to: 'to-red-700', bg: 'bg-gradient-to-br from-red-500 to-red-700' },
  { from: 'from-pink-500', to: 'to-purple-600', bg: 'bg-gradient-to-br from-pink-500 to-purple-600' },
  { from: 'from-gray-600', to: 'to-gray-800', bg: 'bg-gradient-to-br from-gray-600 to-gray-800' },
  { from: 'from-orange-500', to: 'to-red-600', bg: 'bg-gradient-to-br from-orange-500 to-red-600' },
]

export function TeamStatsClient({ auction: initialAuction }: TeamStatsClientProps) {
  const [auction, setAuction] = useState(initialAuction)
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'sold' | 'unsold' | 'know'>('overview')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [bidModalPlayer, setBidModalPlayer] = useState<Player | null>(null)
  const [bidModalItems, setBidModalItems] = useState<any[]>([])
  const [fullScreenImage, setFullScreenImage] = useState<string | null>(null)
  const [playerFilter, setPlayerFilter] = useState<'all' | 'batsmen' | 'bowlers' | 'all-rounders' | 'bidders'>('all')

  // Subscribe to real-time updates with incremental updates (no API calls - millisecond latency)
  useEffect(() => {
    const pusher = initializePusher()
    const channel = pusher.subscribe(`auction-${auction.id}`)

    channel.bind('player-sold', (data: { 
      playerId: string
      bidderId: string
      amount: number
      playerName: string
      updatedBidders?: Array<{ id: string; remainingPurse: number }>
    }) => {
      // Update auction state instantly from Pusher data (no API call - ~0ms latency)
      setAuction(prev => {
        const updated = { ...prev }
        // Update player status instantly
        updated.players = prev.players.map(p => 
          p.id === data.playerId 
            ? { ...p, status: 'SOLD' as const, soldTo: data.bidderId, soldPrice: data.amount }
            : p
        )
        // Update bidder purse instantly if provided
        if (data.updatedBidders) {
          updated.bidders = prev.bidders.map(b => {
            const update = data.updatedBidders!.find(ub => ub.id === b.id)
            return update ? { ...b, remainingPurse: update.remainingPurse } : b
          })
        }
        return updated
      })
    })

    channel.bind('players-updated', (data: { 
      players?: any[]
      bidders?: Array<{ id: string; remainingPurse: number }>
    }) => {
      // Update from Pusher data if available (no API call - ~0ms latency)
      if (data.players || data.bidders) {
        setAuction(prev => {
          const updated = { ...prev }
          if (data.players) {
            updated.players = prev.players.map(p => {
              const update = data.players!.find(up => up.id === p.id)
              return update || p
            })
          }
          if (data.bidders) {
            updated.bidders = prev.bidders.map(b => {
              const update = data.bidders!.find(ub => ub.id === b.id)
              return update ? { ...b, remainingPurse: update.remainingPurse } : b
            })
          }
          return updated
        })
      }
    })

    return () => {
      channel.unbind_all()
      pusher.unsubscribe(`auction-${auction.id}`)
    }
  }, [auction.id])

  // Helper functions - must be defined before use
  const getPlayerName = (player: Player) => {
    const data = player.data as any
    return data?.name || data?.Name || data?.player_name || 'Unknown Player'
  }

  function getProfilePhotoUrl(playerData: any): string | undefined {
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
  }

  // Get bidder photo - checks retired player data first, then logoUrl
  const getBidderPhotoUrl = (bidder: BidderWithUser) => {
    // First check if bidder has a logoUrl set
    if (bidder.logoUrl) return bidder.logoUrl
    
    // Check if this bidder was created from a retired player
    // Match by username or user email
    const retiredPlayer = auction.players.find(p => {
      if (p.status !== 'RETIRED') return false
      const playerData = p.data as any
      const playerName = (playerData?.name || playerData?.Name || playerData?.player_name || '').toLowerCase()
      const bidderName = (bidder.username || '').toLowerCase()
      const bidderEmail = (bidder.user?.email || '').toLowerCase()
      
      return playerName === bidderName || 
             playerName === bidderEmail ||
             playerName.includes(bidderName) ||
             playerName.includes(bidderEmail.split('@')[0])
    })
    
    if (retiredPlayer) {
      const photoUrl = getProfilePhotoUrl(retiredPlayer.data as any)
      if (photoUrl) return photoUrl
    }
    
    return undefined
  }

  // Calculate team data
  const teamsData = auction.bidders.map((bidder, index) => {
    const teamPlayers = auction.players.filter(p => p.soldTo === bidder.id)
    const soldPlayers = teamPlayers.filter(p => p.status === 'SOLD')
    const totalSpent = soldPlayers.reduce((sum, p) => sum + (p.soldPrice || 0), 0)
    const remainingPurse = bidder.remainingPurse
    const rules = (auction.rules as any) || {}
    const mandatoryTeamSize = Number.isFinite(rules.mandatoryTeamSize) ? Number(rules.mandatoryTeamSize) : 12
    const minPerPlayerReserve = Number.isFinite(rules.minPerPlayerReserve) ? Number(rules.minPerPlayerReserve) : 1000
    // Bidder counts as 1 player in the squad, so they need to buy (mandatoryTeamSize - 1) players
    const remainingSlots = Math.max(0, (mandatoryTeamSize - 1) - soldPlayers.length)
    
    // Calculate maximum spendable based on purse reinforcement logic
    const requiredReserve = remainingSlots * minPerPlayerReserve
    const maxSpendableNow = Math.max(0, remainingPurse - requiredReserve)

    return {
      id: bidder.id,
      name: bidder.teamName || bidder.username,
      logo: getBidderPhotoUrl(bidder),
      remainingPurse,
      totalPlayers: soldPlayers.length,
      players: soldPlayers,
      remainingSlots,
      maxSpendableNow,
      requiredReserve,
      colorScheme: teamColors[index % teamColors.length],
      bidder: bidder // Include the full bidder object
    }
  })

  const sortedPlayers = useMemo(() => {
    return [...auction.players].sort((a, b) => getPlayerName(a).localeCompare(getPlayerName(b)))
  }, [auction.players])

  const playerCards = useMemo(() => {
    return sortedPlayers.map(player => {
      const playerData = player.data as any
      const imageUrl = getProfilePhotoUrl(playerData)
      const bidder = auction.bidders.find(b => b.id === player.soldTo)
      const basePriceRaw = playerData?.['Base Price'] || playerData?.['base price']
      const basePrice = basePriceRaw ? Number(basePriceRaw) : 1000
      const specialty = playerData?.Speciality || playerData?.speciality || playerData?.specialty
      const role = playerData?.Role || playerData?.role || ''
      const statsSummary = [
        role,
        playerData?.Batting || playerData?.batting,
        playerData?.Bowling || playerData?.bowling
      ].filter(Boolean).join(' • ')
      const cricherosLink = playerData?.['Cricheros Profile'] || playerData?.['cricheros profile'] || playerData?.['Cricheros Link'] || playerData?.['cricheros_profile']
      const isBidder = player.status === 'RETIRED'
      const statusLabel = (() => {
        if (player.status === 'SOLD') {
          return `Sold to ${bidder ? (bidder.teamName || bidder.username) : 'Unknown team'}`
        }
        if (player.status === 'UNSOLD') {
          return 'Unsold'
        }
        if (isBidder) {
          return 'Bidder'
        }
        return 'Available'
      })()

      return {
        id: player.id,
        name: getPlayerName(player),
        imageUrl,
        statusLabel,
        isBidder,
        teamDisplay: player.status === 'SOLD'
          ? bidder ? (bidder.teamName || bidder.username) : 'Sold'
          : 'Available in pool',
        specialty,
        role,
        statsSummary,
        purchasedPrice: player.status === 'SOLD' ? (player.soldPrice || 0) : null,
        basePrice: basePrice,
        cricherosLink,
      }
    })
  }, [sortedPlayers, auction.bidders])

  // Filter players based on selected filter
  const filteredPlayerCards = useMemo(() => {
    if (playerFilter === 'all') {
      return playerCards
    }
    
    return playerCards.filter(card => {
      const roleStr = (card.role || '').toLowerCase()
      const specialtyStr = (card.specialty || '').toLowerCase()
      
      switch (playerFilter) {
        case 'batsmen':
          return roleStr.includes('batsman') || roleStr.includes('batter') || specialtyStr.includes('batsman') || specialtyStr.includes('batter')
        case 'bowlers':
          return roleStr.includes('bowler') || specialtyStr.includes('bowler')
        case 'all-rounders':
          return roleStr.includes('all-rounder') || roleStr.includes('allrounder') || roleStr.includes('all rounder') || specialtyStr.includes('all-rounder') || specialtyStr.includes('allrounder')
        case 'bidders':
          return card.isBidder
        default:
          return true
      }
    })
  }, [playerCards, playerFilter])

  const selectedTeamData = selectedTeam 
    ? teamsData.find(t => t.id === selectedTeam)
    : null

  // Filter players based on active tab
  const getFilteredPlayers = () => {
    if (selectedTeamData) {
      return selectedTeamData.players
    }

    switch (activeTab) {
      case 'sold':
        return auction.players.filter(p => p.status === 'SOLD')
      case 'unsold':
        return auction.players.filter(p => p.status === 'UNSOLD')
      default:
        return []
    }
  }

  const openPlayerBids = async (player: Player) => {
    setBidModalPlayer(player)
    try {
      const res = await fetch(`/api/auction/${auction.id}/player/${player.id}/bids`)
      const data = await res.json()
      if (data.bids) setBidModalItems(data.bids)
      else setBidModalItems([])
    } catch {
      setBidModalItems([])
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900">
      {/* Header */}
      <div className="bg-white/10 backdrop-blur-md border-b border-white/20 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-3 sm:py-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            {/* Top row on mobile: Back button and view toggle */}
            <div className="flex items-center justify-between gap-2">
              <Link href={`/auction/${auction.id}`}>
                <Button variant="ghost" size="sm" className="text-white hover:bg-white/20 px-2 sm:px-3">
                  <ArrowLeft className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">{selectedTeam ? 'Back to Teams' : 'Back to Auction'}</span>
                </Button>
              </Link>

              {!selectedTeam && (
                <div className="flex items-center gap-1 sm:hidden">
                  <Button
                    variant={viewMode === 'grid' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setViewMode('grid')}
                    className={`${viewMode === 'grid' ? 'bg-white text-blue-900' : 'text-white hover:bg-white/20'} px-2`}
                  >
                    <Grid3x3 className="h-4 w-4" />
                  </Button>
                  <Button
                    variant={viewMode === 'list' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setViewMode('list')}
                    className={`${viewMode === 'list' ? 'bg-white text-blue-900' : 'text-white hover:bg-white/20'} px-2`}
                  >
                    <List className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>

            {/* Title row */}
            <div className="flex items-center justify-between sm:flex-1 gap-2">
              <div className="min-w-0 flex-1">
                <h1 className="text-lg sm:text-2xl font-bold text-white truncate">
                  {selectedTeamData ? selectedTeamData.name : 'Team Statistics'}
                </h1>
                <p className="text-xs sm:text-sm text-white/70 truncate">{auction.name}</p>
              </div>

              {!selectedTeam && (
                <div className="hidden sm:flex items-center gap-2">
                  <Button
                    variant={viewMode === 'grid' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setViewMode('grid')}
                    className={viewMode === 'grid' ? 'bg-white text-blue-900' : 'text-white hover:bg-white/20'}
                  >
                    <Grid3x3 className="h-4 w-4" />
                  </Button>
                  <Button
                    variant={viewMode === 'list' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setViewMode('list')}
                    className={viewMode === 'list' ? 'bg-white text-blue-900' : 'text-white hover:bg-white/20'}
                  >
                    <List className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-8">
        {!selectedTeam ? (
          <>
            {/* Tabs - Scrollable on mobile */}
            <div className="flex gap-2 mb-4 sm:mb-6 overflow-x-auto pb-2 scrollbar-hide -mx-3 px-3 sm:mx-0 sm:px-0">
              <Button
                variant={activeTab === 'overview' ? 'default' : 'ghost'}
                onClick={() => setActiveTab('overview')}
                className={`${activeTab === 'overview' ? 'bg-white text-blue-900' : 'text-white hover:bg-white/20'} flex-shrink-0 text-xs sm:text-sm px-3 sm:px-4`}
              >
                <Trophy className="h-3 w-3 sm:h-4 sm:w-4 sm:mr-2" />
                <span className="hidden sm:inline">Overview</span>
              </Button>
              <Button
                variant={activeTab === 'sold' ? 'default' : 'ghost'}
                onClick={() => setActiveTab('sold')}
                className={`${activeTab === 'sold' ? 'bg-white text-blue-900' : 'text-white hover:bg-white/20'} flex-shrink-0 text-xs sm:text-sm px-3 sm:px-4`}
              >
                <span className="sm:hidden">Sold ({auction.players.filter(p => p.status === 'SOLD').length})</span>
                <span className="hidden sm:inline">Sold Players ({auction.players.filter(p => p.status === 'SOLD').length})</span>
              </Button>
              <Button
                variant={activeTab === 'unsold' ? 'default' : 'ghost'}
                onClick={() => setActiveTab('unsold')}
                className={`${activeTab === 'unsold' ? 'bg-white text-blue-900' : 'text-white hover:bg-white/20'} flex-shrink-0 text-xs sm:text-sm px-3 sm:px-4`}
              >
                <span className="sm:hidden">Unsold ({auction.players.filter(p => p.status === 'UNSOLD').length})</span>
                <span className="hidden sm:inline">Unsold Players ({auction.players.filter(p => p.status === 'UNSOLD').length})</span>
              </Button>
              <Button
                variant={activeTab === 'know' ? 'default' : 'ghost'}
                onClick={() => setActiveTab('know')}
                className={`${activeTab === 'know' ? 'bg-white text-blue-900' : 'text-white hover:bg-white/20'} flex-shrink-0 text-xs sm:text-sm px-3 sm:px-4`}
              >
                <Eye className="h-3 w-3 sm:h-4 sm:w-4 sm:mr-2" />
                <span className="hidden sm:inline">Know Your Players</span>
                <span className="sm:hidden">Players</span>
              </Button>
            </div>

            {/* Teams Grid/List */}
            {activeTab === 'overview' && (
              viewMode === 'grid' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
                  {teamsData.map((team) => (
                    <Card
                      key={team.id}
                      className={`${team.colorScheme.bg} border-0 shadow-2xl hover:scale-105 transition-transform cursor-pointer overflow-hidden`}
                      onClick={() => setSelectedTeam(team.id)}
                    >
                      <CardContent className="p-3 sm:p-6 text-white">
                        {/* Header: Logo + Team Name */}
                        <div className="flex items-center gap-2 sm:gap-3 mb-2 sm:mb-4 pb-2 sm:pb-3 border-b border-white/30">
                          <div className="w-10 h-10 sm:w-16 sm:h-16 rounded-full bg-white flex items-center justify-center shadow-lg flex-shrink-0">
                            {team.logo ? (
                              <img src={team.logo} alt={team.name} className="w-7 h-7 sm:w-12 sm:h-12 object-contain" />
                            ) : (
                              <span className="text-base sm:text-2xl font-bold text-gray-800">
                                {team.name.charAt(0)}
                              </span>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-bold text-sm sm:text-lg truncate">{team.name}</h3>
                            <p className="text-[10px] sm:text-xs opacity-75 truncate">
                              {team.bidder?.user?.name || team.bidder?.username || 'Unknown'}
                            </p>
                          </div>
                        </div>

                        {/* Key-Value Pairs - Ultra Compact */}
                        <div className="space-y-1.5 sm:space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] sm:text-sm text-white/90 font-medium">Funds Remaining</span>
                            <span className="text-sm sm:text-xl font-bold text-white drop-shadow-lg">₹{team.remainingPurse.toLocaleString('en-IN')}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] sm:text-sm text-white/90 font-medium">Total Players</span>
                            <span className="text-sm sm:text-lg font-semibold text-white drop-shadow-lg">{team.totalPlayers}</span>
                          </div>
                          <div className="flex items-center justify-between bg-black/20 -mx-2 px-2 py-1 rounded">
                            <span className="text-[11px] sm:text-sm text-white font-semibold">Max Spend Now</span>
                            <span className="text-sm sm:text-lg font-bold text-lime-300 drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
                              {team.remainingSlots > 0
                                ? `₹${team.maxSpendableNow.toLocaleString('en-IN')}`
                                : 'Team Full'}
                            </span>
                          </div>
                          <div className="flex items-center justify-between bg-black/20 -mx-2 px-2 py-1 rounded">
                            <span className="text-[11px] sm:text-sm text-white/90 font-medium">Reserved ({team.remainingSlots} slots)</span>
                            <span className="text-sm sm:text-base font-semibold text-orange-300 drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
                              {team.remainingSlots > 0
                                ? `₹${team.requiredReserve.toLocaleString('en-IN')}`
                                : 'N/A'}
                            </span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="space-y-3 sm:space-y-4">
                  {teamsData.map((team) => (
                    <Card
                      key={team.id}
                      className="bg-white/10 backdrop-blur-md border-white/20 hover:bg-white/20 transition-colors cursor-pointer"
                      onClick={() => setSelectedTeam(team.id)}
                    >
                      <CardContent className="p-4 sm:p-6">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 sm:gap-4 min-w-0 flex-1">
                            <div className={`w-12 h-12 sm:w-16 sm:h-16 rounded-full ${team.colorScheme.bg} flex items-center justify-center shadow-lg flex-shrink-0`}>
                              {team.logo ? (
                                <img src={team.logo} alt={team.name} className="w-8 h-8 sm:w-12 sm:h-12 object-contain" />
                              ) : (
                                <span className="text-lg sm:text-2xl font-bold text-white">
                                  {team.name.charAt(0)}
                                </span>
                              )}
                            </div>
                            <div className="min-w-0">
                              <h3 className="text-base sm:text-xl font-bold text-white truncate">{team.name}</h3>
                              <p className="text-[10px] sm:text-xs text-white/60 truncate mb-0.5">
                                Bidder: {team.bidder?.user?.name || team.bidder?.username || 'Unknown'}
                              </p>
                              <p className="text-xs sm:text-sm text-white font-medium truncate drop-shadow-md">
                                ₹{team.remainingPurse.toLocaleString('en-IN')} remaining
                              </p>
                              <p className="text-[10px] sm:text-xs text-lime-300 font-bold truncate drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
                                Max Spend: {team.remainingSlots > 0
                                  ? `₹${team.maxSpendableNow.toLocaleString('en-IN')}`
                                  : 'Team Full'}
                              </p>
                              <p className="text-[10px] sm:text-xs text-orange-300 font-semibold truncate drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
                                Reserved: {team.remainingSlots > 0
                                  ? `₹${team.requiredReserve.toLocaleString('en-IN')} (${team.remainingSlots} slots)`
                                  : 'N/A'}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 sm:gap-6 text-white">
                            <div className="text-center">
                              <p className="text-[10px] sm:text-sm opacity-75">Players</p>
                              <p className="text-lg sm:text-2xl font-bold">{team.totalPlayers}</p>
                            </div>
                            <ChevronRight className="h-5 w-5 sm:h-6 sm:w-6 opacity-50 flex-shrink-0" />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )
            )}

            {/* IPL-Style Sold Players Summary */}
            {activeTab === 'sold' && (() => {
              const soldPlayers = auction.players.filter(p => p.status === 'SOLD')
              const bidHistory = (auction as any).bidHistory || []
              
              // Calculate categories
              const topBuys = [...soldPlayers]
                .sort((a, b) => (b.soldPrice || 0) - (a.soldPrice || 0))
                .slice(0, 20)
              
              // Top 5 Bidders - bidders who spent the most total
              const bidderSpending = auction.bidders.map(bidder => {
                const playersBought = soldPlayers.filter(p => p.soldTo === bidder.id)
                const totalSpent = playersBought.reduce((sum, p) => sum + (p.soldPrice || 0), 0)
                const avgSpent = playersBought.length > 0 ? totalSpent / playersBought.length : 0
                return { bidder, totalSpent, playersBought: playersBought.length, avgSpent }
              })
              const topBidders = bidderSpending
                .filter(b => b.totalSpent > 0)
                .sort((a, b) => b.totalSpent - a.totalSpent)
                .slice(0, 5)
              
              // Most competitive - players with most bids
              const playerBidCounts = soldPlayers.map(player => {
                const bidsForPlayer = bidHistory.filter((b: any) => 
                  b.playerId === player.id && b.type === 'bid'
                ).length
                return { player, bidCount: bidsForPlayer }
              })
              const mostCompetitive = playerBidCounts
                .filter(p => p.bidCount > 0)
                .sort((a, b) => b.bidCount - a.bidCount)
                .slice(0, 5)
              
              // Most active bidder
              const bidderActivity = auction.bidders.map(bidder => {
                const bidsCount = bidHistory.filter((b: any) => 
                  b.bidderId === bidder.id && b.type === 'bid'
                ).length
                const playersWon = soldPlayers.filter(p => p.soldTo === bidder.id).length
                return { bidder, bidsCount, playersWon }
              })
              const mostActiveBidders = bidderActivity
                .filter(b => b.bidsCount > 0)
                .sort((a, b) => b.bidsCount - a.bidsCount)
                .slice(0, 5)
              
              const renderBidderPortraitCard = (bidderData: typeof topBidders[0], rank: number) => {
                const bidder = bidderData.bidder
                const teamData = teamsData.find(t => t.id === bidder.id)
                
                return (
                  <div key={bidder.id} className="group relative bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950 rounded-2xl overflow-hidden border-2 border-white/20 hover:border-purple-400/50 transition-all hover:scale-[1.02] shadow-xl max-w-md mx-auto w-full">
                    {/* TOP BIDDER Badge */}
                    <div className="absolute top-2 right-2 sm:top-4 sm:right-4 z-20">
                      <div className="bg-gradient-to-r from-purple-500 to-pink-600 text-white px-2 py-1 sm:px-4 sm:py-2 rounded-lg font-black text-[10px] sm:text-base shadow-lg rotate-12 border-2 border-white/30">
                        TOP BIDDER
                      </div>
                    </div>
                    
                    {/* Rank Badge */}
                    <div className="absolute top-2 left-2 sm:top-4 sm:left-4 z-20 w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-gradient-to-br from-purple-400 to-pink-500 flex items-center justify-center text-white font-black text-lg sm:text-xl border-4 border-slate-900 shadow-lg">
                      {rank}
                    </div>
                    
                    {/* Bidder Photo/Logo */}
                    <div className="relative h-56 sm:h-64 bg-gradient-to-b from-purple-700 to-slate-900 flex items-center justify-center">
                      {teamData?.logo ? (
                        <img 
                          src={teamData.logo}
                          alt={bidder.teamName || bidder.username}
                          className="w-full h-full object-contain p-2"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement
                            target.style.display = 'none'
                          }}
                        />
                      ) : (
                        <div className="w-28 h-28 sm:w-32 sm:h-32 rounded-full bg-white/20 flex items-center justify-center">
                          <UserIcon className="h-14 w-14 sm:h-16 sm:w-16 text-white/50" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-transparent to-transparent" />
                    </div>
                    
                    {/* Bidder Info */}
                    <div className="p-3 sm:p-4 space-y-2 sm:space-y-3">
                      {/* Team Name */}
                      <div>
                        <h4 className="text-white font-black text-base sm:text-xl truncate">{bidder.teamName || bidder.username}</h4>
                        <p className="text-purple-400 text-xs sm:text-sm font-bold truncate">{bidder.user?.name || 'Bidder'}</p>
                      </div>
                      
                      {/* Stats Grid */}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-purple-500/20 border border-purple-400/30 rounded-lg px-2 py-1.5 sm:py-2">
                          <p className="text-purple-300 text-[9px] sm:text-[10px] font-semibold">SPENT</p>
                          <p className="text-white text-xs sm:text-sm font-bold break-words">₹{bidderData.totalSpent.toLocaleString('en-IN')}</p>
                        </div>
                        <div className="bg-pink-500/20 border border-pink-400/30 rounded-lg px-2 py-1.5 sm:py-2">
                          <p className="text-pink-300 text-[9px] sm:text-[10px] font-semibold">PLAYERS</p>
                          <p className="text-white text-xs sm:text-sm font-bold">{bidderData.playersBought}</p>
                        </div>
                      </div>
                      
                      {/* Average per Player */}
                      <div className="bg-gradient-to-r from-purple-600 to-pink-600 rounded-lg p-2 sm:p-3 text-center border-2 border-purple-400/30">
                        <p className="text-purple-200 text-[10px] sm:text-xs font-semibold">AVG PER PLAYER</p>
                        <p className="text-white font-black text-lg sm:text-2xl break-words">₹{Math.round(bidderData.avgSpent).toLocaleString('en-IN')}</p>
                      </div>
                      
                      {/* Remaining Purse */}
                      <div className="bg-white/5 rounded-lg p-2 border border-white/10">
                        <div className="flex items-center justify-between">
                          <span className="text-white/60 text-[10px] sm:text-xs">Remaining</span>
                          <span className="text-green-400 font-bold text-xs sm:text-sm break-words">₹{bidder.remainingPurse.toLocaleString('en-IN')}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              }

              const renderPortraitCard = (player: Player, showBids: boolean = false, bidCount?: number) => {
                const bidder = auction.bidders.find(b => b.id === player.soldTo)
                const playerData = player.data as any
                const imageUrl = getProfilePhotoUrl(playerData)
                
                // Get player role/status
                const specialty = playerData?.Speciality || playerData?.speciality || playerData?.specialty
                const battingType = playerData?.['Batting Type'] || playerData?.['batting type'] || playerData?.Batting || playerData?.batting
                const bowlingType = playerData?.['Bowling Type'] || playerData?.['bowling type'] || playerData?.Bowling || playerData?.bowling
                
                return (
                  <div key={player.id} className="group relative bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950 rounded-2xl overflow-hidden border-2 border-white/20 hover:border-yellow-400/50 transition-all hover:scale-[1.02] shadow-xl max-w-md mx-auto w-full">
                    {/* SOLD Stamp */}
                    <div className="absolute top-2 right-2 sm:top-4 sm:right-4 z-20">
                      <div className="bg-gradient-to-r from-green-500 to-emerald-600 text-white px-2 py-1 sm:px-4 sm:py-2 rounded-lg font-black text-[10px] sm:text-base shadow-lg rotate-12 border-2 border-white/30">
                        SOLD
                      </div>
                    </div>
                    
                    {/* Bid Count Badge */}
                    {showBids && bidCount && (
                      <div className="absolute top-2 left-2 sm:top-4 sm:left-4 z-20 bg-orange-500 text-white px-2 py-0.5 sm:px-3 sm:py-1 rounded-full font-bold text-[10px] sm:text-sm border-2 border-white/30 shadow-lg">
                        {bidCount} bids
                      </div>
                    )}
                    
                    {/* Player Photo */}
                    <div className="relative h-56 sm:h-64 bg-gradient-to-b from-slate-700 to-slate-900 flex items-center justify-center">
                      {imageUrl ? (
                        <img 
                          src={imageUrl}
                          alt={getPlayerName(player)}
                          className="w-full h-full object-contain p-2"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement
                            target.style.display = 'none'
                          }}
                        />
                      ) : (
                        <div className="w-28 h-28 sm:w-32 sm:h-32 rounded-full bg-white/20 flex items-center justify-center">
                          <UserIcon className="h-14 w-14 sm:h-16 sm:w-16 text-white/50" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-transparent to-transparent" />
                    </div>
                    
                    {/* Player Info */}
                    <div className="p-3 sm:p-4 space-y-2 sm:space-y-3">
                      {/* Player Name */}
                      <div>
                        <h4 className="text-white font-black text-base sm:text-xl truncate">{getPlayerName(player)}</h4>
                        {specialty && (
                          <p className="text-yellow-400 text-[10px] sm:text-sm font-bold uppercase tracking-wide truncate">{specialty}</p>
                        )}
                      </div>
                      
                      {/* Player Stats */}
                      <div className="space-y-1.5">
                        {battingType && (
                          <div className="bg-blue-500/20 border border-blue-400/30 rounded-lg px-2 py-1.5">
                            <p className="text-blue-300 text-[9px] sm:text-[10px] font-semibold mb-0.5">BAT</p>
                            <p className="text-white text-[10px] sm:text-[11px] font-bold leading-tight break-words">{battingType}</p>
                          </div>
                        )}
                        {bowlingType && (
                          <div className="bg-red-500/20 border border-red-400/30 rounded-lg px-2 py-1.5">
                            <p className="text-red-300 text-[9px] sm:text-[10px] font-semibold mb-0.5">BOWL</p>
                            <p className="text-white text-[10px] sm:text-[11px] font-bold leading-tight break-words">{bowlingType}</p>
                          </div>
                        )}
                      </div>
                      
                      {/* Price */}
                      <div className="bg-gradient-to-r from-green-600 to-emerald-600 rounded-lg p-2 sm:p-3 text-center border-2 border-green-400/30">
                        <p className="text-green-200 text-[10px] sm:text-xs font-semibold">SOLD FOR</p>
                        <p className="text-white font-black text-xl sm:text-3xl break-words">₹{(player.soldPrice || 0).toLocaleString('en-IN')}</p>
                      </div>
                      
                      {/* Team & Bidder Info */}
                      <div className="space-y-1 bg-white/5 rounded-lg p-2 border border-white/10">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-white/60 text-[10px] sm:text-xs flex-shrink-0">Team</span>
                          <span className="text-white font-bold text-[10px] sm:text-sm truncate">{bidder ? bidder.teamName || bidder.username : 'No Team'}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-white/60 text-[10px] sm:text-xs flex-shrink-0">Bidder</span>
                          <span className="text-white/80 text-[10px] sm:text-xs truncate">{bidder?.user?.name || bidder?.username || '-'}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              }
              
              return (
                <div className="space-y-6">
                  {/* Top 20 Buys */}
                  {topBuys.length > 0 && (
                    <Card className="bg-gradient-to-br from-yellow-600/20 via-orange-600/20 to-red-600/20 backdrop-blur-md border-2 border-yellow-500/30">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-yellow-400">
                          <Trophy className="h-5 w-5" />
                          <span className="text-lg sm:text-xl">💰 Top 20 Buys</span>
                        </CardTitle>
                        <p className="text-white/60 text-xs sm:text-sm">Most expensive players in the auction</p>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 max-w-7xl mx-auto">
                          {topBuys.map((player, idx) => (
                            <div key={player.id} className="relative">
                              {/* Rank Badge */}
                              <div className="absolute -top-2 -left-2 z-30 w-10 h-10 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center text-white font-black text-sm border-4 border-slate-900 shadow-lg">
                                {idx + 1}
                              </div>
                              {renderPortraitCard(player)}
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                  
                  {/* Most Competitive */}
                  {mostCompetitive.length > 0 && (
                    <Card className="bg-gradient-to-br from-red-600/20 via-pink-600/20 to-purple-600/20 backdrop-blur-md border-2 border-red-500/30">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-red-400">
                          <TrendingUp className="h-5 w-5" />
                          <span className="text-lg sm:text-xl">🔥 Most Competitive</span>
                        </CardTitle>
                        <p className="text-white/60 text-xs sm:text-sm">Players who attracted the most bids</p>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 max-w-7xl mx-auto">
                          {mostCompetitive.map(({ player, bidCount }) => renderPortraitCard(player, true, bidCount))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                  
                  {/* Most Active Bidders */}
                  {mostActiveBidders.length > 0 && (
                    <Card className="bg-gradient-to-br from-blue-600/20 via-indigo-600/20 to-purple-600/20 backdrop-blur-md border-2 border-blue-500/30">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-blue-400">
                          <Users className="h-5 w-5" />
                          <span className="text-lg sm:text-xl">⚡ Most Active Bidders</span>
                        </CardTitle>
                        <p className="text-white/60 text-xs sm:text-sm">Bidders with highest participation</p>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {mostActiveBidders.map(({ bidder, bidsCount, playersWon }, idx) => (
                            <div key={bidder.id} className="group relative bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950 rounded-xl p-4 border-2 border-white/10 hover:border-blue-400/50 transition-all">
                              <div className="absolute -top-3 -left-3 w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white font-bold border-4 border-slate-900">
                                {idx + 1}
                              </div>
                              <div className="ml-6">
                                <h4 className="text-white font-bold text-base sm:text-lg">{bidder.teamName || bidder.username}</h4>
                                <div className="mt-2 space-y-1">
                                  <div className="flex items-center justify-between">
                                    <span className="text-white/60 text-xs sm:text-sm">Total Bids</span>
                                    <span className="text-blue-400 font-bold text-lg">{bidsCount}</span>
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <span className="text-white/60 text-xs sm:text-sm">Players Won</span>
                                    <span className="text-green-400 font-bold text-lg">{playersWon}</span>
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <span className="text-white/60 text-xs sm:text-sm">Success Rate</span>
                                    <span className="text-purple-400 font-bold text-sm">
                                      {bidsCount > 0 ? Math.round((playersWon / bidsCount) * 100) : 0}%
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                  
                  {/* Top 5 Bidders */}
                  {topBidders.length > 0 && (
                    <Card className="bg-gradient-to-br from-purple-600/20 via-pink-600/20 to-rose-600/20 backdrop-blur-md border-2 border-purple-500/30">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-purple-400">
                          <Trophy className="h-5 w-5" />
                          <span className="text-lg sm:text-xl">👑 Top 5 Bidders</span>
                        </CardTitle>
                        <p className="text-white/60 text-xs sm:text-sm">Biggest spenders of the auction</p>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 max-w-7xl mx-auto">
                          {topBidders.map((bidderData, idx) => renderBidderPortraitCard(bidderData, idx + 1))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                  
                  {/* Complete Sold Players Table */}
                  {soldPlayers.length > 0 && (
              <Card className="bg-white/10 backdrop-blur-md border-white/20">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-white">
                          <List className="h-5 w-5" />
                          <span className="text-lg sm:text-xl">📋 All Sold Players ({soldPlayers.length})</span>
                        </CardTitle>
                        <p className="text-white/60 text-xs sm:text-sm">Complete list of all players sold in this auction</p>
                      </CardHeader>
                <CardContent className="p-3 sm:p-6">
                  <div className="overflow-x-auto scrollbar-hide">
                    <table className="w-full min-w-[650px]">
                      <thead>
                        <tr className="border-b border-white/20">
                                <th className="text-left py-2 sm:py-3 px-2 text-white font-semibold text-xs sm:text-sm w-12 sm:w-16">#</th>
                          <th className="text-left py-2 sm:py-3 px-2 text-white font-semibold text-xs sm:text-sm w-12 sm:w-16">Photo</th>
                          <th className="text-left py-2 sm:py-3 px-2 sm:px-4 text-white font-semibold text-xs sm:text-sm">Player Name</th>
                          <th className="text-left py-2 sm:py-3 px-2 sm:px-4 text-white font-semibold text-xs sm:text-sm">Team</th>
                          <th className="text-left py-2 sm:py-3 px-2 sm:px-4 text-white font-semibold text-xs sm:text-sm">Bidder</th>
                            <th className="text-right py-2 sm:py-3 px-2 sm:px-4 text-white font-semibold text-xs sm:text-sm">Price</th>
                        </tr>
                      </thead>
                      <tbody>
                              {[...soldPlayers]
                                .sort((a, b) => (b.soldPrice || 0) - (a.soldPrice || 0))
                                .map((player, idx) => {
                          const bidder = auction.bidders.find(b => b.id === player.soldTo)
                          const playerData = player.data as any
                          const imageUrl = getProfilePhotoUrl(playerData)
                          return (
                            <tr key={player.id} className="border-b border-white/10 hover:bg-white/5">
                                      <td className="py-2 sm:py-3 px-2 text-white/70 text-xs sm:text-sm font-semibold">{idx + 1}</td>
                              <td className="py-2 sm:py-3 px-2">
                                {imageUrl ? (
                                  <img 
                                    src={imageUrl}
                                    alt={getPlayerName(player)}
                                    className="w-8 h-8 sm:w-10 sm:h-10 rounded-full object-cover"
                                    onError={(e) => {
                                      const target = e.target as HTMLImageElement
                                      target.style.display = 'none'
                                    }}
                                  />
                                ) : (
                                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-white/20 flex items-center justify-center">
                                    <UserIcon className="h-4 w-4 sm:h-5 sm:w-5 text-white/50" />
                                  </div>
                                )}
                              </td>
                                      <td className="py-2 sm:py-3 px-2 sm:px-4 text-white text-xs sm:text-sm font-medium">{getPlayerName(player)}</td>
                              <td className="py-2 sm:py-3 px-2 sm:px-4 text-white/70 text-xs sm:text-sm">
                                {bidder ? bidder.teamName || bidder.username : '-'}
                              </td>
                              <td className="py-2 sm:py-3 px-2 sm:px-4 text-white/60 text-xs sm:text-sm">
                                {bidder?.user?.name || bidder?.username || '-'}
                              </td>
                                <td className="py-2 sm:py-3 px-2 sm:px-4 text-right text-white font-semibold text-xs sm:text-sm">
                                  ₹{(player.soldPrice || 0).toLocaleString('en-IN')}
                                </td>
                                    </tr>
                                  )
                                })}
                            </tbody>
                          </table>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              )
            })()}
            
            {/* Unsold Players Table */}
            {activeTab === 'unsold' && (
              <Card className="bg-white/10 backdrop-blur-md border-white/20">
                <CardContent className="p-3 sm:p-6">
                  <div className="overflow-x-auto scrollbar-hide">
                    <table className="w-full min-w-[500px]">
                      <thead>
                        <tr className="border-b border-white/20">
                          <th className="text-left py-2 sm:py-3 px-2 text-white font-semibold text-xs sm:text-sm w-12 sm:w-16">Photo</th>
                          <th className="text-left py-2 sm:py-3 px-2 sm:px-4 text-white font-semibold text-xs sm:text-sm">Player Name</th>
                          <th className="text-left py-2 sm:py-3 px-2 sm:px-4 text-white font-semibold text-xs sm:text-sm">Base Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {getFilteredPlayers().map((player) => {
                          const playerData = player.data as any
                          const imageUrl = getProfilePhotoUrl(playerData)
                          const basePriceRaw = playerData?.['Base Price'] || playerData?.['base price']
                          const basePrice = basePriceRaw ? Number(basePriceRaw) : 1000
                          return (
                            <tr key={player.id} className="border-b border-white/10 hover:bg-white/5">
                              <td className="py-2 sm:py-3 px-2">
                                {imageUrl ? (
                                  <img 
                                    src={imageUrl}
                                    alt={getPlayerName(player)}
                                    className="w-8 h-8 sm:w-10 sm:h-10 rounded-full object-cover"
                                    onError={(e) => {
                                      const target = e.target as HTMLImageElement
                                      target.style.display = 'none'
                                    }}
                                  />
                                ) : (
                                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-white/20 flex items-center justify-center">
                                    <UserIcon className="h-4 w-4 sm:h-5 sm:w-5 text-white/50" />
                                  </div>
                                )}
                              </td>
                              <td className="py-2 sm:py-3 px-2 sm:px-4 text-white text-xs sm:text-sm">{getPlayerName(player)}</td>
                              <td className="py-2 sm:py-3 px-2 sm:px-4 text-white/70 text-xs sm:text-sm">
                                ₹{basePrice.toLocaleString('en-IN')}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Know Your Players */}
            {activeTab === 'know' && (
              <Card className="bg-white/10 backdrop-blur-md border-white/20">
                <CardContent className="p-3 sm:p-6">
                  <h3 className="text-white text-sm sm:text-base font-semibold mb-4">Know Your Players</h3>
                  
                  {/* Filter Buttons */}
                  <div className="mb-4 sm:mb-6 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant={playerFilter === 'all' ? 'default' : 'outline'}
                      onClick={() => setPlayerFilter('all')}
                      className={`${
                        playerFilter === 'all'
                          ? 'bg-white text-blue-900 hover:bg-white/90'
                          : 'bg-white/10 text-white border-white/30 hover:bg-white/20'
                      } text-xs sm:text-sm px-3 sm:px-4 py-1.5 sm:py-2`}
                    >
                      All ({playerCards.length})
                    </Button>
                    <Button
                      size="sm"
                      variant={playerFilter === 'batsmen' ? 'default' : 'outline'}
                      onClick={() => setPlayerFilter('batsmen')}
                      className={`${
                        playerFilter === 'batsmen'
                          ? 'bg-white text-blue-900 hover:bg-white/90'
                          : 'bg-white/10 text-white border-white/30 hover:bg-white/20'
                      } text-xs sm:text-sm px-3 sm:px-4 py-1.5 sm:py-2`}
                    >
                      Batsmen ({playerCards.filter(card => {
                        const roleStr = (card.role || '').toLowerCase()
                        const specialtyStr = (card.specialty || '').toLowerCase()
                        return roleStr.includes('batsman') || roleStr.includes('batter') || specialtyStr.includes('batsman') || specialtyStr.includes('batter')
                      }).length})
                    </Button>
                    <Button
                      size="sm"
                      variant={playerFilter === 'bowlers' ? 'default' : 'outline'}
                      onClick={() => setPlayerFilter('bowlers')}
                      className={`${
                        playerFilter === 'bowlers'
                          ? 'bg-white text-blue-900 hover:bg-white/90'
                          : 'bg-white/10 text-white border-white/30 hover:bg-white/20'
                      } text-xs sm:text-sm px-3 sm:px-4 py-1.5 sm:py-2`}
                    >
                      Bowlers ({playerCards.filter(card => {
                        const roleStr = (card.role || '').toLowerCase()
                        const specialtyStr = (card.specialty || '').toLowerCase()
                        return roleStr.includes('bowler') || specialtyStr.includes('bowler')
                      }).length})
                    </Button>
                    <Button
                      size="sm"
                      variant={playerFilter === 'all-rounders' ? 'default' : 'outline'}
                      onClick={() => setPlayerFilter('all-rounders')}
                      className={`${
                        playerFilter === 'all-rounders'
                          ? 'bg-white text-blue-900 hover:bg-white/90'
                          : 'bg-white/10 text-white border-white/30 hover:bg-white/20'
                      } text-xs sm:text-sm px-3 sm:px-4 py-1.5 sm:py-2 whitespace-nowrap`}
                    >
                      All Rounders ({playerCards.filter(card => {
                        const roleStr = (card.role || '').toLowerCase()
                        const specialtyStr = (card.specialty || '').toLowerCase()
                        return roleStr.includes('all-rounder') || roleStr.includes('allrounder') || roleStr.includes('all rounder') || specialtyStr.includes('all-rounder') || specialtyStr.includes('allrounder')
                      }).length})
                    </Button>
                    <Button
                      size="sm"
                      variant={playerFilter === 'bidders' ? 'default' : 'outline'}
                      onClick={() => setPlayerFilter('bidders')}
                      className={`${
                        playerFilter === 'bidders'
                          ? 'bg-white text-blue-900 hover:bg-white/90'
                          : 'bg-white/10 text-white border-white/30 hover:bg-white/20'
                      } text-xs sm:text-sm px-3 sm:px-4 py-1.5 sm:py-2`}
                    >
                      Bidders ({playerCards.filter(card => card.isBidder).length})
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
                    {filteredPlayerCards.length === 0 ? (
                      <div className="col-span-full text-center text-white/70 py-8">
                        No players found{playerFilter !== 'all' ? ` for ${playerFilter}` : ' in this auction roster'}.
                      </div>
                    ) : (
                      filteredPlayerCards.map(card => (
                            <div
                              key={card.id}
                              className={`group relative rounded-2xl overflow-hidden border-2 shadow-xl transition-all hover:scale-[1.02] ${card.isBidder ? 'border-violet-300 shadow-[0_0_25px_rgba(168,85,247,0.45)] animate-pulse' : 'border-white/20'} bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950 max-w-md mx-auto w-full`}
                            >
                              {/* Status Badge */}
                              <div className="absolute top-2 right-2 sm:top-3 sm:right-3 z-20">
                                <Badge 
                                  variant="secondary" 
                                  className={`${card.isBidder ? 'bg-violet-200 text-violet-950 border border-violet-300 shadow-[0_0_12px_rgba(165,105,255,0.6)]' : 'bg-white/10 text-white'} backdrop-blur px-2 py-1 text-[9px] sm:text-xs font-bold`}
                                >
                                  {card.statusLabel}
                                </Badge>
                              </div>

                              {/* Player Photo - Portrait Style */}
                              <div 
                                className="relative h-48 sm:h-56 bg-gradient-to-b from-slate-700 to-slate-900 flex items-center justify-center cursor-pointer group/photo"
                                onClick={() => card.imageUrl && setFullScreenImage(card.imageUrl)}
                              >
                                  {card.imageUrl ? (
                                  <>
                                    <img
                                      src={card.imageUrl}
                                      alt={card.name}
                                      className="w-full h-full object-contain p-2"
                                      onError={(e) => {
                                        const target = e.currentTarget as HTMLImageElement
                                        target.style.display = 'none'
                                      }}
                                    />
                                    {/* Hover overlay with zoom icon */}
                                    <div className="absolute inset-0 bg-black/0 group-hover/photo:bg-black/40 transition-all duration-200 flex items-center justify-center">
                                      <Eye className="h-8 w-8 sm:h-10 sm:w-10 text-white opacity-0 group-hover/photo:opacity-100 transition-opacity duration-200" />
                                    </div>
                                  </>
                                  ) : (
                                  <div className="w-28 h-28 sm:w-32 sm:h-32 rounded-full bg-white/20 flex items-center justify-center">
                                    <span className="text-4xl sm:text-5xl font-bold text-white">
                                      {card.name.charAt(0).toUpperCase()}
                                    </span>
                                  </div>
                                  )}
                                <div className={`absolute inset-0 ${card.isBidder ? 'bg-gradient-to-t from-purple-900 via-transparent to-transparent' : 'bg-gradient-to-t from-slate-900 via-transparent to-transparent'}`} />
                                </div>

                              {/* Player Info */}
                              <div className="p-3 sm:p-4 space-y-2">
                                {/* Name and Bidder Status */}
                                <div>
                                  <h4 className="text-white font-black text-sm sm:text-lg line-clamp-2">
                                    {card.name}
                                  </h4>
                                  {card.isBidder && (
                                    <p className="text-violet-300 text-[10px] sm:text-xs font-bold uppercase tracking-wide">Registered Bidder</p>
                                  )}
                                  {card.specialty && (
                                    <p className="text-yellow-400 text-[10px] sm:text-xs font-bold uppercase tracking-wide truncate">{card.specialty}</p>
                                  )}
                                </div>

                                {/* Price Info */}
                                <div className="space-y-1.5">
                                  {card.isBidder ? (
                                    <div className="bg-violet-500/20 border border-violet-400/30 rounded-lg p-2 text-center">
                                      <p className="text-violet-200 text-[9px] sm:text-[10px] font-semibold">PARTICIPATING</p>
                                      <p className="text-white text-xs sm:text-sm font-bold">As Bidder</p>
                                    </div>
                                  ) : card.purchasedPrice !== null ? (
                                    <div className="bg-gradient-to-r from-green-600 to-emerald-600 rounded-lg p-2 text-center border-2 border-green-400/30">
                                      <p className="text-green-200 text-[9px] sm:text-[10px] font-semibold">PURCHASED FOR</p>
                                      <p className="text-white font-black text-base sm:text-lg break-words">₹{card.purchasedPrice.toLocaleString('en-IN')}</p>
                                    </div>
                                  ) : (
                                    <div className="bg-white/5 border border-white/10 rounded-lg p-2 text-center">
                                      <p className="text-white/60 text-[9px] sm:text-[10px] font-semibold">STATUS</p>
                                      <p className="text-white text-xs sm:text-sm font-bold">Available</p>
                                    </div>
                                  )}
                                  
                                  {/* Base Price */}
                                  <div className="bg-white/5 rounded-lg p-1.5 border border-white/10">
                                    <div className="flex items-center justify-between">
                                      <span className="text-white/60 text-[9px] sm:text-[10px]">Base Price</span>
                                      <span className="text-white font-bold text-[10px] sm:text-xs">₹{card.basePrice.toLocaleString('en-IN')}</span>
                                </div>
                                  </div>
                                </div>

                                {/* Cricheros Link */}
                                {card.cricherosLink && (
                                  <a
                                    href={card.cricherosLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-white/10 hover:bg-white/20 text-white text-[10px] sm:text-xs font-semibold rounded-lg transition-colors duration-200 border border-white/30"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                    </svg>
                                    <span>View Profile</span>
                                  </a>
                                )}
                              </div>
                            </div>
                          ))
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        ) : (
          /* Team Detail View */
          <div>
            <Button
              variant="ghost"
              onClick={() => setSelectedTeam(null)}
              className="mb-4 sm:mb-6 text-white hover:bg-white/20 px-2 sm:px-3"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              <span className="text-sm sm:text-base">Back to All Teams</span>
            </Button>

            {/* Team Header with Bidder Info */}
            <Card className="bg-white/10 backdrop-blur-md border-white/20 mb-4">
              <CardContent className="p-4 sm:p-6">
                <div className="flex items-center gap-3 mb-2">
                  <div className={`w-12 h-12 sm:w-16 sm:h-16 rounded-full ${selectedTeamData?.colorScheme.bg} flex items-center justify-center shadow-lg`}>
                    {selectedTeamData?.logo ? (
                      <img src={selectedTeamData.logo} alt={selectedTeamData.name} className="w-9 h-9 sm:w-12 sm:h-12 object-contain" />
                    ) : (
                      <span className="text-xl sm:text-2xl font-bold text-white">
                        {selectedTeamData?.name.charAt(0)}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-xl sm:text-2xl font-bold text-white truncate">{selectedTeamData?.name}</h2>
                    <p className="text-sm sm:text-base text-white/80">
                      Bidder: {selectedTeamData?.bidder?.user?.name || selectedTeamData?.bidder?.username || 'Unknown'}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-3 border-t border-white/30">
                  <div>
                    <p className="text-xs text-white/70">Funds Remaining</p>
                    <p className="text-base sm:text-lg font-bold text-white">₹{selectedTeamData?.remainingPurse.toLocaleString('en-IN')}</p>
                  </div>
                  <div>
                    <p className="text-xs text-white/70">Total Players</p>
                    <p className="text-base sm:text-lg font-bold text-white">{selectedTeamData?.totalPlayers}</p>
                  </div>
                  <div>
                    <p className="text-xs text-white font-semibold">Max Spend Now</p>
                    <p className="text-base sm:text-lg font-bold text-lime-300 drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
                      {selectedTeamData && selectedTeamData.remainingSlots > 0
                        ? `₹${selectedTeamData.maxSpendableNow.toLocaleString('en-IN')}`
                        : 'Team Full'}
                    </p>
                    {selectedTeamData && (
                      <p className="text-[10px] text-orange-300 font-semibold drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
                        Reserved: ₹{selectedTeamData.requiredReserve.toLocaleString('en-IN')} ({selectedTeamData.remainingSlots} slots)
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Players Table */}
            <Card className="bg-white/10 backdrop-blur-md border-white/20">
              <CardContent className="p-3 sm:p-6">
                <h3 className="text-white font-semibold mb-3 text-sm sm:text-base">Players Roster</h3>
                <div className="overflow-x-auto scrollbar-hide -mx-3 sm:mx-0 px-3 sm:px-0">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-white/20">
                        <th className="text-left py-2 sm:py-3 px-2 text-white font-semibold text-xs sm:text-sm w-12 sm:w-16">Photo</th>
                        <th className="text-left py-2 sm:py-3 px-2 text-white font-semibold text-xs sm:text-sm min-w-[140px]">Player</th>
                        <th className="text-right py-2 sm:py-3 px-2 text-white font-semibold text-xs sm:text-sm min-w-[100px] bg-white/5">Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedTeamData?.players.map((player) => {
                        const playerData = player.data as any
                        const imageUrl = getProfilePhotoUrl(playerData)
                        return (
                          <tr key={player.id} className="border-b border-white/10 hover:bg-white/5">
                            <td className="py-2 sm:py-3 px-2">
                              {imageUrl ? (
                                <img 
                                  src={imageUrl}
                                  alt={getPlayerName(player)}
                                  className="w-8 h-8 sm:w-10 sm:h-10 rounded-full object-cover"
                                  onError={(e) => {
                                    const target = e.target as HTMLImageElement
                                    target.style.display = 'none'
                                  }}
                                />
                              ) : (
                                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-white/20 flex items-center justify-center">
                                  <UserIcon className="h-4 w-4 sm:h-5 sm:w-5 text-white/50" />
                                </div>
                              )}
                            </td>
                            <td className="py-2 sm:py-3 px-2 text-white text-xs sm:text-sm">{getPlayerName(player)}</td>
                            <td className="py-2 sm:py-3 px-2 text-right text-white font-bold text-sm sm:text-base bg-white/5">
                              ₹{(player.soldPrice || 0).toLocaleString('en-IN')}
                            </td>
                            <td className="py-2 sm:py-3 px-2 text-right w-10">
                              <button
                                className="text-white/80 hover:text-white bg-white/10 hover:bg-white/20 rounded-md p-2"
                                title="View bidding history"
                                onClick={() => openPlayerBids(player)}
                              >
                                <Eye className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
            {/* Player Bids Modal */}
            <Dialog open={!!bidModalPlayer} onOpenChange={(o) => { if (!o) { setBidModalPlayer(null); setBidModalItems([]) } }}>
              <DialogContent className="sm:max-w-lg">
                <DialogTitle>Bidding Activity</DialogTitle>
                <div className="max-h-[60vh] overflow-y-auto">
                  <ActivityLog items={bidModalItems as any} />
                </div>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </div>
      
      {/* Full Screen Image Modal */}
      <Dialog open={!!fullScreenImage} onOpenChange={(o) => { if (!o) setFullScreenImage(null) }}>
        <DialogContent className="max-w-full w-full h-full p-0 bg-black/95">
          <button
            onClick={() => setFullScreenImage(null)}
            className="absolute top-4 right-4 z-50 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            aria-label="Close"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <div className="flex items-center justify-center w-full h-full p-4">
            {fullScreenImage && (
              <img
                src={fullScreenImage}
                alt="Player"
                className="max-w-full max-h-full object-contain"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

