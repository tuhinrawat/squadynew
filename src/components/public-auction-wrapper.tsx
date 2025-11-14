'use client'

import { useRef, useState } from 'react'
import { PublicHeaderWithChat } from './public-header-with-chat'
import { PublicAuctionView } from './public-auction-view'
import { LiveStreamChatOverlay } from './livestream-chat-overlay'
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
  const [chatMode, setChatMode] = useState<'traditional' | 'livestream'>('traditional')

  return (
    <>
      <PublicHeaderWithChat 
        auctionId={auctionId}
        chatMode={chatMode}
        setChatMode={setChatMode}
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
      
      {/* LiveStream Chat Overlay - Only on mobile in livestream mode */}
      {chatMode === 'livestream' && (
        <div className="lg:hidden">
          <LiveStreamChatOverlay auctionId={auctionId} />
        </div>
      )}
    </>
  )
}

