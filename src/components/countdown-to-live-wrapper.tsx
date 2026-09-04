'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { FullScreenCountdown } from './full-screen-countdown'
import { PublicAuctionView } from './public-auction-view'
import { ProfessioPromoButton } from './professio-promo-button'
import FloatingPromoChip from './floating-promo-chip'
import Link from 'next/link'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Eye, ExternalLink, Instagram, LogIn, Search, ChevronDown, Calendar, ArrowUpDown } from 'lucide-react'
import { AddToCalendar } from './add-to-calendar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { isLiveStatus } from '@/lib/auction-status'
import { extractCricheroesLink } from '@/lib/cricheroes'
import { extractBattingStats, extractBowlingStats } from '@/lib/cricket-stats'
import { BatIcon, BallIcon } from '@/components/cricket-stat-ui'
import { PlayerStatsDialog } from '@/components/player-stats-dialog'
import { AuctionStatus } from '@prisma/client'

interface CountdownToLiveWrapperProps {
  auction: {
    id: string
    name: string
    scheduledStartDate: Date | string | null
    status: AuctionStatus
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

// Maps a player's existing role/speciality text to a discipline flag's label
// and color - purely presentational, reusing the same substring checks the
// filter buttons below already use, so a card's flag always agrees with
// which filter bucket it falls into.
function getRoleFlag(role?: string, specialty?: string): { label: string; background: string; color: string } | null {
  const text = `${role || ''} ${specialty || ''}`.toLowerCase()
  if (text.includes('wicket') || text.includes('keeper')) {
    return { label: 'Wicketkeeper', background: 'rgba(255,255,255,0.92)', color: '#05070a' }
  }
  if (text.includes('all-rounder') || text.includes('allrounder') || text.includes('all rounder')) {
    return { label: 'All-Rounder', background: 'linear-gradient(90deg,#a855f7,#ec4899)', color: '#ffffff' }
  }
  if (text.includes('bowler')) {
    return { label: 'Bowler', background: '#14b8a6', color: '#04211d' }
  }
  if (text.includes('batsman') || text.includes('batter')) {
    return { label: 'Batsman', background: '#fbbf24', color: '#1a1200' }
  }
  return null
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
  // Sorts by lastYearPrice (see auction-history.ts) - the price this player
  // actually went for in a linked previous auction, not this auction's
  // current/base price. Players with no match sort to the end regardless
  // of direction, rather than reading as a "free" ₹0 in ascending order.
  const [sortOrder, setSortOrder] = useState<'default' | 'price-desc' | 'price-asc'>('price-desc')
  // One shared "View More" stats dialog for the whole grid, rather than one
  // per card - avoids mounting a dialog per player when there can be
  // hundreds in the pool.
  const [statsDialogTarget, setStatsDialogTarget] = useState<{ id: string; discipline: 'batting' | 'bowling' } | null>(null)
  // Renders the pool in pages instead of mounting every filtered card's DOM
  // at once - a pool of 500-1000+ players otherwise mounts tens of
  // thousands of DOM nodes simultaneously, which visibly jank scrolling and
  // filtering especially on mobile.
  const KNOW_PLAYERS_PAGE_SIZE = 60
  const [knowPlayersVisibleCount, setKnowPlayersVisibleCount] = useState(KNOW_PLAYERS_PAGE_SIZE)
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const knowPlayersSectionRef = useRef<HTMLDivElement | null>(null)
  const timerViewTrackedRef = useRef(false)

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
      const cricherosLink = extractCricheroesLink(playerData)
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
        cricherosLink,
        lastYearPrice: player.lastYearPrice as number | null | undefined,
        lastYearTeamName: player.lastYearTeamName as string | null | undefined,
        battingStats: extractBattingStats(playerData),
        bowlingStats: extractBowlingStats(playerData),
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

    // Sort by last year's price - players with no matched price always sort
    // to the end, in both directions, rather than reading as a ₹0 bid.
    if (sortOrder !== 'default') {
      filtered = [...filtered].sort((a, b) => {
        const aPrice = a.lastYearPrice
        const bPrice = b.lastYearPrice
        if (aPrice == null && bPrice == null) return 0
        if (aPrice == null) return 1
        if (bPrice == null) return -1
        return sortOrder === 'price-desc' ? bPrice - aPrice : aPrice - bPrice
      })
    }

    return filtered
  }, [knowYourPlayersCards, playerFilter, searchQuery, sortOrder])

  // Back to the first page whenever the filtered set itself changes -
  // otherwise switching filters could leave visibleCount referring to a
  // page deep into a now-different, possibly much smaller list.
  useEffect(() => {
    setKnowPlayersVisibleCount(KNOW_PLAYERS_PAGE_SIZE)
  }, [playerFilter, searchQuery, sortOrder])

  const visibleKnowYourPlayersCards = useMemo(
    () => filteredKnowYourPlayersCards.slice(0, knowPlayersVisibleCount),
    [filteredKnowYourPlayersCards, knowPlayersVisibleCount]
  )

  // Counts shown next to each filter option (e.g. "Batsmen (12)") - computed
  // once here instead of re-scanning the full (unfiltered) player list with
  // a fresh .filter() call inline in JSX for every option, in both the
  // mobile dropdown and the desktop button row, on every render.
  const filterCounts = useMemo(() => {
    let batsmen = 0, bowlers = 0, allRounders = 0, bidders = 0, bidderChoice = 0
    for (const card of knowYourPlayersCards) {
      const roleStr = (card.role || '').toLowerCase()
      const specialtyStr = (card.specialty || '').toLowerCase()
      if (roleStr.includes('batsman') || roleStr.includes('batter') || specialtyStr.includes('batsman') || specialtyStr.includes('batter')) batsmen++
      if (roleStr.includes('bowler') || specialtyStr.includes('bowler')) bowlers++
      if (roleStr.includes('all-rounder') || roleStr.includes('allrounder') || roleStr.includes('all rounder') || specialtyStr.includes('all-rounder') || specialtyStr.includes('allrounder')) allRounders++
      if (card.isBidder) bidders++
      if (card.isBidderChoice) bidderChoice++
    }
    return { all: knowYourPlayersCards.length, batsmen, bowlers, allRounders, bidders, bidderChoice }
  }, [knowYourPlayersCards])

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
          setAuctionData({ ...data.auction, status: data.auction.status as AuctionStatus })
          
          // Update all data
          setCurrentPlayer(data.currentPlayer || null)
          setStats(data.stats || initialStats)
          setBidHistory(data.bidHistory || [])
          
          // If auction is now LIVE/MOCK_RUN or PAUSED, stop polling and show live view
          if (isLiveStatus(data.auction.status as AuctionStatus) || data.auction.status === 'PAUSED') {
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

  // Track timer view on mount (only once)
  useEffect(() => {
    if (timerViewTrackedRef.current) return
    
    const trackTimerView = async () => {
      try {
        await fetch(`/api/auction/${auction.id}/track-timer-view`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
        timerViewTrackedRef.current = true
      } catch (error) {
        console.error('Failed to track timer view:', error)
      }
    }
    
    trackTimerView()
  }, [auction.id])

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

        {/* Centered Countdown Content - stadium-scoreboard treatment: floodlight
            beams + a diagonal amber wedge, echoing the live auction stage's own
            header wedge (public-auction-view.tsx) at hero scale. */}
        <div className="flex-1 flex items-center justify-center pt-2 sm:pt-8 pb-0 relative overflow-hidden">
          <div className="hidden sm:block absolute -top-[10%] left-[4%] w-32 h-[80%] origin-top bg-gradient-to-b from-amber-400/20 to-transparent blur-sm rotate-[-9deg] pointer-events-none" />
          <div className="hidden sm:block absolute -top-[10%] right-[4%] w-32 h-[80%] origin-top bg-gradient-to-b from-teal-400/20 to-transparent blur-sm rotate-[9deg] pointer-events-none" />

          <div className="text-center px-3 sm:px-4 w-full max-w-6xl relative">
            {/* Auction Logo & Name */}
            <div className="mb-3 sm:mb-8 md:mb-12 lg:mb-16 space-y-2 sm:space-y-6">
              {/* Auction Logo - Compact on mobile */}
              {auction.image && (
                <div className="flex flex-col items-center">
                  <div className="relative w-24 h-24 sm:w-40 sm:h-40 md:w-48 md:h-48 lg:w-56 lg:h-56 bg-white/40 backdrop-blur-md rounded-2xl p-3 sm:p-4 border-2 border-amber-400/50 shadow-2xl" style={{ boxShadow: '0 0 40px rgba(251,191,36,0.25)' }}>
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
                  onClick={scrollToKnowPlayers}
                  className="bg-amber-400 hover:bg-amber-300 text-[#1a1200] font-bold border-0 text-xs sm:text-sm flex items-center gap-1 px-3 py-1.5 h-9"
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
          <Card className="bg-[#0d1015]/95 border border-white/10 shadow-lg backdrop-blur-md">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base sm:text-lg font-black uppercase tracking-tight text-white">Know Your Players</CardTitle>
                  <p className="text-xs sm:text-sm text-white/50 mt-1">Walk the tunnel before the gates open.</p>
                </div>
                <Badge className="bg-amber-400/15 text-amber-400 border-amber-400/30 text-[10px] sm:text-xs">Player Pool</Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {/* Search and Filter Section */}
              <div className="mb-4 sm:mb-6 space-y-3">
                {/* Search Input */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-white/35" />
                  <Input
                    type="text"
                    placeholder="Search players by name..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 bg-white/[0.06] border-white/15 text-white placeholder:text-white/35 text-sm"
                  />
                </div>

                {/* Mobile Dropdown Filter */}
                <div className="sm:hidden">
                  <Select value={playerFilter} onValueChange={(value: any) => setPlayerFilter(value)}>
                    <SelectTrigger className="w-full bg-white/[0.06] border-white/15 text-white">
                      <SelectValue placeholder="Filter by role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All ({filterCounts.all})</SelectItem>
                      <SelectItem value="batsmen">Batsmen ({filterCounts.batsmen})</SelectItem>
                      <SelectItem value="bowlers">Bowlers ({filterCounts.bowlers})</SelectItem>
                      <SelectItem value="all-rounders">All Rounders ({filterCounts.allRounders})</SelectItem>
                      <SelectItem value="bidders">Bidders ({filterCounts.bidders})</SelectItem>
                      <SelectItem value="bidder-choice">⭐ Bidder Choice ({filterCounts.bidderChoice})</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Mobile Sort - last year's price, high-low or low-high */}
                <div className="sm:hidden">
                  <Select value={sortOrder} onValueChange={(value: 'default' | 'price-desc' | 'price-asc') => setSortOrder(value)}>
                    <SelectTrigger className="w-full bg-white/[0.06] border-white/15 text-white">
                      <div className="flex items-center gap-2">
                        <ArrowUpDown className="h-3.5 w-3.5 text-white/40" />
                        <SelectValue placeholder="Sort by last year price" />
                      </div>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Default order</SelectItem>
                      <SelectItem value="price-desc">Last Year Price: High to Low</SelectItem>
                      <SelectItem value="price-asc">Last Year Price: Low to High</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Desktop Filter Buttons */}
                <div className="hidden sm:flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => setPlayerFilter('all')}
                    className={`${
                      playerFilter === 'all'
                        ? 'bg-amber-400 text-[#1a1200] hover:bg-amber-300'
                        : 'bg-white/[0.06] text-white/65 border border-white/15 hover:bg-white/10'
                    } text-xs sm:text-sm px-3 sm:px-4 py-1.5 sm:py-2 rounded-full font-bold`}
                  >
                    All ({filterCounts.all})
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setPlayerFilter('batsmen')}
                    className={`${
                      playerFilter === 'batsmen'
                        ? 'bg-amber-400 text-[#1a1200] hover:bg-amber-300'
                        : 'bg-white/[0.06] text-white/65 border border-white/15 hover:bg-white/10'
                    } text-xs sm:text-sm px-3 sm:px-4 py-1.5 sm:py-2 rounded-full font-bold`}
                  >
                    Batsmen ({filterCounts.batsmen})
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setPlayerFilter('bowlers')}
                    className={`${
                      playerFilter === 'bowlers'
                        ? 'bg-amber-400 text-[#1a1200] hover:bg-amber-300'
                        : 'bg-white/[0.06] text-white/65 border border-white/15 hover:bg-white/10'
                    } text-xs sm:text-sm px-3 sm:px-4 py-1.5 sm:py-2 rounded-full font-bold`}
                  >
                    Bowlers ({filterCounts.bowlers})
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setPlayerFilter('all-rounders')}
                    className={`${
                      playerFilter === 'all-rounders'
                        ? 'bg-amber-400 text-[#1a1200] hover:bg-amber-300'
                        : 'bg-white/[0.06] text-white/65 border border-white/15 hover:bg-white/10'
                    } text-xs sm:text-sm px-3 sm:px-4 py-1.5 sm:py-2 rounded-full font-bold whitespace-nowrap`}
                  >
                    All Rounders ({filterCounts.allRounders})
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setPlayerFilter('bidders')}
                    className={`${
                      playerFilter === 'bidders'
                        ? 'bg-amber-400 text-[#1a1200] hover:bg-amber-300'
                        : 'bg-white/[0.06] text-white/65 border border-white/15 hover:bg-white/10'
                    } text-xs sm:text-sm px-3 sm:px-4 py-1.5 sm:py-2 rounded-full font-bold`}
                  >
                    Bidders ({filterCounts.bidders})
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setPlayerFilter('bidder-choice')}
                    className={`${
                      playerFilter === 'bidder-choice'
                        ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-600 hover:to-pink-600 border-0'
                        : 'bg-white/[0.06] text-white/65 border border-white/15 hover:bg-white/10'
                    } text-xs sm:text-sm px-3 sm:px-4 py-1.5 sm:py-2 rounded-full font-bold whitespace-nowrap`}
                  >
                    ⭐ Bidder Choice ({filterCounts.bidderChoice})
                  </Button>

                  {/* Sort - last year's price, high-low or low-high */}
                  <Select value={sortOrder} onValueChange={(value: 'default' | 'price-desc' | 'price-asc') => setSortOrder(value)}>
                    <SelectTrigger className="w-auto ml-auto bg-white/[0.06] border-white/15 text-white text-xs sm:text-sm h-8 sm:h-9 gap-1.5">
                      <ArrowUpDown className="h-3.5 w-3.5 text-white/40" />
                      <SelectValue placeholder="Sort" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Default order</SelectItem>
                      <SelectItem value="price-desc">Last Year Price: High to Low</SelectItem>
                      <SelectItem value="price-asc">Last Year Price: Low to High</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {filteredKnowYourPlayersCards.length === 0 ? (
                <div className="text-center py-10 text-white/40 text-sm">
                  {knowYourPlayersCards.length === 0
                    ? 'Player list not available yet. Check back soon!'
                    : `No players found${playerFilter !== 'all' ? ` for ${playerFilter}` : ''}.`}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
                  {visibleKnowYourPlayersCards.map(card => {
                    const isBidder = card.statusLabel === 'Bidder'
                    // Discipline flag on the top border - null for a bidder/team
                    // card (it has no batting/bowling role) or when the source
                    // data simply doesn't say what role a player plays.
                    const roleFlag = !isBidder ? getRoleFlag(card.role, card.specialty) : null
                    return (
                      <div
                        key={card.id}
                        className={`group relative rounded-2xl overflow-hidden border transition-all hover:scale-[1.02] max-w-md mx-auto w-full ${isBidder ? 'border-purple-400/50' : 'border-white/10'}`}
                        style={{ background: isBidder ? 'linear-gradient(180deg,#1c1730,#05070a)' : 'linear-gradient(180deg,#12161d,#05070a)' }}
                      >
                        {/* Discipline flag - on the card's top border, replacing
                            the old plain role text line beneath the name */}
                        {roleFlag && (
                          <div
                            className="absolute top-0 left-1/2 -translate-x-1/2 z-20 text-center"
                            style={{ width: 96, padding: '7px 0 15px 0', background: roleFlag.background, clipPath: 'polygon(0% 0%,100% 0%,100% 66%,50% 100%,0% 66%)' }}
                          >
                            <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: roleFlag.color }}>{roleFlag.label}</span>
                          </div>
                        )}

                        {/* Player Photo - Portrait Style */}
                        <div
                          className="relative h-48 sm:h-56 flex items-center justify-center cursor-pointer group/photo"
                          style={{ background: 'radial-gradient(circle at 50% 22%, #1b1f27, #05070a 75%)' }}
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
                            <div className={`w-24 h-24 sm:w-28 sm:h-28 rounded-full flex items-center justify-center ${isBidder ? 'bg-purple-500/20 border border-purple-400/40' : 'bg-white/[0.08]'}`}>
                              <span className="text-3xl sm:text-4xl font-bold text-white">
                                {card.name.charAt(0).toUpperCase()}
                              </span>
                            </div>
                          )}

                          {/* Bidder Choice - bottom-left of the photo box (moved
                              off the top corners so it never collides with the
                              discipline flag above) */}
                          {card.isBidderChoice && (
                            <div className="absolute bottom-2 left-2 z-20">
                              <Badge
                                variant="secondary"
                                className="bg-gradient-to-r from-purple-500 to-pink-500 text-white border border-purple-300 px-2 py-1 text-[9px] sm:text-xs font-bold whitespace-nowrap"
                              >
                                ⭐ BIDDER CHOICE
                              </Badge>
                            </div>
                          )}

                          {/* Status badge - bottom-right of the photo box (same
                              move, same reason) */}
                          <div className="absolute bottom-2 right-2 z-20">
                            <Badge
                              variant="secondary"
                              className={`${
                                isBidder
                                  ? 'bg-purple-200 text-purple-950 border border-purple-300'
                                  : card.statusLabel === 'Sold'
                                    ? 'bg-teal-500/20 text-teal-300 border border-teal-400/40'
                                    : card.statusLabel === 'Unsold'
                                      ? 'bg-red-500/20 text-red-300 border border-red-400/35'
                                      : 'bg-white/10 text-white border border-white/15'
                              } px-2 py-1 text-[9px] sm:text-xs font-bold whitespace-nowrap`}
                            >
                              {card.statusLabel}
                            </Badge>
                          </div>
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
                                  className="flex-shrink-0 px-2 py-0.5 bg-teal-500/20 hover:bg-teal-500/40 text-teal-300 hover:text-teal-200 rounded transition-colors duration-200 border border-teal-500/30 text-[9px] sm:text-[10px] font-semibold"
                                  onClick={(e) => e.stopPropagation()}
                                  title="View Cricheroes Profile"
                                >
                                  Cricheroes.com
                                </a>
                            )}
                          </div>
                            {/* Team Name for Bidders */}
                            {isBidder && card.teamName && (
                              <p className="text-purple-300 text-[10px] sm:text-xs font-bold tracking-wide truncate mt-1">
                                {card.teamName}
                              </p>
                            )}
                            {card.specialty && (
                              <p className="text-white/40 text-[10px] sm:text-xs font-semibold truncate mt-1">{card.statsSummary || card.specialty}</p>
                            )}
                            {card.lastYearPrice != null && (
                              <p className="text-amber-300/90 text-[10px] sm:text-xs font-bold truncate mt-1">
                                Last Year: ₹{card.lastYearPrice.toLocaleString('en-IN')}{card.lastYearTeamName ? ` · ${card.lastYearTeamName}` : ''}
                              </p>
                            )}
                            {/* Key batting/bowling stats - plain readable
                                numbers (not a scale bar) plus a View More
                                that opens the full breakdown, one per
                                discipline the player actually has data for. */}
                            {(card.battingStats || card.bowlingStats) && (
                              <div className="space-y-1.5 mt-1.5">
                                {card.battingStats && (
                                  <div className="flex items-center justify-between gap-2 bg-white/[0.05] rounded-md px-2 py-1.5">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      <BatIcon size={12} />
                                      <span className="text-[10px] sm:text-xs text-white font-bold truncate">
                                        {card.battingStats.runs !== undefined && `${card.battingStats.runs} Runs`}
                                        {card.battingStats.average !== undefined && ` · Avg ${card.battingStats.average.toFixed(2)}`}
                                      </span>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => setStatsDialogTarget({ id: card.id, discipline: 'batting' })}
                                      className="text-[9px] sm:text-[10px] font-extrabold uppercase tracking-wide text-teal-300 flex-shrink-0"
                                    >
                                      View More
                                    </button>
                                  </div>
                                )}
                                {card.bowlingStats && (
                                  <div className="flex items-center justify-between gap-2 bg-white/[0.05] rounded-md px-2 py-1.5">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      <BallIcon size={12} />
                                      <span className="text-[10px] sm:text-xs text-white font-bold truncate">
                                        {card.bowlingStats.wickets !== undefined && `${card.bowlingStats.wickets} Wkts`}
                                        {card.bowlingStats.economy !== undefined && ` · Econ ${card.bowlingStats.economy.toFixed(2)}`}
                                      </span>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => setStatsDialogTarget({ id: card.id, discipline: 'bowling' })}
                                      className="text-[9px] sm:text-[10px] font-extrabold uppercase tracking-wide text-teal-300 flex-shrink-0"
                                    >
                                      View More
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Price Info */}
                          <div className="space-y-1.5">
                            {isBidder ? (
                              <div className="bg-purple-500/20 border border-purple-400/30 rounded-lg p-2 text-center">
                                <p className="text-purple-200 text-[9px] sm:text-[10px] font-semibold">PARTICIPATING</p>
                                <p className="text-white text-xs sm:text-sm font-bold">As Bidder</p>
                              </div>
                            ) : card.purchasedPrice !== null ? (
                              <div className="rounded-lg p-2 text-center border border-teal-400/30" style={{ background: 'linear-gradient(90deg, rgba(20,184,166,0.25), rgba(20,184,166,0.08))' }}>
                                <p className="text-teal-200 text-[9px] sm:text-[10px] font-semibold">PURCHASED FOR</p>
                                <p className="text-white font-black text-base sm:text-lg break-words">₹{card.purchasedPrice.toLocaleString('en-IN')}</p>
                              </div>
                            ) : (
                              <div className="bg-white/[0.05] rounded-lg p-2 border border-white/10">
                                <div className="flex items-center justify-between">
                                  <span className="text-white/40 text-[9px] sm:text-[10px] uppercase">Base Price</span>
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

              {filteredKnowYourPlayersCards.length > knowPlayersVisibleCount && (
                <div className="flex justify-center pt-4">
                  <Button
                    variant="outline"
                    onClick={() => setKnowPlayersVisibleCount(count => count + KNOW_PLAYERS_PAGE_SIZE)}
                    className="bg-white/[0.06] border-white/15 text-white hover:bg-white/10"
                  >
                    Load More ({filteredKnowYourPlayersCards.length - knowPlayersVisibleCount} remaining)
                  </Button>
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

        {/* Shared "View More" stats popup, driven by statsDialogTarget */}
        {statsDialogTarget && (() => {
          const targetCard = knowYourPlayersCards.find(c => c.id === statsDialogTarget.id)
          if (!targetCard) return null
          return (
            <PlayerStatsDialog
              open={true}
              onOpenChange={(open) => { if (!open) setStatsDialogTarget(null) }}
              discipline={statsDialogTarget.discipline}
              battingStats={targetCard.battingStats}
              bowlingStats={targetCard.bowlingStats}
            />
          )
        })()}
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
        
        {/* Floating Professio AI Button */}
        <FloatingPromoChip variant="purple" sessionKey="timer_professio_promo" />
      </div>
    )
  }

  // Show live auction view with full layout (matching the page.tsx structure)
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      {/* Banner for LIVE/MOCK_RUN/PAUSED published auctions */}
      {isLiveStatus(auctionData.status) && (
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
      <header className={`bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 sticky top-0 z-40 ${(isLiveStatus(auctionData.status) || auctionData.status === 'PAUSED') ? 'mt-[88px]' : ''}`}>
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
      
      {/* Floating Professio AI Button */}
      <FloatingPromoChip variant="purple" sessionKey="live_auction_professio_promo" />
    </div>
  )
}

