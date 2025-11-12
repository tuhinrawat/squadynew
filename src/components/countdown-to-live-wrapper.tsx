'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { FullScreenCountdown } from './full-screen-countdown'
import { PublicAuctionView } from './public-auction-view'
import { ProfessioPromoButton } from './professio-promo-button'
import Link from 'next/link'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Eye, ExternalLink, Instagram, LogIn, Search, ChevronDown, Calendar } from 'lucide-react'
import { AddToCalendar } from './add-to-calendar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

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
  const [fullScreenImage, setFullScreenImage] = useState<string | null>(null)
  const [playerFilter, setPlayerFilter] = useState<'all' | 'batsmen' | 'bowlers' | 'all-rounders' | 'bidders' | 'bidder-choice'>('all')
  const [searchQuery, setSearchQuery] = useState('')
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
      const role = playerData?.Role || playerData?.role || ''
      const statsSummary = [
        role,
        playerData?.Batting || playerData?.batting,
        playerData?.Bowling || playerData?.bowling
      ].filter(Boolean).join(' • ')
      const basePriceRaw = playerData?.['Base Price'] || playerData?.['base price']
      const basePrice = basePriceRaw ? Number(basePriceRaw) : 1000
      const cricherosLink = (() => {
        const link = playerData?.['Cricheroes Profile link'] || 
                     playerData?.[' Cricheroes Profile link'] ||
                     playerData?.['cricheroes profile link'] ||
                     playerData?.['Cricheros Profile'] || 
                     playerData?.['cricheros profile']
        
        if (link && typeof link === 'string') {
          const urlMatch = link.match(/(https?:\/\/[^\s]+)/i)
          if (urlMatch && urlMatch[1]) {
            return urlMatch[1].trim()
          }
        }
        return undefined
      })()
      const status = player.status
      const isBidder = status === 'RETIRED'
      const isBidderChoice = (player as any).isIcon === true
      const teamName = playerData?.['Team Name'] || playerData?.['team name'] || playerData?.teamName

      const statusLabel = status === 'SOLD'
        ? 'Sold'
        : status === 'UNSOLD'
          ? 'Unsold'
          : isBidder
            ? 'Bidder'
            : 'Available'

      return {
        id: player.id,
        name: playerData?.name || playerData?.Name || playerData?.player_name || 'Unknown Player',
        imageUrl,
        specialty,
        role,
        statsSummary,
        basePrice,
        statusLabel,
        isBidder,
        isBidderChoice,
        teamName,
        purchasedPrice: status === 'SOLD' ? (player.soldPrice || 0) : null,
        cricherosLink
      }
    }).sort((a, b) => a.name.localeCompare(b.name))
  }, [auction.players])

  // Filter players based on selected filter and search query
  const filteredKnowYourPlayersCards = useMemo(() => {
    let filtered = knowYourPlayersCards
    
    // Apply role/type filter
    if (playerFilter !== 'all') {
      filtered = filtered.filter(card => {
        const roleStr = (card.role || '').toLowerCase()
        const specialtyStr = (card.specialty || '').toLowerCase()
        
        switch (playerFilter) {
          case 'batsmen':
            return roleStr.includes('batsman') || roleStr.includes('batter') || specialtyStr.includes('batsman') || specialtyStr.includes('batter')
          case 'bowlers':
            return roleStr.includes('bowler') || specialtyStr.includes('bowler')
          case 'all-rounders':
            return roleStr.includes('all-rounder') || roleStr.includes('allrounder') || roleStr.includes('all rounder') || specialtyStr.includes('all-rounder') || specialtyStr.includes('allrounder')
          case 'bidders':
            return card.isBidder
          case 'bidder-choice':
            return card.isBidderChoice
          default:
            return true
        }
      })
    }
    
    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim()
      filtered = filtered.filter(card => 
        card.name.toLowerCase().includes(query)
      )
    }
    
    return filtered
  }, [knowYourPlayersCards, playerFilter, searchQuery])

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
      <div className="min-h-screen w-full bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900 flex flex-col relative">
        {/* Dark Overlay for more opacity */}
        <div className="absolute inset-0 bg-black/50 z-0"></div>
        
        {/* Content wrapper with higher z-index */}
        <div className="relative z-10 flex flex-col min-h-screen">
        {/* Header - Same as Landing Page */}
        <header className="w-full bg-black/70 backdrop-blur-md border-b border-white/40">
          <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-14 sm:h-16">
              <Link href="/" className="flex flex-col items-start justify-center flex-shrink-0">
                <Image 
                  src="/squady-logo.svg" 
                  alt="Squady" 
                  width={100} 
                  height={33} 
                  className="h-6 sm:h-7 w-auto brightness-0 invert"
                />
                <span className="text-[8px] sm:text-[9px] text-white/60 mt-0.5">Powered by Professio</span>
              </Link>
              <div className="flex items-center gap-0.5 sm:gap-3">
                {/* Instagram Icon */}
                <a
                  href="https://www.instagram.com/squady.auction/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-pink-300 dark:text-pink-400 hover:text-pink-200 dark:hover:text-pink-300 transition-colors p-1 sm:p-2"
                  aria-label="Follow us on Instagram"
                >
                  <Instagram className="h-4 w-4 sm:h-5 sm:w-5" />
                </a>
                {/* Powered by Professio - Desktop only */}
                <a 
                  href="https://professio.ai/?utm_source=squady&utm_medium=referral&utm_campaign=powered_by_badge" 
                target="_blank" 
                rel="noopener noreferrer" 
                  className="hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-md border text-xs border-white/50 bg-white/25 backdrop-blur-md text-white hover:bg-white/35 transition-colors shadow-sm whitespace-nowrap"
                >
                  <span className="hidden md:inline">Powered by</span>
                  <span className="font-semibold">Professio AI</span>
                </a>
                <Link href="/tutorial">
                  <Button variant="ghost" size="sm" className="text-[9px] sm:text-sm text-white hover:text-gray-100 hover:bg-white/20 h-7 sm:h-9 px-1.5 sm:px-3">
                    Tutorial
                  </Button>
                </Link>
                <Link href="/register">
                  <Button variant="ghost" size="sm" className="text-[9px] sm:text-sm text-white hover:text-gray-100 hover:bg-white/20 h-7 sm:h-9 px-1.5 sm:px-3">
                    <span className="hidden sm:inline">Live Auctions</span>
                    <span className="sm:hidden">Auctions</span>
                  </Button>
                </Link>
                <Link href="/signin" className="hidden md:block">
                  <Button variant="ghost" size="sm" className="text-xs sm:text-sm text-white hover:text-gray-100 hover:bg-white/20 h-9">
                    Sign In
                  </Button>
                </Link>
                <Link href="/signup">
                  <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white h-7 sm:h-9 px-1.5 sm:px-4">
                    <span className="hidden sm:inline text-xs sm:text-sm">Get Started</span>
                    <LogIn className="h-4 w-4 sm:hidden" />
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </header>

        {/* Centered Countdown Content */}
        <div className="flex-1 flex items-center justify-center pt-2 sm:pt-8 pb-0">
          <div className="text-center px-3 sm:px-4 w-full max-w-6xl">
            {/* Auction Logo & Name */}
            <div className="mb-3 sm:mb-8 md:mb-12 lg:mb-16 space-y-2 sm:space-y-6">
              {/* Auction Logo - Compact on mobile */}
              {auction.image && (
                <div className="flex flex-col items-center">
                  <div className="relative w-24 h-24 sm:w-40 sm:h-40 md:w-48 md:h-48 lg:w-56 lg:h-56 bg-white/40 backdrop-blur-md rounded-2xl p-3 sm:p-4 border-2 border-white/60 shadow-2xl">
                    <Image 
                      src={auction.image} 
                      alt={auction.name} 
                      fill
                      className="object-contain p-2"
                    />
                  </div>
                </div>
              )}
              
              {/* Auction Name - Compact on mobile */}
              <h1 className="text-2xl sm:text-4xl md:text-6xl lg:text-7xl xl:text-8xl font-bold text-white mb-2 sm:mb-6 drop-shadow-lg px-2 break-words leading-tight">
                {auction.name}
              </h1>
              
              {/* Official Tech Partner Badge - Smaller */}
              <div className="flex flex-col items-center gap-2">
                <div className="flex items-center gap-1.5 px-2 py-1 bg-white/50 backdrop-blur-md rounded-md border border-white/60">
                  <span className="text-white text-[9px] sm:text-[10px] font-medium">Official Tech Partner</span>
                  <div className="h-3 w-px bg-white/70"></div>
                  <Image 
                    src="/squady-logo.svg" 
                    alt="Squady" 
                    width={60} 
                    height={18} 
                    className="h-3 w-auto brightness-0 invert opacity-100"
                  />
                </div>
                {/* Instagram Follow Link */}
                <a
                  href="https://www.instagram.com/squady.auction/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-white/90 hover:text-white transition-colors text-[10px] sm:text-xs font-medium group"
                >
                  <Instagram className="h-3.5 w-3.5 text-pink-300 group-hover:text-pink-200 transition-colors" />
                  <span>Follow Squady on Instagram</span>
                </a>
              </div>
              
              {/* Auction Description - Compact on mobile */}
              {auction.description && (
                <p className="text-xs sm:text-base md:text-lg lg:text-xl text-white/80 px-4 max-w-3xl mx-auto leading-snug">
                  {auction.description}
                </p>
              )}
              
              {/* Action Buttons */}
              <div className="flex flex-row justify-center items-center gap-2 mt-2">
                {/* Add to Calendar Button - Icon only on mobile, full on desktop */}
                {auction.scheduledStartDate && (
                  <>
                    {/* Mobile: Icon Only */}
                    <div className="sm:hidden">
                      <AddToCalendar
                        auctionName={auction.name}
                        auctionDescription={auction.description || `Join us for the ${auction.name} live auction!`}
                        startDate={auction.scheduledStartDate}
                        auctionUrl={typeof window !== 'undefined' ? window.location.href : `https://squady.auction/auction/${auction.id}`}
                        iconOnly={true}
                        className="h-9 w-9"
                      />
                    </div>
                    {/* Desktop: Full Button */}
                    <div className="hidden sm:block">
                      <AddToCalendar
                        auctionName={auction.name}
                        auctionDescription={auction.description || `Join us for the ${auction.name} live auction!`}
                        startDate={auction.scheduledStartDate}
                        auctionUrl={typeof window !== 'undefined' ? window.location.href : `https://squady.auction/auction/${auction.id}`}
                        className="text-xs sm:text-sm px-3 py-1.5"
                      />
                    </div>
                  </>
                )}
                
                {/* Know Your Players Button */}
                <Button
                  type="button"
                  variant="outline"
                  onClick={scrollToKnowPlayers}
                  className="bg-white/35 hover:bg-white/45 text-white border-white/60 backdrop-blur-md text-xs sm:text-sm flex items-center gap-1 px-3 py-1.5 h-9"
                >
                  <Eye className="h-4 w-4" />
                  <span className="hidden xs:inline sm:inline">Know Your Players</span>
                  <span className="xs:hidden sm:hidden">Players</span>
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

        <div ref={knowPlayersSectionRef} id="know-your-players" className="px-4 sm:px-6 lg:px-8 -mt-4 pb-4">
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
              {/* Search and Filter Section */}
              <div className="mb-4 sm:mb-6 space-y-3">
                {/* Search Input */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    type="text"
                    placeholder="Search players by name..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-sm"
                  />
                </div>
                
                {/* Mobile Dropdown Filter */}
                <div className="sm:hidden">
                  <Select value={playerFilter} onValueChange={(value: any) => setPlayerFilter(value)}>
                    <SelectTrigger className="w-full bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600">
                      <SelectValue placeholder="Filter by role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All ({knowYourPlayersCards.length})</SelectItem>
                      <SelectItem value="batsmen">
                        Batsmen ({knowYourPlayersCards.filter(card => {
                          const roleStr = (card.role || '').toLowerCase()
                          const specialtyStr = (card.specialty || '').toLowerCase()
                          return roleStr.includes('batsman') || roleStr.includes('batter') || specialtyStr.includes('batsman') || specialtyStr.includes('batter')
                        }).length})
                      </SelectItem>
                      <SelectItem value="bowlers">
                        Bowlers ({knowYourPlayersCards.filter(card => {
                          const roleStr = (card.role || '').toLowerCase()
                          const specialtyStr = (card.specialty || '').toLowerCase()
                          return roleStr.includes('bowler') || specialtyStr.includes('bowler')
                        }).length})
                      </SelectItem>
                      <SelectItem value="all-rounders">
                        All Rounders ({knowYourPlayersCards.filter(card => {
                          const roleStr = (card.role || '').toLowerCase()
                          const specialtyStr = (card.specialty || '').toLowerCase()
                          return roleStr.includes('all-rounder') || roleStr.includes('allrounder') || roleStr.includes('all rounder') || specialtyStr.includes('all-rounder') || specialtyStr.includes('allrounder')
                        }).length})
                      </SelectItem>
                      <SelectItem value="bidders">Bidders ({knowYourPlayersCards.filter(card => card.isBidder).length})</SelectItem>
                      <SelectItem value="bidder-choice">⭐ Bidder Choice ({knowYourPlayersCards.filter(card => card.isBidderChoice).length})</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                {/* Desktop Filter Buttons */}
                <div className="hidden sm:flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant={playerFilter === 'all' ? 'default' : 'outline'}
                    onClick={() => setPlayerFilter('all')}
                    className={`${
                      playerFilter === 'all'
                        ? 'bg-blue-600 text-white hover:bg-blue-700'
                        : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'
                    } text-xs sm:text-sm px-3 sm:px-4 py-1.5 sm:py-2`}
                  >
                    All ({knowYourPlayersCards.length})
                  </Button>
                  <Button
                    size="sm"
                    variant={playerFilter === 'batsmen' ? 'default' : 'outline'}
                    onClick={() => setPlayerFilter('batsmen')}
                    className={`${
                      playerFilter === 'batsmen'
                        ? 'bg-blue-600 text-white hover:bg-blue-700'
                        : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'
                    } text-xs sm:text-sm px-3 sm:px-4 py-1.5 sm:py-2`}
                  >
                    Batsmen ({knowYourPlayersCards.filter(card => {
                      const roleStr = (card.role || '').toLowerCase()
                      const specialtyStr = (card.specialty || '').toLowerCase()
                      return roleStr.includes('batsman') || roleStr.includes('batter') || specialtyStr.includes('batsman') || specialtyStr.includes('batter')
                    }).length})
                  </Button>
                  <Button
                    size="sm"
                    variant={playerFilter === 'bowlers' ? 'default' : 'outline'}
                    onClick={() => setPlayerFilter('bowlers')}
                    className={`${
                      playerFilter === 'bowlers'
                        ? 'bg-blue-600 text-white hover:bg-blue-700'
                        : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'
                    } text-xs sm:text-sm px-3 sm:px-4 py-1.5 sm:py-2`}
                  >
                    Bowlers ({knowYourPlayersCards.filter(card => {
                      const roleStr = (card.role || '').toLowerCase()
                      const specialtyStr = (card.specialty || '').toLowerCase()
                      return roleStr.includes('bowler') || specialtyStr.includes('bowler')
                    }).length})
                  </Button>
                  <Button
                    size="sm"
                    variant={playerFilter === 'all-rounders' ? 'default' : 'outline'}
                    onClick={() => setPlayerFilter('all-rounders')}
                    className={`${
                      playerFilter === 'all-rounders'
                        ? 'bg-blue-600 text-white hover:bg-blue-700'
                        : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'
                    } text-xs sm:text-sm px-3 sm:px-4 py-1.5 sm:py-2 whitespace-nowrap`}
                  >
                    All Rounders ({knowYourPlayersCards.filter(card => {
                      const roleStr = (card.role || '').toLowerCase()
                      const specialtyStr = (card.specialty || '').toLowerCase()
                      return roleStr.includes('all-rounder') || roleStr.includes('allrounder') || roleStr.includes('all rounder') || specialtyStr.includes('all-rounder') || specialtyStr.includes('allrounder')
                    }).length})
                  </Button>
                  <Button
                    size="sm"
                    variant={playerFilter === 'bidders' ? 'default' : 'outline'}
                    onClick={() => setPlayerFilter('bidders')}
                    className={`${
                      playerFilter === 'bidders'
                        ? 'bg-blue-600 text-white hover:bg-blue-700'
                        : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'
                    } text-xs sm:text-sm px-3 sm:px-4 py-1.5 sm:py-2`}
                  >
                    Bidders ({knowYourPlayersCards.filter(card => card.isBidder).length})
                  </Button>
                  <Button
                    size="sm"
                    variant={playerFilter === 'bidder-choice' ? 'default' : 'outline'}
                    onClick={() => setPlayerFilter('bidder-choice')}
                    className={`${
                      playerFilter === 'bidder-choice'
                        ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white hover:from-purple-700 hover:to-pink-700 border-0'
                        : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'
                    } text-xs sm:text-sm px-3 sm:px-4 py-1.5 sm:py-2 whitespace-nowrap`}
                  >
                    ⭐ Bidder Choice ({knowYourPlayersCards.filter(card => card.isBidderChoice).length})
                  </Button>
                </div>
              </div>

              {filteredKnowYourPlayersCards.length === 0 ? (
                <div className="text-center py-10 text-gray-500 dark:text-gray-400 text-sm">
                  {knowYourPlayersCards.length === 0 
                    ? 'Player list not available yet. Check back soon!' 
                    : `No players found${playerFilter !== 'all' ? ` for ${playerFilter}` : ''}.`}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
                  {filteredKnowYourPlayersCards.map(card => {
                    const isBidder = card.statusLabel === 'Bidder'
                    return (
                      <div
                        key={card.id}
                        className={`group relative rounded-2xl overflow-hidden border-2 shadow-xl transition-all hover:scale-[1.02] ${isBidder ? 'border-violet-400 shadow-[0_0_20px_rgba(168,85,247,0.6)] bg-gradient-to-br from-violet-900 via-purple-900 to-slate-950' : 'border-white/20 bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950'} max-w-md mx-auto w-full`}
                      >
                        {/* Bidder Choice Badge - Top Left */}
                        {card.isBidderChoice && (
                          <div className="absolute top-2 left-2 sm:top-3 sm:left-3 z-20">
                            <Badge
                              variant="secondary"
                              className="bg-gradient-to-r from-purple-500 to-pink-500 text-white border border-purple-300 backdrop-blur px-2 py-1 text-[9px] sm:text-xs font-bold"
                            >
                              ⭐ BIDDER CHOICE
                            </Badge>
                          </div>
                        )}

                        {/* Status Badge - Top Right */}
                        <div className="absolute top-2 right-2 sm:top-3 sm:right-3 z-20">
                          <Badge
                            variant="secondary"
                            className={`${isBidder ? 'bg-violet-200 text-violet-950 border border-violet-300' : 'bg-white/10 text-white'} backdrop-blur px-2 py-1 text-[9px] sm:text-xs font-bold`}
                          >
                            {card.statusLabel}
                          </Badge>
                        </div>

                        {/* Player Photo - Portrait Style */}
                        <div 
                          className="relative h-48 sm:h-56 bg-gradient-to-b from-slate-700 to-slate-900 flex items-center justify-center cursor-pointer group/photo"
                          onClick={() => card.imageUrl && setFullScreenImage(card.imageUrl)}
                        >
                          {card.imageUrl ? (
                            <>
                              <img
                                src={card.imageUrl}
                                alt={card.name}
                                className="w-full h-full object-contain p-2"
                                loading="lazy"
                                decoding="async"
                                onError={(e) => {
                                  const target = e.currentTarget as HTMLImageElement
                                  target.style.display = 'none'
                                }}
                              />
                              {/* Hover overlay with zoom icon */}
                              <div className="absolute inset-0 bg-black/0 group-hover/photo:bg-black/40 transition-all duration-200 flex items-center justify-center">
                                <Eye className="h-8 w-8 sm:h-10 sm:w-10 text-white opacity-0 group-hover/photo:opacity-100 transition-opacity duration-200" />
                              </div>
                            </>
                          ) : (
                            <div className="w-28 h-28 sm:w-32 sm:h-32 rounded-full bg-white/20 flex items-center justify-center">
                              <span className="text-4xl sm:text-5xl font-bold text-white">
                                {card.name.charAt(0).toUpperCase()}
                              </span>
                            </div>
                          )}
                          <div className={`absolute inset-0 ${isBidder ? 'bg-gradient-to-t from-purple-900 via-transparent to-transparent' : 'bg-gradient-to-t from-slate-900 via-transparent to-transparent'}`} />
                        </div>

                        {/* Player Info */}
                        <div className="p-3 sm:p-4 space-y-2">
                          {/* Name with Cricheros Icon */}
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="text-white font-black text-sm sm:text-lg line-clamp-2 flex-1">
                                {card.name}
                              </h4>
                              {card.cricherosLink && (
                                <a
                                  href={card.cricherosLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex-shrink-0 px-2 py-0.5 bg-green-600/20 hover:bg-green-600/40 text-green-400 hover:text-green-300 rounded transition-colors duration-200 border border-green-500/30 text-[9px] sm:text-[10px] font-semibold"
                                  onClick={(e) => e.stopPropagation()}
                                  title="View Cricheroes Profile"
                                >
                                  Cricheroes.com
                                </a>
                            )}
                          </div>
                            {/* Team Name for Bidders */}
                            {isBidder && card.teamName && (
                              <p className="text-violet-300 text-[10px] sm:text-xs font-bold tracking-wide truncate mt-1">
                                {card.teamName}
                              </p>
                            )}
                            {card.specialty && (
                              <p className="text-yellow-400 text-[10px] sm:text-xs font-bold uppercase tracking-wide truncate">{card.specialty}</p>
                            )}
                          </div>

                          {/* Price Info */}
                          <div className="space-y-1.5">
                            {isBidder ? (
                              <div className="bg-violet-500/20 border border-violet-400/30 rounded-lg p-2 text-center">
                                <p className="text-violet-200 text-[9px] sm:text-[10px] font-semibold">PARTICIPATING</p>
                                <p className="text-white text-xs sm:text-sm font-bold">As Bidder</p>
                              </div>
                            ) : card.purchasedPrice !== null ? (
                              <div className="bg-gradient-to-r from-green-600 to-emerald-600 rounded-lg p-2 text-center border-2 border-green-400/30">
                                <p className="text-green-200 text-[9px] sm:text-[10px] font-semibold">PURCHASED FOR</p>
                                <p className="text-white font-black text-base sm:text-lg break-words">₹{card.purchasedPrice.toLocaleString('en-IN')}</p>
                              </div>
                            ) : (
                              <div className="bg-white/5 rounded-lg p-2 border border-white/10">
                                <div className="flex items-center justify-between">
                                  <span className="text-white/60 text-[9px] sm:text-[10px]">Base Price</span>
                                  <span className="text-white font-bold text-xs sm:text-sm">₹{card.basePrice.toLocaleString('en-IN')}</span>
                                </div>
                              </div>
                            )}
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
        
        {/* Full Screen Image Modal */}
        <Dialog open={!!fullScreenImage} onOpenChange={(o) => { if (!o) setFullScreenImage(null) }}>
          <DialogContent className="max-w-full w-full h-full p-0 bg-black/95">
            <button
              onClick={() => setFullScreenImage(null)}
              className="absolute top-4 right-4 z-50 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
              aria-label="Close"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <div className="flex items-center justify-center w-full h-full p-4">
              {fullScreenImage && (
                <img
                  src={fullScreenImage}
                  alt="Player"
                  className="max-w-full max-h-full object-contain"
                />
              )}
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>
    )
  }

  // If countdown reached zero but auction not live yet
  if (!showCountdown && (auctionData.status === 'DRAFT' || auctionData.status === 'PAUSED')) {
    return (
      <div className="min-h-screen w-full bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900 flex flex-col relative">
        {/* Dark Overlay for more opacity */}
        <div className="absolute inset-0 bg-black/50 z-0"></div>
        
        {/* Content wrapper with higher z-index */}
        <div className="relative z-10 flex flex-col min-h-screen">
        {/* Header - Same as Landing Page */}
        <header className="w-full bg-black/70 backdrop-blur-md border-b border-white/40">
          <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-14 sm:h-16">
              <Link href="/" className="flex flex-col items-start justify-center flex-shrink-0">
                <Image 
                  src="/squady-logo.svg" 
                  alt="Squady" 
                  width={100} 
                  height={33} 
                  className="h-6 sm:h-7 w-auto brightness-0 invert"
                />
                <span className="text-[8px] sm:text-[9px] text-white/60 mt-0.5">Powered by Professio</span>
              </Link>
              <div className="flex items-center gap-0.5 sm:gap-3">
                {/* Instagram Icon */}
                <a
                  href="https://www.instagram.com/squady.auction/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-pink-300 dark:text-pink-400 hover:text-pink-200 dark:hover:text-pink-300 transition-colors p-1 sm:p-2"
                  aria-label="Follow us on Instagram"
                >
                  <Instagram className="h-4 w-4 sm:h-5 sm:w-5" />
                </a>
                {/* Powered by Professio - Desktop only */}
                <a 
                  href="https://professio.ai/?utm_source=squady&utm_medium=referral&utm_campaign=powered_by_badge" 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-md border text-xs border-white/50 bg-white/25 backdrop-blur-md text-white hover:bg-white/35 transition-colors shadow-sm whitespace-nowrap"
                >
                  <span className="hidden md:inline">Powered by</span>
                  <span className="font-semibold">Professio AI</span>
                </a>
                <Link href="/tutorial">
                  <Button variant="ghost" size="sm" className="text-[9px] sm:text-sm text-white hover:text-gray-100 hover:bg-white/20 h-7 sm:h-9 px-1.5 sm:px-3">
                    Tutorial
                  </Button>
                </Link>
                <Link href="/register">
                  <Button variant="ghost" size="sm" className="text-[9px] sm:text-sm text-white hover:text-gray-100 hover:bg-white/20 h-7 sm:h-9 px-1.5 sm:px-3">
                    <span className="hidden sm:inline">Live Auctions</span>
                    <span className="sm:hidden">Auctions</span>
                  </Button>
                </Link>
                <Link href="/signin" className="hidden md:block">
                  <Button variant="ghost" size="sm" className="text-xs sm:text-sm text-white hover:text-gray-100 hover:bg-white/20 h-9">
                    Sign In
                  </Button>
                </Link>
                <Link href="/signup">
                  <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white h-7 sm:h-9 px-1.5 sm:px-4">
                    <span className="hidden sm:inline text-xs sm:text-sm">Get Started</span>
                    <LogIn className="h-4 w-4 sm:hidden" />
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 flex items-center justify-center py-4 sm:py-8">
          <div className="text-center px-4 max-w-2xl">
            <div className="space-y-4 sm:space-y-6">
              {/* Auction Logo */}
              {auctionData.image && (
                <div className="flex flex-col items-center">
                  <div className="relative w-32 h-32 sm:w-40 sm:h-40 md:w-48 md:h-48 bg-white/40 backdrop-blur-md rounded-2xl p-4 border-2 border-white/60 shadow-2xl">
                    <Image 
                      src={auctionData.image} 
                      alt={auctionData.name} 
                      fill
                      className="object-contain p-2"
                    />
                  </div>
                </div>
              )}
              
              {/* Auction Name - Bigger and prominent */}
              <h1 className="text-3xl sm:text-4xl md:text-6xl lg:text-7xl xl:text-8xl font-bold text-white mb-4 sm:mb-6 drop-shadow-lg px-2 break-words">
              {auction.name}
            </h1>
              
              {/* Official Tech Partner Badge - Smaller */}
              <div className="flex flex-col items-center gap-2">
                <div className="flex items-center gap-1.5 px-2 py-1 bg-white/50 backdrop-blur-md rounded-md border border-white/60">
                  <span className="text-white text-[9px] sm:text-[10px] font-medium">Official Tech Partner</span>
                  <div className="h-3 w-px bg-white/70"></div>
                  <Image 
                    src="/squady-logo.svg" 
                    alt="Squady" 
                    width={60} 
                    height={18} 
                    className="h-3 w-auto brightness-0 invert opacity-100"
                  />
                </div>
                {/* Instagram Follow Link */}
                <a
                  href="https://www.instagram.com/squady.auction/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-white/90 hover:text-white transition-colors text-[10px] sm:text-xs font-medium group"
                >
                  <Instagram className="h-3.5 w-3.5 text-pink-300 group-hover:text-pink-200 transition-colors" />
                  <span>Follow Squady on Instagram</span>
                </a>
              </div>
              
              {/* Auction Description */}
              {auctionData.description && (
                <p className="text-sm sm:text-base md:text-lg text-white/80 px-4 max-w-2xl mx-auto">
                  {auctionData.description}
                </p>
              )}
              
              {/* Waiting Message */}
              <div className="mt-8">
            <p className="text-xl sm:text-2xl md:text-3xl text-blue-200 mb-6">
              Waiting for auction to start...
            </p>
                <div className="bg-white/40 backdrop-blur-md border border-white/60 rounded-lg p-6">
              <p className="text-base sm:text-lg text-purple-200">
                The scheduled time has arrived. The auction will begin shortly.
              </p>
                </div>
              </div>
            </div>
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
              <a href="https://professio.ai/?utm_source=squady&utm_medium=referral&utm_campaign=powered_by_badge" target="_blank" rel="noopener noreferrer" className="hidden sm:inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800 shadow-sm hover:from-purple-100 hover:to-pink-100 dark:hover:from-purple-900/30 dark:hover:to-pink-900/30 animate-pulse">
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
          <a href="https://professio.ai/?utm_source=squady&utm_medium=referral&utm_campaign=powered_by_badge" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-2 py-1 rounded-md border text-xs bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800 shadow-sm animate-pulse">
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

