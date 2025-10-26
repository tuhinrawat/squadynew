'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { Auction, Player } from '@prisma/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Clock } from 'lucide-react'
import { usePusher } from '@/lib/pusher-client'
import { motion } from 'framer-motion'
import { Input } from '@/components/ui/input'

interface BidderAuctionViewProps {
  auction: any
  currentPlayer: Player | null
  stats: any
}

export function BidderAuctionView({ auction, currentPlayer: initialPlayer, stats: initialStats }: BidderAuctionViewProps) {
  const { data: session } = useSession()
  const [currentPlayer, setCurrentPlayer] = useState(initialPlayer)
  const [currentBid, setCurrentBid] = useState<any>(null)
  const [timer, setTimer] = useState(30)
  const [bidAmount, setBidAmount] = useState(0)
  const [isPlacingBid, setIsPlacingBid] = useState(false)
  const [error, setError] = useState('')

  // Find current user's bidder profile
  const userBidder = auction.bidders.find((b: any) => b.userId === session?.user?.id)
  const rules = auction.rules as any
  const minIncrement = rules?.minBidIncrement || 50000

  // Calculate next valid bid
  const nextValidBid = currentBid ? currentBid.amount + minIncrement : 0

  usePusher(auction.id, {
    onNewBid: (data) => {
      setCurrentBid(data)
    },
    onBidUndo: (data) => {
      setCurrentBid(data.currentBid || null)
      const rules = auction.rules as any
      setTimer(rules?.countdownSeconds || 30)
    },
    onTimerUpdate: (data) => {
      setTimer(data.seconds)
    },
    onNewPlayer: (data) => {
      setCurrentPlayer(data.player)
      setCurrentBid(null)
      setBidAmount(0)
    },
    onSaleUndo: (data) => {
      window.location.reload()
    },
  })

  const handlePlaceBid = async () => {
    if (!userBidder) {
      setError('Please log in to place a bid')
      return
    }
    
    if (currentBid && bidAmount <= currentBid.amount + minIncrement - 1) {
      setError(`Bid must be at least ₹${(currentBid.amount + minIncrement).toLocaleString('en-IN')} (₹${minIncrement.toLocaleString('en-IN')} more than current bid)`)
      return
    }

    if (bidAmount > userBidder.remainingPurse) {
      setError('Insufficient remaining purse')
      return
    }

    setIsPlacingBid(true)
    setError('')

    try {
      const response = await fetch(`/api/auction/${auction.id}/bid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bidderId: userBidder.id,
          amount: bidAmount
        })
      })

      const data = await response.json()

      if (response.ok) {
        setBidAmount(0)
      } else {
        setError(data.error || 'Failed to place bid')
      }
    } catch (err) {
      setError('Network error. Please try again.')
    } finally {
      setIsPlacingBid(false)
    }
  }

  const quickBid = (increment: number) => {
    const amount = currentBid ? currentBid.amount + increment : increment
    setBidAmount(amount)
  }

  const handleUndoBid = async () => {
    if (!userBidder || !currentBid || currentBid.bidderId !== userBidder.id) {
      setError('You are not the current highest bidder')
      return
    }

    setIsPlacingBid(true)
    setError('')

    try {
      const response = await fetch(`/api/auction/${auction.id}/undo-bid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bidderId: userBidder.id
        })
      })

      const data = await response.json()

      if (response.ok) {
        setCurrentBid(data.currentBid)
      } else {
        setError(data.error || 'Failed to undo bid')
      }
    } catch (err) {
      setError('Network error. Please try again.')
    } finally {
      setIsPlacingBid(false)
    }
  }

  // Extract player data
  const getPlayerData = (player: Player | null) => {
    if (!player || !player.data) return {}
    return player.data as Record<string, any>
  }

  const playerData = getPlayerData(currentPlayer)
  const playerName = playerData.name || playerData.Name || 'No Player Selected'

  // Check if user is current highest bidder
  const isHighestBidder = currentBid?.bidderId === userBidder?.id
  const canBid = auction.status === 'LIVE' && !isHighestBidder && bidAmount >= nextValidBid && bidAmount <= userBidder?.remainingPurse

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 p-4">
      <div className="max-w-7xl mx-auto space-y-4">
        {/* Header */}
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">{auction.name}</CardTitle>
            <div className="flex justify-between items-center mt-4">
              <div className="flex items-center gap-4">
                <Clock className="h-6 w-6" />
                <div className="text-3xl font-bold" style={{ color: timer <= 5 ? 'red' : 'inherit' }}>
                  {timer}s
                </div>
              </div>
              <div className="text-lg">
                Remaining Purse: ₹{userBidder?.remainingPurse.toLocaleString('en-IN') || '0'}
              </div>
            </div>
          </CardHeader>
        </Card>

        {/* Center Stage */}
        <Card>
          <CardHeader>
            <CardTitle className="text-3xl">{playerName}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {Object.entries(playerData).filter(([key]) => key.toLowerCase() !== 'name').map(([key, value]) => (
                <div key={key}>
                  <div className="text-sm text-gray-600 dark:text-gray-400">{key}</div>
                  <div className="text-lg font-medium">{String(value)}</div>
                </div>
              ))}
            </div>

            <div className="border-t pt-4">
              <div className="text-sm text-gray-600 dark:text-gray-400 mb-2">Current Bid</div>
              {currentBid ? (
                <div className="text-2xl font-bold text-blue-600">
                  ₹{currentBid.amount.toLocaleString('en-IN')} - {currentBid.bidderName}
                </div>
              ) : (
                <div className="text-lg text-gray-400">No bids yet</div>
              )}
            </div>

            {/* Bid Controls */}
            {auction.status === 'LIVE' && (
              <div className="border-t pt-4 space-y-4">
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    value={bidAmount || ''}
                    onChange={(e) => setBidAmount(Number(e.target.value))}
                    placeholder={`Min: ₹${nextValidBid.toLocaleString('en-IN')}`}
                    disabled={isPlacingBid || isHighestBidder}
                    className="flex-1"
                  />
                  <Button
                    onClick={handlePlaceBid}
                    disabled={!canBid || isPlacingBid}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    {isPlacingBid ? 'Placing...' : 'Place Bid'}
                  </Button>
                </div>

                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => quickBid(10000)} disabled={isHighestBidder} className="text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800">
                    +₹10K
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => quickBid(25000)} disabled={isHighestBidder} className="text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800">
                    +₹25K
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => quickBid(50000)} disabled={isHighestBidder} className="text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800">
                    +₹50K
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => quickBid(100000)} disabled={isHighestBidder} className="text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800">
                    +₹100K
                  </Button>
                </div>

                {error && <div className="text-red-500 text-sm">{error}</div>}
                {isHighestBidder && (
                  <div className="flex justify-between items-center">
                    <div className="text-green-600 font-medium">✓ You are the current highest bidder!</div>
                    <Button
                      onClick={handleUndoBid}
                      disabled={isPlacingBid}
                      variant="outline"
                      size="sm"
                      className="text-xs text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800"
                    >
                      Undo My Bid
                    </Button>
                  </div>
                )}
              </div>
            )}

            {auction.status === 'DRAFT' && (
              <div className="text-yellow-600">Auction not started yet</div>
            )}
          </CardContent>
        </Card>

        {/* Bidders Grid */}
        <Card>
          <CardHeader>
            <CardTitle>All Teams</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {auction.bidders.map((bidder: any) => (
                <div
                  key={bidder.id}
                  className={`p-4 rounded-lg border-2 ${
                    bidder.id === currentBid?.bidderId ? 'border-green-500 bg-green-50 dark:bg-green-900/20' : 'border-gray-200 dark:border-gray-700'
                  }`}
                >
                  {bidder.logoUrl && (
                    <img src={bidder.logoUrl} alt={bidder.teamName} className="w-12 h-12 rounded mb-2" />
                  )}
                  <div className="font-semibold">{bidder.teamName || bidder.username}</div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    ₹{bidder.remainingPurse.toLocaleString('en-IN')} remaining
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}


