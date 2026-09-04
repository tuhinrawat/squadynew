'use client'

import { useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { PublicHeader } from './public-header'
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
  auction,
  currentPlayer,
  stats,
  bidHistory,
  bidders
}: PublicAuctionWrapperProps) {
  const openBidHistoryRef = useRef<(() => void) | null>(null)
  // Presenter link (?presenter=1), handed specifically to whoever is running
  // the live event off this screen - see PublicAuctionView for what this
  // actually changes (a real Pusher connection vs. a background poll).
  const isPresenter = useSearchParams().get('presenter') === '1'

  return (
    <>
      <PublicHeader
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
        isPresenter={isPresenter}
      />
    </>
  )
}
