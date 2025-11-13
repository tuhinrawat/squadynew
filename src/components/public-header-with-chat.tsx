'use client'

import Link from 'next/link'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Instagram, Clock } from 'lucide-react'
import { TawkChat } from '@/components/tawk-chat'
import { PROFESSIO_URL_HEADER } from '@/lib/constants'

interface PublicHeaderWithChatProps {
  auctionId: string
  onOpenBidHistory?: () => void // Callback to open bid history modal
}

export function PublicHeaderWithChat({ auctionId, onOpenBidHistory }: PublicHeaderWithChatProps) {
  // Tidio handles its own chat UI with a floating button, so we don't need a chat icon in header

  return (
    <>
      <header className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-14 sm:h-16">
            {/* Left: Logo */}
            <div className="flex items-center flex-shrink-0">
              <Link href="/" className="flex items-center">
                <Image src="/squady-logo.svg" alt="Squady" width={100} height={33} className="h-7 sm:h-8 w-auto" />
              </Link>
            </div>
            {/* Right: Live Bids (mobile) + Instagram + Chat Icon + Professio Badge + Buttons */}
            <div className="flex items-center gap-0.5 sm:gap-3">
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
              {/* Chat handled by Tidio widget - no icon needed */}
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
      
      {/* Tawk.to Chat Widget - Mobile optimized, per-auction context */}
      <TawkChat auctionId={auctionId} />
    </>
  )
}

