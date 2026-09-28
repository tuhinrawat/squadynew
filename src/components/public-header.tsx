'use client'

import Link from 'next/link'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Instagram, Trophy } from 'lucide-react'

interface PublicHeaderProps {
  auctionId?: string // For the "All Players & Teams" link
}

export function PublicHeader({ auctionId }: PublicHeaderProps) {
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
          {/* Right: All Players & Teams + Instagram + Buttons */}
          <div className="flex items-center gap-0.5 sm:gap-3">
            {/* All Players & Teams - mobile only. The desktop stage header
                already has its own copy of this link - on mobile there was
                previously no way to reach it at all. */}
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
