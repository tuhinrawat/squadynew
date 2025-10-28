'use client'

import { useState, useEffect, memo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import Image from 'next/image'

interface Player {
  id: string
  name: string
  data: any
  soldPrice: number | null
  soldTo: string | null
}

interface Bidder {
  id: string
  teamName: string | null
  username: string
  remainingPurse: number
  logoUrl: string | null
  user: {
    name: string
  }
}

interface TeamsOverviewProps {
  auction: {
    id: string
    bidders: Bidder[]
    players: Player[]
  }
}

function TeamsOverviewComponent({ auction }: TeamsOverviewProps) {
  const [teams, setTeams] = useState<Map<string, any>>(new Map())

  useEffect(() => {
    // Calculate team purchases
    const teamPurchases = new Map()
    
    auction.bidders.forEach(bidder => {
      const purchasedPlayers = auction.players.filter(
        p => p.soldTo === bidder.id && p.soldPrice !== null
      )
      
      const totalSpent = purchasedPlayers.reduce((sum, p) => sum + (p.soldPrice || 0), 0)
      
      teamPurchases.set(bidder.id, {
        bidder,
        players: purchasedPlayers,
        totalSpent,
        remainingPurse: bidder.remainingPurse,
        initialPurse: bidder.remainingPurse + totalSpent
      })
    })
    
    setTeams(teamPurchases)
  }, [auction.bidders, auction.players])

  return (
    <Card>
      <CardHeader className="p-3 sm:p-6">
        <CardTitle className="text-sm sm:text-base">Team Overview</CardTitle>
      </CardHeader>
      <CardContent className="p-3 sm:p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {Array.from(teams.values()).map((team: any) => (
            <div
              key={team.bidder.id}
              className="border-2 rounded-lg p-3 sm:p-4 bg-white dark:bg-gray-800 hover:shadow-md transition-shadow"
            >
              <div className="flex items-center gap-2 sm:gap-3 mb-3">
                {team.bidder.logoUrl && (
                  <div className="relative w-10 h-10 sm:w-12 sm:h-12 flex-shrink-0">
                    <Image
                      src={team.bidder.logoUrl}
                      alt={team.bidder.teamName || team.bidder.username}
                      fill
                      className="rounded object-cover"
                      unoptimized
                    />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm sm:text-base text-gray-900 dark:text-gray-100 truncate">
                    {team.bidder.teamName || team.bidder.username}
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">
                    {team.bidder.user.name}
                  </div>
                </div>
              </div>
              
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Initial Purse:</span>
                  <span className="font-semibold">₹{team.initialPurse.toLocaleString('en-IN')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Total Spent:</span>
                  <span className="font-semibold text-red-600 dark:text-red-400">
                    ₹{team.totalSpent.toLocaleString('en-IN')}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Remaining:</span>
                  <span className="font-semibold text-green-600 dark:text-green-400">
                    ₹{team.remainingPurse.toLocaleString('en-IN')}
                  </span>
                </div>
                <div className="flex justify-between border-t pt-2">
                  <span className="text-gray-600 dark:text-gray-400">Players:</span>
                  <Badge variant="secondary">{team.players.length}</Badge>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export const TeamsOverview = memo(TeamsOverviewComponent)

