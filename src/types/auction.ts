export interface Player {
  id: string
  name: string
  position: string
  basePrice: number
  status: 'AVAILABLE' | 'SOLD' | 'UNSOLD'
  soldTo?: string
  soldPrice?: number
  auctionId: string
  createdAt: Date
  updatedAt: Date
}

export interface Bidder {
  id: string
  userId: string
  auctionId: string
  teamName?: string
  username: string
  purseAmount: number
  remainingPurse: number
  logoUrl?: string
  createdAt: Date
  user: {
    id: string
    name: string
    email: string
  }
}

export interface Bid {
  id: string
  bidderId: string
  playerId: string
  amount: number
  timestamp: Date
  bidder: {
    id: string
    username: string
    teamName?: string
    user: {
      name: string
    }
  }
}

export interface AuctionEventData {
  'new-bid': {
    bidderId: string
    amount: number
    timestamp: Date
    bidderName: string
    teamName?: string
  }
  'bid-undo': {
    bidderId: string
    previousBid: number | null
    currentBid: any | null
  }
  'player-sold': {
    playerId: string
    bidderId: string
    amount: number
    playerName: string
  }
  'sale-undo': {
    playerId: string
  }
  'new-player': {
    player: Player
  }
  'timer-update': {
    seconds: number
  }
  'auction-paused': {}
  'auction-resumed': {}
  'auction-ended': {}
  'players-updated': {}
}

export type AuctionEventName = keyof AuctionEventData

export interface AuctionState {
  currentPlayer: Player | null
  currentBid: {
    bidderId: string
    amount: number
    bidderName: string
    teamName?: string
  } | null
  timer: number
  bidHistory: Bid[]
  bidders: Bidder[]
  isPaused: boolean
  isEnded: boolean
}

export interface AuctionActions {
  setCurrentPlayer: (player: Player | null) => void
  updateBid: (bid: {
    bidderId: string
    amount: number
    bidderName: string
    teamName?: string
  } | null) => void
  updateTimer: (seconds: number) => void
  addToBidHistory: (bid: Bid) => void
  resetTimer: () => void
  setBidders: (bidders: Bidder[]) => void
  setBidHistory: (history: Bid[]) => void
  pauseAuction: () => void
  resumeAuction: () => void
  endAuction: () => void
  resetAuction: () => void
}
