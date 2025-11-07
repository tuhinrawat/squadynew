import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'
import { AdminAuctionView } from '@/components/admin-auction-view'
import { BidderAuctionView } from '@/components/bidder-auction-view'
import { PublicAuctionView } from '@/components/public-auction-view'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'
import Image from 'next/image'
import { ResultsView } from '@/components/results-view'
import { ChevronRight, Home } from 'lucide-react'
import FloatingPromoChip from '@/components/floating-promo-chip'
import { PreAuctionBanner } from '@/components/pre-auction-banner'
import { FullScreenCountdown } from '@/components/full-screen-countdown'
import { ProfessioPromoButton } from '@/components/professio-promo-button'
import { CountdownToLiveWrapper } from '@/components/countdown-to-live-wrapper'

export default async function LiveAuctionPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)

  const auction = await prisma.auction.findUnique({
    where: { id: params.id },
    include: {
      players: true,
      bidders: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        }
      }
    }
  })

  if (!auction) {
    if (!session) {
      redirect('/')
    }
    redirect('/dashboard')
  }

  // If user is logged in, check access
  let isAdmin = false
  let isSuperAdmin = false
  let isCreator = false
  let isParticipant = false

  if (session) {
    isAdmin = session.user?.role === 'ADMIN'
    isSuperAdmin = session.user?.role === 'SUPER_ADMIN'
    isCreator = auction.createdById === session.user?.id
    isParticipant = auction.bidders.some(b => b.userId === session.user?.id)
  }

  // If auction is published, allow public viewing without auth (regardless of status)
  // This allows users to see published auctions even if they're in DRAFT status
  if (auction.isPublished) {
    if (!session) {
      // If completed, show results view for public
      if (auction.status === 'COMPLETED') {
        // Need to provide a dummy userId and role for public access
        return <ResultsView auction={auction} userId="" userRole="BIDDER" />
      }

      // If published but DRAFT status - show ONLY full-page countdown (nothing else)
      if (auction.status === 'DRAFT') {
        // Check if scheduledStartDate exists and is valid
        const hasScheduledDate = auction.scheduledStartDate && new Date(auction.scheduledStartDate).getTime() > Date.now()
        
        if (hasScheduledDate) {
          // Calculate stats for wrapper
          const activePlayers = auction.players.filter(p => p.status !== 'RETIRED')
          const totalPlayers = activePlayers.length
          const soldPlayers = activePlayers.filter(p => p.status === 'SOLD').length
          const unsoldPlayers = activePlayers.filter(p => p.status === 'UNSOLD').length
          const availablePlayers = activePlayers.filter(p => p.status === 'AVAILABLE').length

          const stats = {
            total: totalPlayers,
            sold: soldPlayers,
            unsold: unsoldPlayers,
            remaining: availablePlayers
          }

          // Parse bid history
          let bidHistory: any[] = []
          if (auction.bidHistory && typeof auction.bidHistory === 'object') {
            const bidHistoryData = auction.bidHistory as any
            if (Array.isArray(bidHistoryData)) {
              bidHistory = bidHistoryData
            }
          }

          // Get current player if exists
          let currentPlayer = null
          if (auction.currentPlayerId) {
            currentPlayer = await prisma.player.findUnique({
              where: { id: auction.currentPlayerId }
            })
          }

          // Use wrapper component that handles countdown to live transition
          return (
            <CountdownToLiveWrapper
              auction={auction}
              initialCurrentPlayer={currentPlayer}
              initialStats={stats}
              initialBidHistory={bidHistory}
              bidders={auction.bidders}
            />
          )
        } else {
          // No scheduled date or invalid date - show message with instructions
          return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-black">
              <div className="text-center px-4 max-w-2xl">
                <h1 className="text-4xl md:text-6xl font-bold text-white mb-4">{auction.name}</h1>
                <p className="text-xl md:text-2xl text-gray-300 mb-6">Published Auction</p>
                <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6 mt-8">
                  <p className="text-lg md:text-xl text-gray-300 mb-4">
                    ⏰ Scheduled start date not set
                  </p>
                  <p className="text-md md:text-lg text-gray-400">
                    To display the countdown timer, please set a scheduled start date and time for this auction in the dashboard.
                  </p>
                </div>
              </div>
            </div>
          )
        }
      }

      // For LIVE and PAUSED status, show full auction view
      // Get current player if exists
      let currentPlayer = null
      if (auction.currentPlayerId) {
        currentPlayer = await prisma.player.findUnique({
          where: { id: auction.currentPlayerId }
        })
      }

      // Calculate stats (excluding RETIRED players)
      const activePlayers = auction.players.filter(p => p.status !== 'RETIRED')
      const totalPlayers = activePlayers.length
      const soldPlayers = activePlayers.filter(p => p.status === 'SOLD').length
      const unsoldPlayers = activePlayers.filter(p => p.status === 'UNSOLD').length
      const availablePlayers = activePlayers.filter(p => p.status === 'AVAILABLE').length

      const stats = {
        total: totalPlayers,
        sold: soldPlayers,
        unsold: unsoldPlayers,
        remaining: availablePlayers
      }

      // Parse bid history
      let bidHistory: any[] = []
      if (auction.bidHistory && typeof auction.bidHistory === 'object') {
        const bidHistoryData = auction.bidHistory as any
        if (Array.isArray(bidHistoryData)) {
          bidHistory = bidHistoryData
        }
      }

      return (
        <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
          {/* Banner for LIVE/PAUSED published auctions */}
          {auction.status === 'LIVE' && (
            <div className="fixed top-0 left-0 right-0 z-[9998] bg-gradient-to-r from-green-600 via-emerald-600 to-teal-600 shadow-lg">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
                <div className="flex items-center justify-center gap-3 text-white">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                    <h2 className="text-lg md:text-xl font-bold">{auction.name}</h2>
                  </div>
                  <span className="text-sm md:text-base text-green-100">• LIVE - Open to Public</span>
                </div>
              </div>
            </div>
          )}
          {auction.status === 'PAUSED' && (
            <div className="fixed top-0 left-0 right-0 z-[9998] bg-gradient-to-r from-yellow-600 via-amber-600 to-orange-600 shadow-lg">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
                <div className="flex items-center justify-center gap-3 text-white">
                  <h2 className="text-lg md:text-xl font-bold">{auction.name}</h2>
                  <span className="text-sm md:text-base text-yellow-100">• PAUSED - Open to Public</span>
                </div>
              </div>
            </div>
          )}
          {/* Header for Public View */}
          <header className={`bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 sticky top-0 z-40 ${(auction.status === 'LIVE' || auction.status === 'PAUSED') ? 'mt-[88px]' : ''}`}>
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
                    <Button variant="ghost" size="sm" className="text-gray-700 dark:text-gray-300">
                      Register
                    </Button>
                  </Link>
                  <Link href="/signin">
                    <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white">
                      Sign In
                    </Button>
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
                  <Home className="h-4 w-4" />
                  <span>Home</span>
                </Link>
                <ChevronRight className="h-4 w-4" />
                <span className="text-gray-900 dark:text-gray-100 font-medium truncate max-w-xs">
                  {auction.name} - Live Auction
                </span>
              </nav>
            </div>
          </div>
          
          <PublicAuctionView 
            auction={auction}
            currentPlayer={currentPlayer}
            stats={stats}
            bidHistory={bidHistory}
            bidders={auction.bidders}
          />
        </div>
      )
    }
  }

  // For non-published auctions, require authentication and proper access
  // (Published auctions are already handled above)
  if (!auction.isPublished && !session) {
    redirect('/signin')
  }

  if (!isSuperAdmin && !isAdmin && !isCreator && !isParticipant && !auction.isPublished) {
    redirect('/dashboard')
  }

  // Handle different auction statuses
  if (auction.status === 'DRAFT') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center p-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">
            Auction Not Started
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mb-8">
            This auction hasn't started yet. Please wait for the administrator to begin the auction.
          </p>
          <Button asChild>
            <Link href="/bidder/auctions">Back to My Auctions</Link>
          </Button>
        </div>
      </div>
    )
  }

  // Get current player if exists
  let currentPlayer = null
  if (auction.currentPlayerId) {
    currentPlayer = await prisma.player.findUnique({
      where: { id: auction.currentPlayerId }
    })
  }

  // Calculate stats (excluding RETIRED players)
  const activePlayers = auction.players.filter(p => p.status !== 'RETIRED')
  const totalPlayers = activePlayers.length
  const soldPlayers = activePlayers.filter(p => p.status === 'SOLD').length
  const unsoldPlayers = activePlayers.filter(p => p.status === 'UNSOLD').length
  const availablePlayers = activePlayers.filter(p => p.status === 'AVAILABLE').length

  const stats = {
    total: totalPlayers,
    sold: soldPlayers,
    unsold: unsoldPlayers,
    remaining: availablePlayers
  }

  // Parse bid history
  let bidHistory: any[] = []
  if (auction.bidHistory && typeof auction.bidHistory === 'object') {
    const bidHistoryData = auction.bidHistory as any
    if (Array.isArray(bidHistoryData)) {
      bidHistory = bidHistoryData
    }
  }

  if (auction.status === 'COMPLETED') {
    // Show results view
    return <ResultsView auction={auction} userId={session.user.id} userRole={session.user.role} />
  }

  // Use AdminAuctionView for all authenticated users
  // Pass viewMode to control which features are available
  const viewMode = isSuperAdmin || (isAdmin && isCreator) ? 'admin' : 'bidder'
  
  // Determine breadcrumb paths based on user role
  const homePath = session.user?.role === 'BIDDER' || isParticipant ? '/bidder/auctions' : '/dashboard'
  const homeLabel = session.user?.role === 'BIDDER' || isParticipant ? 'My Auctions' : 'Dashboard'
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      {/* Pre-Auction Banner - Show when published but not live */}
      {auction.isPublished && auction.status !== 'LIVE' && auction.status !== 'COMPLETED' && auction.scheduledStartDate && (
        <PreAuctionBanner 
          scheduledStartDate={auction.scheduledStartDate}
          auctionName={auction.name}
        />
      )}
      {/* Header with Logo and User Info */}
      <header className={`bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 sticky top-0 z-40 ${auction.isPublished && auction.status !== 'LIVE' && auction.status !== 'COMPLETED' && auction.scheduledStartDate ? 'mt-[88px]' : ''}`}>
        <div className="max-w-full mx-auto px-4 sm:px-6">
          <div className="flex justify-between items-center h-16">
            {/* Logo */}
            <Link href={homePath} className="flex items-center">
              <Image src="/squady-logo.svg" alt="Squady" width={120} height={40} className="h-8 w-auto" />
            </Link>
            
            {/* User Info */}
            <div className="flex items-center gap-4">
              <a href="https://professio.ai/" target="_blank" rel="noopener noreferrer" className="hidden sm:inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800 shadow-sm hover:from-purple-100 hover:to-pink-100 dark:hover:from-purple-900/30 dark:hover:to-pink-900/30">
                <span className="hidden sm:inline">Powered by</span>
                <span className="font-semibold">Professio AI</span>
              </a>
              <div className="hidden sm:flex items-center gap-2 text-sm">
                <span className="text-gray-700 dark:text-gray-300">Welcome,</span>
                <span className="font-semibold text-gray-900 dark:text-gray-100">{session.user.name}</span>
              </div>
              <form action="/api/auth/signout" method="post">
                <Button type="submit" variant="ghost" size="sm" className="text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100">
                  Logout
                </Button>
              </form>
            </div>
          </div>
        </div>
      </header>
      {/* Mobile promo banner */}
      <div className="sm:hidden bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="px-4 py-2 flex justify-center">
          <a href="https://professio.ai/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-2 py-1 rounded-md border text-xs bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800 shadow-sm">
            <span>Powered by</span>
            <span className="font-semibold">Professio AI</span>
          </a>
        </div>
      </div>
      
      {/* Breadcrumbs */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-full mx-auto px-4 sm:px-6 py-3">
          <nav className="flex items-center space-x-1 text-sm text-gray-500 dark:text-gray-400">
            <Link href={homePath} className="hover:text-gray-700 dark:hover:text-gray-300 flex items-center gap-1">
              <Home className="h-4 w-4" />
              <span>{homeLabel}</span>
            </Link>
            <ChevronRight className="h-4 w-4" />
            <span className="text-gray-900 dark:text-gray-100 font-medium truncate max-w-xs">
              {auction.name}
            </span>
          </nav>
        </div>
      </div>
      
      {/* Auction View */}
      <AdminAuctionView 
        auction={auction}
        currentPlayer={currentPlayer}
        stats={stats}
        bidHistory={bidHistory}
        viewMode={viewMode}
      />
      
      {/* Footer */}
      <footer className="mt-auto bg-gray-900 dark:bg-black text-white py-6 px-4 sticky top-[100vh]">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-2">
              <Image src="/squady-logo.svg" alt="Squady" width={100} height={33} className="h-6 w-auto" />
              <span className="text-sm text-gray-400">© 2024 Squady. All rights reserved.</span>
            </div>
            <div className="flex items-center gap-6 text-sm text-gray-400">
              <span>Status: {auction.status}</span>
              {session.user?.role === 'SUPER_ADMIN' && (
                <span>Super Admin Mode</span>
              )}
            </div>
          </div>
        </div>
      </footer>
      {/* Floating Promo Chip intentionally not rendered on live auction */}
    </div>
  )
}

