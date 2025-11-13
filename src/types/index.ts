import { User, Auction, Player, Bidder, Role, AuctionStatus, PlayerStatus } from '@prisma/client'

export type { User, Auction, Player, Bidder, Role, AuctionStatus, PlayerStatus }

export interface UserWithRelations extends User {
  auctions?: Auction[]
  bidderProfiles?: Bidder[] // Changed from bidderProfile to bidderProfiles - users can be bidders in multiple auctions
}

export interface AuctionWithRelations extends Auction {
  createdBy: User
  players: Player[]
  bidders: Bidder[]
}

export interface PlayerWithRelations extends Player {
  auction: Auction
}

export interface BidderWithRelations extends Bidder {
  user: User
  auction: Auction
}

export interface BidData {
  bidderId: string
  bidderName: string
  amount: number
  timestamp: Date
}

export interface AuctionRules {
  minBidIncrement: number
  countdownSeconds: number
  maxTeamSize: number
  enforcePurse: boolean
}

export interface PlayerData {
  Name: string
  Age?: number
  Role?: string
  'Base Price'?: number
  [key: string]: any
}

// NextAuth session extension
declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      email: string
      name: string
      role: Role
    }
  }

  interface User {
    role: Role
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role: Role
  }
}
