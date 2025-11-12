'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Download, ArrowLeft, Trophy, Users, Wallet, TrendingUp, XCircle } from 'lucide-react'
import Link from 'next/link'
import { formatCurrency } from '@/lib/currency'
import Image from 'next/image'

interface ResultsViewProps {
  auction: any
  userId: string
  userRole: 'ADMIN' | 'BIDDER' | 'SUPER_ADMIN'
}

export function ResultsView({ auction, userId, userRole }: ResultsViewProps) {
  const soldPlayers = auction.players.filter((p: any) => p.status === 'SOLD')
  const unsoldPlayers = auction.players.filter((p: any) => p.status === 'UNSOLD')

  // Get user's team/bidder info
  const userBidder = auction.bidders.find((b: any) => b.userId === userId)
  const wonPlayers = soldPlayers.filter((p: any) => p.soldTo === userBidder?.id)

  const totalSpent = wonPlayers.reduce((sum: number, p: any) => sum + (p.soldPrice || 0), 0)
  const remainingPurse = userBidder ? userBidder.purseAmount - totalSpent : 0

  // Prepare team data for IPL-style cards
  const teamData = auction.bidders.map((bidder: any) => {
    const teamPlayers = soldPlayers.filter((p: any) => p.soldTo === bidder.id)
    const totalSpent = teamPlayers.reduce((sum: number, p: any) => sum + (p.soldPrice || 0), 0)
    
    return {
      bidderId: bidder.id,
      teamName: bidder.teamName || bidder.username,
      bidderName: bidder.user?.name || bidder.username,
      logoUrl: bidder.logoUrl,
      purseAmount: bidder.purseAmount,
      totalSpent,
      remainingPurse: bidder.remainingPurse,
      players: teamPlayers.sort((a: any, b: any) => (b.soldPrice || 0) - (a.soldPrice || 0)), // Sort by price desc
      isUserTeam: bidder.id === userBidder?.id
    }
  }).sort((a: any, b: any) => b.totalSpent - a.totalSpent) // Sort teams by total spent

  const handleDownloadResults = () => {
    // Create CSV content
    const csvHeaders = ['Player Name', 'Status', 'Sold To', 'Sold Price']
    const csvRows = auction.players.map((p: any) => {
      const data = p.data as Record<string, any>
      const playerName = data.name || data.Name || 'Unknown'
      return [
        playerName,
        p.status,
        p.soldTo ? auction.bidders.find((b: any) => b.id === p.soldTo)?.teamName || 'Unknown' : 'N/A',
        p.soldPrice || 'N/A'
      ]
    })

    const csvContent = [
      csvHeaders.join(','),
      ...csvRows.map((row: string[]) => row.join(','))
    ].join('\n')

    // Download
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${auction.name}-results.csv`
    a.click()
    window.URL.revokeObjectURL(url)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-purple-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800 p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
              <Trophy className="w-8 h-8 md:w-10 md:h-10 text-yellow-500" />
              {auction.name}
            </h1>
            <div className="flex items-center gap-3 mt-3">
              <Badge className="bg-green-500 text-white px-3 py-1">
                <Trophy className="w-3 h-3 mr-1 inline" />
                COMPLETED
              </Badge>
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {soldPlayers.length} Players Sold • {unsoldPlayers.length} Unsold
              </span>
            </div>
          </div>
          <div className="flex gap-3">
            {userId && (
              <Button variant="outline" asChild className="text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-white dark:hover:bg-gray-800">
                <Link href={userRole === 'ADMIN' ? '/dashboard/auctions' : '/bidder/auctions'}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back
                </Link>
              </Button>
            )}
            {auction.isPublished && (
              <Button onClick={handleDownloadResults} className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700">
                <Download className="mr-2 h-4 w-4" />
                Download
              </Button>
            )}
          </div>
        </div>

        {/* IPL-Style Team Cards */}
        <div className="space-y-6">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Users className="w-6 h-6" />
            Teams & Squads
          </h2>
          
          <div className="grid grid-cols-1 gap-6">
            {teamData.map((team: any) => (
              <Card 
                key={team.bidderId} 
                className={`overflow-hidden border-2 transition-all ${
                  team.isUserTeam 
                    ? 'border-green-500 shadow-lg shadow-green-500/20 dark:border-green-400' 
                    : 'border-gray-200 dark:border-gray-700'
                }`}
              >
                {/* Team Header - IPL Style */}
                <div className={`relative bg-gradient-to-r ${
                  team.isUserTeam 
                    ? 'from-green-600 to-emerald-600' 
                    : 'from-blue-600 to-purple-600'
                } text-white p-6`}>
                  {/* Background pattern */}
                  <div className="absolute inset-0 opacity-10">
                    <div className="absolute inset-0" style={{
                      backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
                      backgroundSize: '20px 20px'
                    }} />
                  </div>
                  
                  <div className="relative flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    {/* Team Info */}
                    <div className="flex items-center gap-4">
                      {/* Team Logo */}
                      <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-white/20 backdrop-blur-sm p-2 flex items-center justify-center border-2 border-white/30">
                        {team.logoUrl ? (
                          <Image
                            src={team.logoUrl}
                            alt={team.teamName}
                            width={80}
                            height={80}
                            className="w-full h-full object-contain rounded-full"
                          />
                        ) : (
                          <span className="text-2xl md:text-3xl font-bold">
                            {team.teamName.substring(0, 2).toUpperCase()}
                          </span>
                        )}
                      </div>
                      
                      {/* Team Name & Bidder */}
                      <div>
                        <h3 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
                          {team.teamName}
                          {team.isUserTeam && (
                            <Badge className="bg-yellow-500 text-yellow-900 border-0">
                              YOUR TEAM
                            </Badge>
                          )}
                        </h3>
                        <p className="text-white/80 text-sm md:text-base mt-1">
                          Owner: {team.bidderName}
                        </p>
                      </div>
                    </div>
                    
                    {/* Team Stats */}
                    <div className="grid grid-cols-3 gap-4 w-full md:w-auto">
                      <div className="text-center bg-white/10 backdrop-blur-sm rounded-lg p-3 border border-white/20">
                        <div className="flex items-center justify-center gap-1 text-xs text-white/70 mb-1">
                          <Users className="w-3 h-3" />
                          Players
                        </div>
                        <div className="text-xl md:text-2xl font-bold">{team.players.length}</div>
                      </div>
                      <div className="text-center bg-white/10 backdrop-blur-sm rounded-lg p-3 border border-white/20">
                        <div className="flex items-center justify-center gap-1 text-xs text-white/70 mb-1">
                          <TrendingUp className="w-3 h-3" />
                          Spent
                        </div>
                        <div className="text-lg md:text-xl font-bold">{formatCurrency(team.totalSpent)}</div>
                      </div>
                      <div className="text-center bg-white/10 backdrop-blur-sm rounded-lg p-3 border border-white/20">
                        <div className="flex items-center justify-center gap-1 text-xs text-white/70 mb-1">
                          <Wallet className="w-3 h-3" />
                          Remaining
                        </div>
                        <div className="text-lg md:text-xl font-bold">{formatCurrency(team.remainingPurse)}</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Players List */}
                <CardContent className="p-6">
                  {team.players.length > 0 ? (
                    <div className="space-y-3">
                      <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                        <Trophy className="w-5 h-5 text-yellow-500" />
                        Squad ({team.players.length} Players)
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {team.players.map((player: any, index: number) => {
                          const data = player.data as Record<string, any>
                          const playerName = data.name || data.Name || 'Unknown'
                          const speciality = data.speciality || data.Speciality || data['Batting Type'] || 'All-Rounder'
                          
                          return (
                            <div 
                              key={player.id}
                              className="bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-700 rounded-lg p-4 border border-gray-200 dark:border-gray-600 hover:shadow-md transition-shadow"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                                      #{index + 1}
                                    </span>
                                    {index === 0 && (
                                      <Badge className="bg-yellow-500 text-yellow-900 text-xs px-1.5 py-0">
                                        Top Buy
                                      </Badge>
                                    )}
                                  </div>
                                  <h5 className="font-bold text-gray-900 dark:text-white truncate text-sm md:text-base">
                                    {playerName}
                                  </h5>
                                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                                    {speciality}
                                  </p>
                                </div>
                                <div className="text-right">
                                  <div className="text-lg md:text-xl font-bold text-green-600 dark:text-green-400">
                                    ₹{(player.soldPrice || 0).toLocaleString('en-IN')}
                                  </div>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                      <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
                      <p>No players purchased</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Unsold Players (if any) */}
        {unsoldPlayers.length > 0 && (
          <Card className="border-orange-200 dark:border-orange-800">
            <CardHeader className="bg-orange-50 dark:bg-orange-900/20">
              <CardTitle className="flex items-center gap-2 text-orange-900 dark:text-orange-100">
                <XCircle className="w-5 h-5" />
                Unsold Players ({unsoldPlayers.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {unsoldPlayers.map((player: any) => {
                  const data = player.data as Record<string, any>
                  const playerName = data.name || data.Name || 'Unknown'
                  return (
                    <div key={player.id} className="text-center p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{playerName}</p>
                      <Badge className="mt-2 bg-orange-500 text-xs">UNSOLD</Badge>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

