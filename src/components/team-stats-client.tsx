'use client'

import { useState, useEffect } from 'react'
import { Auction, Player, Bidder, User } from '@prisma/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Users, Trophy, TrendingUp, Grid3x3, List, ChevronRight, User as UserIcon, Eye } from 'lucide-react'
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
  const [activeTab, setActiveTab] = useState<'overview' | 'sold' | 'unsold'>('overview')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [bidModalPlayer, setBidModalPlayer] = useState<Player | null>(null)
  const [bidModalItems, setBidModalItems] = useState<any[]>([])

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

  // Calculate team data
  const teamsData = auction.bidders.map((bidder, index) => {
    const teamPlayers = auction.players.filter(p => p.soldTo === bidder.id)
    const soldPlayers = teamPlayers.filter(p => p.status === 'SOLD')
    const totalSpent = soldPlayers.reduce((sum, p) => sum + (p.soldPrice || 0), 0)
    const remainingPurse = bidder.remainingPurse

    return {
      id: bidder.id,
      name: bidder.teamName || bidder.username,
      logo: bidder.logoUrl,
      remainingPurse,
      totalPlayers: soldPlayers.length,
      players: soldPlayers,
      colorScheme: teamColors[index % teamColors.length],
      bidder: bidder // Include the full bidder object
    }
  })

  const getPlayerName = (player: Player) => {
    const data = player.data as any
    return data?.name || data?.Name || data?.player_name || 'Unknown Player'
  }

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
                            <span className="text-[11px] sm:text-sm opacity-75">Funds Remaining</span>
                            <span className="text-sm sm:text-xl font-bold">₹{team.remainingPurse.toLocaleString('en-IN')}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] sm:text-sm opacity-75">Total Players</span>
                            <span className="text-sm sm:text-lg font-semibold">{team.totalPlayers}</span>
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
                              <p className="text-xs sm:text-sm text-white/70 truncate">
                                ₹{team.remainingPurse.toLocaleString('en-IN')} remaining
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

            {/* Player Lists for Sold/Unsold */}
            {(activeTab === 'sold' || activeTab === 'unsold') && (
              <Card className="bg-white/10 backdrop-blur-md border-white/20">
                <CardContent className="p-3 sm:p-6">
                  <div className="overflow-x-auto scrollbar-hide">
                    <table className="w-full min-w-[500px]">
                      <thead>
                        <tr className="border-b border-white/20">
                          <th className="text-left py-2 sm:py-3 px-2 sm:px-4 text-white font-semibold text-xs sm:text-sm">Player Name</th>
                          <th className="text-left py-2 sm:py-3 px-2 sm:px-4 text-white font-semibold text-xs sm:text-sm">Team</th>
                          {activeTab === 'sold' && (
                            <th className="text-right py-2 sm:py-3 px-2 sm:px-4 text-white font-semibold text-xs sm:text-sm">Price</th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {getFilteredPlayers().map((player) => {
                          const bidder = auction.bidders.find(b => b.id === player.soldTo)
                          return (
                            <tr key={player.id} className="border-b border-white/10 hover:bg-white/5">
                              <td className="py-2 sm:py-3 px-2 sm:px-4 text-white text-xs sm:text-sm">{getPlayerName(player)}</td>
                              <td className="py-2 sm:py-3 px-2 sm:px-4 text-white/70 text-xs sm:text-sm">
                                {bidder ? bidder.teamName || bidder.username : '-'}
                              </td>
                              {activeTab === 'sold' && (
                                <td className="py-2 sm:py-3 px-2 sm:px-4 text-right text-white font-semibold text-xs sm:text-sm">
                                  ₹{(player.soldPrice || 0).toLocaleString('en-IN')}
                                </td>
                              )}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
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
                <div className="grid grid-cols-2 gap-4 pt-3 border-t border-white/30">
                  <div>
                    <p className="text-xs text-white/70">Funds Remaining</p>
                    <p className="text-base sm:text-lg font-bold text-white">₹{selectedTeamData?.remainingPurse.toLocaleString('en-IN')}</p>
                  </div>
                  <div>
                    <p className="text-xs text-white/70">Total Players</p>
                    <p className="text-base sm:text-lg font-bold text-white">{selectedTeamData?.totalPlayers}</p>
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
                        const profilePhoto = playerData?.profilePhoto || playerData?.profile_photo
                        
                        return (
                          <tr key={player.id} className="border-b border-white/10 hover:bg-white/5">
                            <td className="py-2 sm:py-3 px-2">
                              {profilePhoto ? (
                                <img 
                                  src={`/api/proxy-image?url=${encodeURIComponent(profilePhoto)}`}
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
    </div>
  )
}

