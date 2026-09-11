'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Instagram, Clock, Trophy, RefreshCw } from 'lucide-react'
import { PROFESSIO_URL_HEADER } from '@/lib/constants'

interface PublicHeaderProps {
  onOpenBidHistory?: () => void // Callback to open bid history modal
  onRefresh?: () => void // Callback to force an immediate snapshot poll
  auctionId?: string // For the "All Players & Teams" link
}

export function PublicHeader({ onOpenBidHistory, onRefresh, auctionId }: PublicHeaderProps) {
  // Brief spin on tap, on top of the idle pulse - the pulse says "you can
  // tap this", the spin confirms "that tap just did something", since a
  // fetch this fast (edge-cached) would otherwise give no feedback at all.
  const [isRefreshing, setIsRefreshing] = useState(false)
  const handleRefreshClick = () => {
    onRefresh?.()
    setIsRefreshing(true)
    setTimeout(() => setIsRefreshing(false), 600)
  }

  return (
    <header className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-14 sm:h-16">
          {/* Left: Logo */}
          <div className="flex items-center flex-shrink-0">
            <Link href="/" className="flex items-center">
              <Image src="/squady-logo.svg" alt="Squady" width={100} height={33} className="h-7 sm:h-8 w-auto" priority />
            </Link>
          </div>
          {/* Right: All Players & Teams + Live Bids + Refresh (mobile) + Instagram + Professio Badge + Buttons */}
          <div className="flex items-center gap-0.5 sm:gap-3">
            {/* All Players & Teams - mobile only, just before Live Bids. The
                desktop stage header already has its own copy of this link -
                on mobile there was previously no way to reach it at all. */}
            {auctionId && (
              <Link href={`/auction/${auctionId}/teams`} target="_blank" rel="noopener noreferrer" className="sm:hidden">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 border-gray-300 dark:border-gray-600"
                  aria-label="View All Players and Teams"
                >
                  <Trophy className="h-4 w-4" />
                </Button>
              </Link>
            )}
            {/* Live Bids Button - Mobile only, first in sequence */}
            {onOpenBidHistory && (
              <Button
                onClick={onOpenBidHistory}
                size="sm"
                className="sm:hidden relative bg-red-600 hover:bg-red-700 text-white h-7 px-2 animate-pulse shadow-lg"
                aria-label="Open Live Bid History"
              >
                <Clock className="h-4 w-4 mr-1" />
                <span className="text-xs font-semibold">Live Bids</span>
              </Button>
            )}
            {/* Refresh - mobile only, right next to Live Bids. Kept visually
                distinct (teal, not red) so it doesn't read as a second
                "something's happening" alert the way Live Bids' pulse does -
                this one just needs to look tappable. The idle pulse says
                "you can tap this"; the brief spin on tap confirms the tap
                did something, since an edge-cached fetch this fast would
                otherwise give no feedback at all. */}
            {onRefresh && (
              <Button
                onClick={handleRefreshClick}
                size="sm"
                className="sm:hidden relative bg-teal-600 hover:bg-teal-700 text-white h-7 px-2 animate-pulse shadow-lg"
                aria-label="Refresh now"
              >
                <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              </Button>
            )}
            {/* Instagram Icon - Always visible */}
            <a
              href="https://www.instagram.com/squady.auction/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-pink-600 dark:text-pink-400 hover:text-pink-700 dark:hover:text-pink-300 transition-colors p-1 sm:p-2"
              aria-label="Follow us on Instagram"
            >
              <Instagram className="h-4 w-4 sm:h-5 sm:w-5" />
            </a>
            {/* Professio Badge - Desktop only */}
            <a href={PROFESSIO_URL_HEADER} target="_blank" rel="noopener noreferrer" className="hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-md border text-xs bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800 shadow-sm hover:from-purple-100 hover:to-pink-100 dark:hover:from-purple-900/30 dark:hover:to-pink-900/30 animate-pulse whitespace-nowrap">
              <span className="hidden md:inline">Powered by</span>
              <span className="font-semibold">Professio AI</span>
            </a>
            {/* Register & Sign In - Desktop only */}
            <div className="hidden md:flex items-center gap-3">
              <Link href="/register">
                <Button variant="ghost" size="sm" className="text-xs sm:text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 h-9">
                  Register
                </Button>
              </Link>
              <Link href="/signin">
                <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white h-9 text-xs sm:text-sm">
                  Sign In
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
