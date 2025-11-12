'use client'

import { useState, useMemo, useEffect } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PlayerTable } from '@/components/analytics/player-table'
import { BidAnalytics } from '@/components/analytics/bid-analytics'
import { BidderPrioritiesUpload } from '@/components/analytics/bidder-priorities-upload'
import { Auction, Player, Bidder } from '@prisma/client'

interface AnalyticsViewProps {
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
  currentPlayer: Player | null
  bidHistory: any[]
}

export function AnalyticsView({ auction, currentPlayer, bidHistory }: AnalyticsViewProps) {
  const [activeTab, setActiveTab] = useState('players')
  const [localCurrentPlayer, setLocalCurrentPlayer] = useState<Player | null>(currentPlayer)
  const [localAuction, setLocalAuction] = useState(auction)
  
  // Bidder selection - default to first bidder
  const [selectedBidderId, setSelectedBidderId] = useState<string>(
    auction.bidders.length > 0 ? auction.bidders[0].id : ''
  )
  
  const selectedBidder = useMemo(() => {
    return auction.bidders.find(b => b.id === selectedBidderId) || auction.bidders[0] || null
  }, [selectedBidderId, auction.bidders])
  
  // Update local state when props change
  useEffect(() => {
    setLocalCurrentPlayer(currentPlayer)
  }, [currentPlayer])
  
  useEffect(() => {
    setLocalAuction(auction)
  }, [auction])

  // Extract player data for current player
  const playerData = useMemo(() => {
    if (!localCurrentPlayer) return null
    
    const data = localCurrentPlayer.data as any
    
    // Extract profile photo with proper Google Drive handling
    const getImageUrl = () => {
      const profilePhotoLink = data?.['Profile Photo'] || 
                              data?.['profile photo'] || 
                              data?.['Profile photo'] || 
                              data?.['PROFILE PHOTO'] || 
                              data?.['profile_photo'] ||
                              data?.['ProfilePhoto']
      
      if (!profilePhotoLink || profilePhotoLink === '') {
        return undefined
      }
      
      const photoStr = String(profilePhotoLink).trim()
      
      // Try to extract Google Drive ID from various formats
      // Format 1: https://drive.google.com/file/d/[ID]/view
      let match = photoStr.match(/\/d\/([a-zA-Z0-9_-]+)/)
      if (match && match[1]) {
        return `/api/proxy-image?id=${match[1]}`
      }
      
      // Format 2: https://drive.google.com/open?id=[ID]
      match = photoStr.match(/[?&]id=([a-zA-Z0-9_-]+)/)
      if (match && match[1]) {
        return `/api/proxy-image?id=${match[1]}`
      }
      
      // If it's already a valid URL, use it directly
      if (photoStr.startsWith('http://') || photoStr.startsWith('https://')) {
        return photoStr
      }
      
      return undefined
    }
    
    // Extract profile link
    const getProfileLink = () => {
      const link = data?.['Cricheroes Profile link'] || data?.profileLink
      if (!link) return null
      
      const linkStr = String(link)
      // Extract URL from text if it contains a URL
      const urlMatch = linkStr.match(/https?:\/\/[^\s]+/)
      return urlMatch ? urlMatch[0] : (linkStr.startsWith('http') ? linkStr : null)
    }
    
    return {
      name: data?.Name || data?.name || 'Unknown Player',
      speciality: data?.Speciality || 'N/A',
      batting: data?.['Batting Type'] || data?.batting || 'N/A',
      bowling: data?.['Bowling Type'] || data?.bowling || 'N/A',
      profileLink: getProfileLink(),
      imageUrl: getImageUrl(),
      ...data
    }
  }, [localCurrentPlayer])

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex-1">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              Bidder Analytics Dashboard
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              {auction.name}
            </p>
          </div>
          <div className="flex items-center gap-4">
            {/* Bidder Selector */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 dark:text-gray-400">Select Bidder</label>
              <Select value={selectedBidderId} onValueChange={setSelectedBidderId}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Select a bidder" />
                </SelectTrigger>
                <SelectContent>
                  {auction.bidders.map((bidder) => (
                    <SelectItem key={bidder.id} value={bidder.id}>
                      {bidder.teamName || bidder.user?.name || bidder.username || 'Unknown'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedBidder && (
              <Badge variant="outline" className="text-lg px-4 py-2">
                Balance: ₹{selectedBidder.remainingPurse.toLocaleString('en-IN')}
              </Badge>
            )}
          </div>
        </div>

        {/* Current Player - Minimal Display */}
        {localCurrentPlayer && playerData && (
          <div className="flex items-center justify-between py-2 px-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Current Player:</span>
              <span className="text-sm font-semibold text-gray-900 dark:text-white">{playerData.name}</span>
              <Badge variant="secondary" className="text-xs">LIVE</Badge>
            </div>
          </div>
        )}

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="players">Player Table</TabsTrigger>
            <TabsTrigger value="analytics">Bid Analytics</TabsTrigger>
            <TabsTrigger value="priorities">Bidder Priorities</TabsTrigger>
          </TabsList>

          <TabsContent value="players" className="mt-6">
            <PlayerTable
              players={localAuction.players}
              auctionId={localAuction.id}
              bidders={localAuction.bidders}
              analyticsVisibleColumns={(localAuction as any).analyticsVisibleColumns}
              onPlayersUpdate={(updatedPlayers) => {
                // Update local auction with new player data
                setLocalAuction(prev => ({
                  ...prev,
                  players: updatedPlayers
                }))
              }}
            />
          </TabsContent>

          <TabsContent value="analytics" className="mt-6">
            {selectedBidder ? (
              <BidAnalytics
                auction={localAuction}
                selectedBidder={selectedBidder}
                currentPlayer={localCurrentPlayer}
                bidHistory={bidHistory}
                onCurrentPlayerChange={(player) => {
                  setLocalCurrentPlayer(player)
                }}
                onAuctionUpdate={(updatedAuction) => {
                  setLocalAuction(updatedAuction)
                }}
              />
            ) : (
              <Card>
                <CardContent className="py-8 text-center text-gray-500">
                  Please select a bidder to view analytics
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="priorities" className="mt-6">
            <BidderPrioritiesUpload
              auctionId={localAuction.id}
              bidders={localAuction.bidders}
              players={localAuction.players}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

