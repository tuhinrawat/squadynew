'use client'

import { useRef } from 'react'
import { PublicHeaderWithChat } from './public-header-with-chat'
import { PublicAuctionView } from './public-auction-view'
import { Auction, Player } from '@prisma/client'

interface BidHistoryEntry {
  bidderId: string
  amount: number
  timestamp: Date
  bidderName: string
  teamName?: string
  type?: 'bid' | 'sold' | 'unsold' | 'bid-undo'
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

interface PublicAuctionWrapperProps {
  auctionId: string
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

export function PublicAuctionWrapper({
  auctionId,
  auction,
  currentPlayer,
  stats,
  bidHistory,
  bidders
}: PublicAuctionWrapperProps) {
  const openBidHistoryRef = useRef<(() => void) | null>(null)

  return (
    <>
      <PublicHeaderWithChat 
        auctionId={auctionId}
        onOpenBidHistory={() => {
          if (openBidHistoryRef.current) {
            openBidHistoryRef.current()
          }
        }}
      />
      <PublicAuctionView
        auction={auction}
        currentPlayer={currentPlayer}
        stats={stats}
        bidHistory={bidHistory}
        bidders={bidders}
        onOpenBidHistoryRef={openBidHistoryRef}
      />
    </>
  )
}

