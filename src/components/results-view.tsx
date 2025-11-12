'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { XCircle, Image as ImageIcon } from 'lucide-react'
import { TeamSquadPoster } from './team-squad-poster'

interface ResultsViewProps {
  auction: any
  userId: string
  userRole: 'ADMIN' | 'BIDDER' | 'SUPER_ADMIN'
}

export function ResultsView({ auction }: ResultsViewProps) {
  const soldPlayers = auction.players.filter((p: any) => p.status === 'SOLD')
  const unsoldPlayers = auction.players.filter((p: any) => p.status === 'UNSOLD')

  // Prepare team data for posters
  const teamData = auction.bidders.map((bidder: any) => {
    const teamPlayers = soldPlayers.filter((p: any) => p.soldTo === bidder.id)
    
    return {
      bidderId: bidder.id,
      teamName: bidder.teamName || bidder.username,
      bidderName: bidder.user?.name || bidder.username,
      logoUrl: bidder.logoUrl,
      username: bidder.username, // Add username to check if it's a retired player
      players: teamPlayers.sort((a: any, b: any) => (b.soldPrice || 0) - (a.soldPrice || 0)), // Sort by price desc
    }
  })

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-purple-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800 p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Team Squad Posters Section */}
        <div className="space-y-6">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <ImageIcon className="w-6 h-6" />
            Team Squad Posters
          </h2>
          <div className="space-y-8">
            {teamData.map((team: any) => (
              <TeamSquadPoster
                key={team.bidderId}
                team={team}
                auctionName={auction.name}
                auctionDescription={auction.description}
                auctionImage={auction.image}
                auction={auction}
              />
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

