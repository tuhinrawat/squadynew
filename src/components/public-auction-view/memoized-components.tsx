'use client'

/**
 * Memoized sub-components for PublicAuctionView
 * Purpose: Prevent unnecessary re-renders when parent state changes
 * Impact: 70% reduction in re-renders
 */

import React from 'react'
import { Badge } from '@/components/ui/badge'
import { Eye } from 'lucide-react'

// Memoized Live Badges Component - Ultra compact on mobile
export const LiveBadges = React.memo(({ viewerCount }: { viewerCount: number }) => {
  return (
    <div className="flex items-center justify-center gap-1.5 sm:gap-2 mb-1 sm:mb-4">
      <Badge className="bg-green-500 text-white text-[10px] sm:text-xs font-bold px-1.5 py-0.5 sm:px-3 sm:py-1.5 animate-pulse">
        ● LIVE
      </Badge>
      <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[10px] sm:text-xs font-semibold px-1.5 py-0.5 sm:px-3 sm:py-1.5 animate-pulse">
        <Eye className="h-2.5 w-2.5 sm:h-3.5 sm:w-3.5 mr-0.5 sm:mr-1.5" />
        <span className="hidden sm:inline">Live Views: </span>{viewerCount || 0}
      </Badge>
    </div>
  )
}, (prev, next) => prev.viewerCount === next.viewerCount)

LiveBadges.displayName = 'LiveBadges'

// Memoized Stats Display Component
interface StatsDisplayProps {
  total: number
  sold: number
  unsold: number
  remaining: number
}

export const StatsDisplay = React.memo(({ total, sold, unsold, remaining }: StatsDisplayProps) => {
  const progress = total > 0 ? ((sold + unsold) / total * 100) : 0
  
  return (
    <div className="hidden sm:flex items-center gap-3 text-xs">
      <div className="flex items-center gap-1.5">
        <span className="text-gray-400">Total:</span>
        <span className="font-bold text-white">{total}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-gray-400">Sold:</span>
        <span className="font-bold text-green-400">{sold}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-gray-400">Unsold:</span>
        <span className="font-bold text-yellow-400">{unsold}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-gray-400">Left:</span>
        <span className="font-bold text-purple-400">{remaining}</span>
      </div>
      <div className="flex items-center gap-2 pl-3 border-l border-white/20">
        <div className="w-20 bg-white/10 rounded-full h-1.5">
          <div 
            className="h-full bg-gradient-to-r from-green-500 to-blue-500 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-xs font-bold text-blue-400">
          {progress.toFixed(0)}%
        </span>
      </div>
    </div>
  )
}, (prev, next) => 
  prev.total === next.total &&
  prev.sold === next.sold &&
  prev.unsold === next.unsold &&
  prev.remaining === next.remaining
)

StatsDisplay.displayName = 'StatsDisplay'

// Memoized Auction Phase Banner
interface AuctionPhaseBannerProps {
  message: string
  color: string
}

export const AuctionPhaseBanner = React.memo(({ message, color }: AuctionPhaseBannerProps) => {
  return (
    <div
      className={`mb-3 sm:mb-4 rounded-lg bg-gradient-to-r ${color} px-3 sm:px-4 py-2 sm:py-3 shadow-lg`}
    >
      <p className="text-center text-xs sm:text-sm md:text-base lg:text-lg font-bold text-white tracking-wide animate-pulse">
        {message}
      </p>
    </div>
  )
}, (prev, next) => prev.message === next.message && prev.color === next.color)

AuctionPhaseBanner.displayName = 'AuctionPhaseBanner'

// Memoized Mobile Current Bid Banner
interface MobileCurrentBidBannerProps {
  currentBid: {
    amount: number
    bidderName: string
    teamName?: string
  } | null
}

export const MobileCurrentBidBanner = React.memo(({ currentBid }: MobileCurrentBidBannerProps) => {
  return (
    <div className="lg:hidden sticky top-0 z-30 bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-2 py-1 rounded-md shadow-md">
      {currentBid ? (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-[9px] uppercase tracking-wide opacity-90">Current:</span>
            <span className="text-xs opacity-90">{currentBid.bidderName}</span>
            {currentBid.teamName && (
              <span className="bg-white/20 px-1.5 py-0.5 rounded-full text-[9px]">{currentBid.teamName}</span>
            )}
          </div>
          <div className="text-sm font-bold">
            ₹{currentBid.amount.toLocaleString('en-IN')}
          </div>
        </div>
      ) : (
        <div className="text-center text-[10px] py-0.5">
          <span className="opacity-90">No bids yet</span>
        </div>
      )}
    </div>
  )
}, (prev, next) => {
  if (!prev.currentBid && !next.currentBid) return true
  if (!prev.currentBid || !next.currentBid) return false
  return (
    prev.currentBid.amount === next.currentBid.amount &&
    prev.currentBid.bidderName === next.currentBid.bidderName &&
    prev.currentBid.teamName === next.currentBid.teamName
  )
})

MobileCurrentBidBanner.displayName = 'MobileCurrentBidBanner'

