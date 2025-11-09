'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { FullScreenCountdown } from './full-screen-countdown'
import { PublicAuctionView } from './public-auction-view'
import { ProfessioPromoButton } from './professio-promo-button'
import Link from 'next/link'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Eye } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface CountdownToLiveWrapperProps {
  auction: {
    id: string
    name: string
    scheduledStartDate: Date | string | null
    status: string
    players: any[]
    bidders: any[]
    [key: string]: any
  }
  initialCurrentPlayer: any
  initialStats: {
    total: number
    sold: number
    unsold: number
    remaining: number
  }
  initialBidHistory: any[]
  bidders: any[]
}

export function CountdownToLiveWrapper({
  auction,
  initialCurrentPlayer,
  initialStats,
  initialBidHistory,
  bidders,
}: CountdownToLiveWrapperProps) {
  const [showCountdown, setShowCountdown] = useState(true)
  const [auctionData, setAuctionData] = useState(auction)
  const [currentPlayer, setCurrentPlayer] = useState(initialCurrentPlayer)
  const [stats, setStats] = useState(initialStats)
  const [bidHistory, setBidHistory] = useState(initialBidHistory)
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const knowPlayersSectionRef = useRef<HTMLDivElement | null>(null)

  const knowYourPlayersCards = useMemo(() => {
    return auction.players.map(player => {
      const playerData = player.data as any
      const imageUrl = (() => {
        const keys = ['Profile Photo', 'profile photo', 'Profile photo', 'PROFILE PHOTO', 'profile_photo', 'ProfilePhoto']
        const value = keys.map(key => playerData?.[key]).find(v => v && String(v).trim())
        if (!value) return undefined
        const photoStr = String(value).trim()
        let match = photoStr.match(/\/d\/([a-zA-Z0-9_-]+)/)
        if (match && match[1]) {
          return `/api/proxy-image?id=${match[1]}`
        }
        match = photoStr.match(/[?&]id=([a-zA-Z0-9_-]+)/)
        if (match && match[1]) {
          return `/api/proxy-image?id=${match[1]}`
        }
        if (photoStr.startsWith('http://') || photoStr.startsWith('https://')) {
          return photoStr
        }
        return undefined
      })()
      const specialty = playerData?.Speciality || playerData?.speciality || playerData?.specialty
      const statsSummary = [
        playerData?.Role || playerData?.role,
        playerData?.Batting || playerData?.batting,
        playerData?.Bowling || playerData?.bowling
      ].filter(Boolean).join(' • ')
      const basePriceRaw = playerData?.['Base Price'] || playerData?.['base price']
      const basePrice = basePriceRaw ? Number(basePriceRaw) : 1000
      const status = player.status

      const statusLabel = status === 'SOLD'
        ? 'Sold'
        : status === 'UNSOLD'
          ? 'Unsold'
          : status === 'RETIRED'
            ? 'Bidder'
            : 'Available'

      return {
        id: player.id,
        name: playerData?.name || playerData?.Name || playerData?.player_name || 'Unknown Player',
        imageUrl,
        specialty,
        statsSummary,
        basePrice,
        statusLabel,
        purchasedPrice: status === 'SOLD' ? (player.soldPrice || 0) : null
      }
    }).sort((a, b) => a.name.localeCompare(b.name))
  }, [auction.players])

  const scrollToKnowPlayers = useCallback(() => {
    knowPlayersSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  // Poll for auction status when countdown reaches zero
  const pollAuctionStatus = useCallback(async () => {
    // Clear any existing polling
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
    }

    pollIntervalRef.current = setInterval(async () => {
      try {
        const response = await fetch(`/api/auctions/${auction.id}/public`)
        if (response.ok) {
          const data = await response.json()
          setAuctionData(data.auction)
          
          // Update all data
          setCurrentPlayer(data.currentPlayer || null)
          setStats(data.stats || initialStats)
          setBidHistory(data.bidHistory || [])
          
          // If auction is now LIVE or PAUSED, stop polling and show live view
          if (data.auction.status === 'LIVE' || data.auction.status === 'PAUSED') {
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current)
              pollIntervalRef.current = null
            }
          }
        }
      } catch (error) {
        console.error('Error polling auction status:', error)
      }
    }, 2000) // Poll every 2 seconds

    // Stop polling after 10 minutes
    setTimeout(() => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
    }, 10 * 60 * 1000)
  }, [auction.id, initialStats])

  // Check if countdown has reached zero
  useEffect(() => {
    if (!auction.scheduledStartDate) {
      setShowCountdown(false)
      return
    }

    const checkCountdown = () => {
      const now = new Date().getTime()
      const startDate = new Date(auction.scheduledStartDate!).getTime()
      const difference = startDate - now

      if (difference <= 0) {
        setShowCountdown(false)
        // Start polling for auction status
        pollAuctionStatus()
      }
    }

    // Check immediately
    checkCountdown()

    // Check every second
    const interval = setInterval(checkCountdown, 1000)

    return () => {
      clearInterval(interval)
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
    }
  }, [auction.scheduledStartDate, pollAuctionStatus])

  // If countdown is still showing
  if (showCountdown && auctionData.status === 'DRAFT') {
    return (
      <div className="min-h-screen w-full bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900 flex flex-col">
        {/* Header with Squady Logo and Professio Branding */}
        <header className="w-full bg-black/20 backdrop-blur-sm border-b border-white/10">
          <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-4">
            <div className="flex items-center justify-between gap-2">
              {/* Squady Logo */}
              <Link href="/" className="flex items-center flex-shrink-0">
                <Image 
                  src="/squady-logo.svg" 
                  alt="Squady" 
                  width={120} 
                  height={40} 
                  className="h-6 sm:h-8 w-auto brightness-0 invert"
                />
              </Link>
              
              {/* Professio Branding - Responsive */}
              <a 
                href="https://professio.ai/" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="inline-flex items-center gap-1 px-2 py-1 sm:px-3 sm:py-1.5 rounded-md border border-white/30 bg-white/10 backdrop-blur-sm text-white text-[9px] sm:text-xs md:text-sm font-semibold hover:bg-white/20 transition-colors shadow-sm"
              >
                <span className="text-[9px] sm:text-xs md:text-sm">Powered by</span>
                <span className="text-[9px] sm:text-xs md:text-sm font-bold">Professio AI</span>
              </a>
            </div>
          </div>
        </header>

        {/* Centered Countdown Content */}
        <div className="flex-1 flex items-center justify-center py-4 sm:py-8">
          <div className="text-center px-3 sm:px-4 w-full max-w-6xl">
            {/* Auction Name */}
            <div className="mb-6 sm:mb-8 md:mb-12 lg:mb-16 space-y-3">
              <h1 className="text-2xl sm:text-3xl md:text-5xl lg:text-6xl xl:text-7xl font-bold text-white mb-2 sm:mb-3 md:mb-4 drop-shadow-lg px-2 break-words">
                {auction.name}
              </h1>
              <p className="text-sm sm:text-base md:text-xl lg:text-2xl text-blue-200">Starting Soon</p>
              <div className="flex justify-center">
                <Button
                  type="button"
                  variant="outline"
                  onClick={scrollToKnowPlayers}
                  className="bg-white/10 hover:bg-white/20 text-white border-white/30 backdrop-blur-sm text-xs sm:text-sm flex items-center gap-1 px-3 py-1.5"
                >
                  <Eye className="h-4 w-4" />
                  Know Your Players
                </Button>
              </div>
            </div>

            {/* Countdown Timer - Full Screen Centered */}
            <FullScreenCountdown 
              scheduledStartDate={auction.scheduledStartDate!}
              auctionName={auction.name}
              onCountdownComplete={() => setShowCountdown(false)}
            />
          </div>
        </div>

        <div ref={knowPlayersSectionRef} id="know-your-players" className="px-4 sm:px-6 lg:px-8 pb-8">
          <Card className="bg-white/90 dark:bg-gray-900/80 border border-gray-200 dark:border-gray-800 shadow-lg">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">Know Your Players</CardTitle>
                  <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 mt-1">Explore the roster before the auction begins.</p>
                </div>
                <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20 text-[10px] sm:text-xs">Player Pool</Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {knowYourPlayersCards.length === 0 ? (
                <div className="text-center py-10 text-gray-500 dark:text-gray-400 text-sm">
                  Player list not available yet. Check back soon!
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6 gap-4">
                  {knowYourPlayersCards.map(card => {
                    const isBidder = card.statusLabel === 'Bidder'
                    return (
                      <div
                        key={card.id}
                        className={`group relative rounded-xl overflow-hidden border shadow-lg transition-shadow duration-500 ${isBidder ? 'border-amber-300 shadow-[0_0_25px_rgba(251,191,36,0.45)] animate-pulse' : 'border-white/10'} bg-gradient-to-br ${isBidder ? 'from-amber-500/20 via-amber-600/10 to-amber-900/30' : 'from-slate-900 via-slate-800 to-slate-900'}`}
                      >
                        <div className="absolute top-3 right-3 z-20">
                          <Badge
                            variant="secondary"
                            className={`${isBidder ? 'bg-amber-400/90 text-amber-950 border border-amber-300 shadow-[0_0_12px_rgba(251,191,36,0.6)]' : 'bg-white/10 text-white'} backdrop-blur px-2 py-1 text-[10px] sm:text-xs`}
                          >
                            {card.statusLabel}
                          </Badge>
                        </div>
                        <div className="absolute inset-0">
                          {card.imageUrl && (
                            <img src={card.imageUrl} alt={card.name} className="h-full w-full object-cover opacity-20 group-hover:opacity-30 transition-opacity" />
                          )}
                          <div className={`absolute inset-0 ${isBidder ? 'bg-gradient-to-b from-amber-400/40 via-amber-900/40 to-black/80' : 'bg-gradient-to-b from-black/60 via-black/80 to-black/90'}`} />
                        </div>
                        <div className="relative z-10 flex flex-col items-center p-4 sm:p-5 text-white text-center space-y-3">
                          <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full border-2 border-white/30 overflow-hidden bg-white/10 flex items-center justify-center">
                            {card.imageUrl ? (
                              <img src={card.imageUrl} alt={card.name} className="w-full h-full object-cover" onError={(e) => { const target = e.currentTarget as HTMLImageElement; target.style.display = 'none' }} />
                            ) : (
                              <span className="text-2xl sm:text-3xl font-bold">{card.name.charAt(0).toUpperCase()}</span>
                            )}
                          </div>
                          <div className="space-y-1">
                            <h4 className="text-base sm:text-lg font-bold line-clamp-2">{card.name}</h4>
                            {card.statusLabel === 'Sold' && (
                              <p className="text-xs sm:text-sm text-white/70">Sold already</p>
                            )}
                            {card.statusLabel === 'Bidder' && (
                              <p className="text-xs sm:text-sm text-amber-200">Registered bidder</p>
                            )}
                            {card.statusLabel === 'Unsold' && (
                              <p className="text-xs sm:text-sm text-white/70">Unsold</p>
                            )}
                          </div>
                          <div className="w-full space-y-1 text-xs sm:text-sm text-white/70">
                            {card.specialty && (
                              <p className="font-medium text-white/80 uppercase tracking-wide text-[10px] sm:text-xs">{card.specialty}</p>
                            )}
                            {card.statsSummary && <p>{card.statsSummary}</p>}
                            {card.statusLabel === 'Bidder' ? (
                              <p className="text-amber-200">Participating as bidder</p>
                            ) : card.purchasedPrice !== null ? (
                              <p>Purchased for <span className="text-white font-semibold">₹{card.purchasedPrice.toLocaleString('en-IN')}</span></p>
                            ) : null}
                            <p>Base price ₹{card.basePrice.toLocaleString('en-IN')}</p>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Professio AI Promo Button at Bottom */}
        <ProfessioPromoButton />
      </div>
    )
  }

  // If countdown reached zero but auction not live yet
  if (!showCountdown && (auctionData.status === 'DRAFT' || auctionData.status === 'PAUSED')) {
    return (
      <div className="min-h-screen w-full bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900 flex flex-col">
        <header className="w-full bg-black/20 backdrop-blur-sm border-b border-white/10">
          <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-4">
            <div className="flex items-center justify-between gap-2">
              <Link href="/" className="flex items-center flex-shrink-0">
                <Image 
                  src="/squady-logo.svg" 
                  alt="Squady" 
                  width={120} 
                  height={40} 
                  className="h-6 sm:h-8 w-auto brightness-0 invert"
                />
              </Link>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={scrollToKnowPlayers}
                  className="bg-white/10 hover:bg-white/20 text-white border-white/30 backdrop-blur-sm text-[10px] sm:text-xs px-2 py-1 flex items-center gap-1"
                >
                  <Eye className="h-3 w-3" />
                  Know Players
                </Button>
                <a 
                  href="https://professio.ai/" 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="inline-flex items-center gap-1 px-2 py-1 sm:px-3 sm:py-1.5 rounded-md border border-white/30 bg-white/10 backdrop-blur-sm text-white text-[9px] sm:text-xs md:text-sm font-semibold hover:bg-white/20 transition-colors shadow-sm"
                >
                  <span className="text-[9px] sm:text-xs md:text-sm">Powered by</span>
                  <span className="text-[9px] sm:text-xs md:text-sm font-bold">Professio AI</span>
                </a>
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 flex items-center justify-center py-4 sm:py-8">
          <div className="text-center px-4 max-w-2xl">
            <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold text-white mb-4">
              {auction.name}
            </h1>
            <p className="text-xl sm:text-2xl md:text-3xl text-blue-200 mb-6">
              Waiting for auction to start...
            </p>
            <div className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-lg p-6 mt-8">
              <p className="text-base sm:text-lg text-purple-200">
                The scheduled time has arrived. The auction will begin shortly.
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Show live auction view with full layout (matching the page.tsx structure)
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      {/* Banner for LIVE/PAUSED published auctions */}
      {auctionData.status === 'LIVE' && (
        <div className="fixed top-0 left-0 right-0 z-[9998] bg-gradient-to-r from-green-600 via-emerald-600 to-teal-600 shadow-lg">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex items-center justify-center gap-3 text-white">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                <h2 className="text-lg md:text-xl font-bold">{auctionData.name}</h2>
              </div>
              <span className="text-sm md:text-base text-green-100">• LIVE - Open to Public</span>
            </div>
          </div>
        </div>
      )}
      {auctionData.status === 'PAUSED' && (
        <div className="fixed top-0 left-0 right-0 z-[9998] bg-gradient-to-r from-yellow-600 via-amber-600 to-orange-600 shadow-lg">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex items-center justify-center gap-3 text-white">
              <h2 className="text-lg md:text-xl font-bold">{auctionData.name}</h2>
              <span className="text-sm md:text-base text-yellow-100">• PAUSED - Open to Public</span>
            </div>
          </div>
        </div>
      )}
      {/* Header for Public View */}
      <header className={`bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 sticky top-0 z-40 ${(auctionData.status === 'LIVE' || auctionData.status === 'PAUSED') ? 'mt-[88px]' : ''}`}>
        <div className="max-w-full mx-auto px-4 sm:px-6">
          <div className="flex justify-between items-center h-16">
            <Link href="/" className="flex items-center">
              <Image src="/squady-logo.svg" alt="Squady" width={120} height={40} className="h-8 w-auto" />
            </Link>
            <div className="flex items-center gap-4">
              <a href="https://professio.ai/" target="_blank" rel="noopener noreferrer" className="hidden sm:inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800 shadow-sm hover:from-purple-100 hover:to-pink-100 dark:hover:from-purple-900/30 dark:hover:to-pink-900/30 animate-pulse">
                <span className="hidden sm:inline">Powered by</span>
                <span className="font-semibold">Professio AI</span>
              </a>
              <Link href="/register">
                <button className="text-sm px-3 py-1.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md">
                  Register
                </button>
              </Link>
              <Link href="/signin">
                <button className="text-sm px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md">
                  Sign In
                </button>
              </Link>
            </div>
          </div>
        </div>
      </header>
      {/* Mobile promo banner */}
      <div className="sm:hidden bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="px-4 py-2 flex justify-center">
          <a href="https://professio.ai/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-2 py-1 rounded-md border text-xs bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800 shadow-sm animate-pulse">
            <span>Powered by</span>
            <span className="font-semibold">Professio AI</span>
          </a>
        </div>
      </div>
      
      {/* Breadcrumbs - Hidden on mobile for public view */}
      <div className="hidden sm:block bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-full mx-auto px-4 sm:px-6 py-3">
          <nav className="flex items-center space-x-1 text-sm text-gray-500 dark:text-gray-400">
            <Link href="/" className="hover:text-gray-700 dark:hover:text-gray-300 flex items-center gap-1">
              <span>Home</span>
            </Link>
            <span>→</span>
            <span className="text-gray-900 dark:text-gray-100 font-medium truncate max-w-xs">
              {auctionData.name} - Live Auction
            </span>
          </nav>
        </div>
      </div>
      
      <PublicAuctionView
        auction={auctionData as any}
        currentPlayer={currentPlayer}
        stats={stats}
        bidHistory={bidHistory}
        bidders={bidders}
      />
    </div>
  )
}

