import { AuctionStatus } from '@prisma/client'

/**
 * Check if an auction status is considered "live" (active and accepting bids)
 * This includes both LIVE and MOCK_RUN statuses
 */
export function isLiveStatus(status: AuctionStatus): boolean {
  return status === 'LIVE' || status === 'MOCK_RUN'
}

/**
 * Check if an auction status allows bidding
 */
export function canBid(status: AuctionStatus): boolean {
  return isLiveStatus(status)
}

/**
 * Check if an auction status allows starting/pausing
 */
export function canControlAuction(status: AuctionStatus): boolean {
  return isLiveStatus(status) || status === 'PAUSED'
}

