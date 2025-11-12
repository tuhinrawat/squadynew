import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { AdminAuctionView } from '@/components/admin-auction-view'
import { PublicAuctionView } from '@/components/public-auction-view'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import Image from 'next/image'
import { ResultsView } from '@/components/results-view'
import { ChevronRight, Home, Instagram } from 'lucide-react'
import { PreAuctionBanner } from '@/components/pre-auction-banner'
import { CountdownToLiveWrapper } from '@/components/countdown-to-live-wrapper'
import { PublicHeaderWithChat } from '@/components/public-header-with-chat'
import { isCuid } from '@/lib/slug'
import { isLiveStatus } from '@/lib/auction-status'
import type { Metadata } from 'next'

type AuctionStats = {
  total: number
  sold: number
  unsold: number
  remaining: number
}

type AuctionBidHistoryRecord = {
  bidderId: string
  amount: number
  timestamp: Date
  bidderName: string
  teamName?: string
  type?: 'bid' | 'sold' | 'unsold'
  playerId?: string
  playerName?: string
}

function calculateAuctionStats(players: Array<{ status?: string | null }>): AuctionStats {
  const activePlayers = players.filter(player => player.status !== 'RETIRED')

  return activePlayers.reduce<AuctionStats>(
    (stats, player) => {
      const status = player.status ?? 'AVAILABLE'

      if (status === 'SOLD') {
        stats.sold += 1
      } else if (status === 'UNSOLD') {
        stats.unsold += 1
      } else if (status === 'AVAILABLE') {
        stats.remaining += 1
      }

      stats.total += 1
      return stats
    },
    { total: 0, sold: 0, unsold: 0, remaining: 0 }
  )
}

function normalizeTimestamp(value: unknown): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed
    }
  }

  return new Date(0)
}

function parseBidHistory(rawHistory: unknown): AuctionBidHistoryRecord[] {
  if (!Array.isArray(rawHistory)) {
    return []
  }

  return rawHistory.reduce<AuctionBidHistoryRecord[]>((entries, item) => {
    if (typeof item !== 'object' || item === null) {
      return entries
    }

    const record = item as Record<string, unknown>
    const playerId = typeof record.playerId === 'string' ? record.playerId : undefined
    const amount = typeof record.amount === 'number' ? record.amount : undefined
    const bidderId = typeof record.bidderId === 'string' ? record.bidderId : undefined
    const bidderName = typeof record.bidderName === 'string' ? record.bidderName : undefined
    const teamName = typeof record.teamName === 'string' ? record.teamName : undefined
    const playerName = typeof record.playerName === 'string' ? record.playerName : undefined
    const type = typeof record.type === 'string' ? record.type : undefined

    if (typeof amount !== 'number' || Number.isNaN(amount)) {
      return entries
    }

    entries.push({
      amount,
      bidderId: bidderId ?? 'unknown',
      bidderName: bidderName ?? 'Unknown Bidder',
      teamName,
      timestamp: normalizeTimestamp(record.timestamp),
      playerId,
      playerName,
      type: type === 'bid' || type === 'sold' || type === 'unsold' ? type : undefined
    })

    return entries
  }, [])
}

function isScheduledDateInFuture(date: Date | string | null | undefined): boolean {
  if (!date) {
    return false
  }

  const scheduledTime = new Date(date).getTime()
  if (Number.isNaN(scheduledTime)) {
    return false
  }

  return scheduledTime > Date.now()
}

// Generate dynamic metadata for better social sharing
export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const isId = isCuid(params.id)
  
  const auction = isId
    ? await prisma.auction.findUnique({
        where: { id: params.id },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          image: true,
          status: true,
          isPublished: true,
          _count: {
            select: {
              players: true,
              bidders: true
            }
          }
        } as Prisma.AuctionSelect
      })
    : await prisma.auction.findUnique({
        where: { slug: params.id } as unknown as Prisma.AuctionWhereUniqueInput,
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          image: true,
          status: true,
          isPublished: true,
          _count: {
            select: {
              players: true,
              bidders: true
            }
          }
        } as Prisma.AuctionSelect
      })

  if (!auction) {
    return {
      title: 'Auction Not Found',
      description: 'The requested auction could not be found.'
    }
  }

  const title = `${auction.name} - Live Auction on Squady`
  const auctionWithCount = auction as typeof auction & { _count: { players: number; bidders: number }; slug: string | null }
  const description = auction.description 
    ? auction.description.substring(0, 160) // Limit to 160 chars for SEO
    : `Join the live auction with ${auctionWithCount._count.players} players and ${auctionWithCount._count.bidders} teams. Real-time bidding, instant updates, and comprehensive team management.`
  
  const url = auctionWithCount.slug 
    ? `${process.env.NEXT_PUBLIC_SITE_URL || 'https://squady.auction'}/auction/${auctionWithCount.slug}`
    : `${process.env.NEXT_PUBLIC_SITE_URL || 'https://squady.auction'}/auction/${auction.id}`

  // Use Squady logo for social sharing with absolute URL (use PNG for better compatibility)
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://squady.auction'
  const imageUrl = `${siteUrl}/opengraph-image.png`

  return {
    title,
    description,
    openGraph: {
      title: auction.name,
      description,
      url,
      siteName: 'Squady',
      type: 'website',
      locale: 'en_US',
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: 'Squady - Live Auction Platform',
        }
      ]
    },
    twitter: {
      card: 'summary_large_image',
      title: auction.name,
      description,
      images: [imageUrl],
    },
    alternates: {
      canonical: url
    },
    robots: {
      index: auction.isPublished,
      follow: auction.isPublished,
    }
  }
}

export default async function LiveAuctionPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)

  // Determine if the param is a slug or an ID
  const isId = isCuid(params.id)
  
  // Fetch auction by slug or ID
  const auction = isId
    ? await prisma.auction.findUnique({
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
    : await prisma.auction.findUnique({
        where: { slug: params.id } as unknown as Prisma.AuctionWhereUniqueInput,
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
  
  // If accessed by ID but slug exists, redirect to slug URL for SEO
  const auctionWithSlug = auction as typeof auction & { slug: string | null }
  if (isId && auctionWithSlug.slug) {
    redirect(`/auction/${auctionWithSlug.slug}`)
  }

  // Fetch current player and validate it's not SOLD
  let currentPlayer = auction.currentPlayerId
    ? await prisma.player.findUnique({
        where: { id: auction.currentPlayerId }
      })
    : null

  // CRITICAL: If current player is SOLD, clear it to prevent showing SOLD players
  if (currentPlayer && currentPlayer.status === 'SOLD') {
    // Clear the invalid currentPlayerId
    await prisma.auction.update({
      where: { id: auction.id },
      data: { currentPlayerId: null }
    })
    currentPlayer = null
  }

  const auctionWithRelations = auction as typeof auction & { 
    players: Array<{ status?: string | null }>
    bidders: Array<{ userId: string }>
  }
  const auctionStats = calculateAuctionStats(auctionWithRelations.players)
  const fullBidHistory = parseBidHistory(auction.bidHistory)

  // If user is logged in, check access
  let isAdmin = false
  let isSuperAdmin = false
  let isCreator = false
  let isParticipant = false

  if (session) {
    isAdmin = session.user?.role === 'ADMIN'
    isSuperAdmin = session.user?.role === 'SUPER_ADMIN'
    isCreator = auction.createdById === session.user?.id
    isParticipant = auctionWithRelations.bidders.some((b) => b.userId === session.user?.id)
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
        const hasScheduledDate = isScheduledDateInFuture(auction.scheduledStartDate)
        
        if (hasScheduledDate) {
          return (
            <CountdownToLiveWrapper
              auction={auctionWithRelations as unknown as Parameters<typeof CountdownToLiveWrapper>[0]['auction']}
              initialCurrentPlayer={currentPlayer}
              initialStats={auctionStats}
              initialBidHistory={fullBidHistory}
              bidders={auctionWithRelations.bidders as unknown as Parameters<typeof CountdownToLiveWrapper>[0]['bidders']}
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
      return (
        <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
          {/* Header for Public View with Chat */}
          <PublicHeaderWithChat auctionId={auction.id} />
          
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
            auction={auctionWithRelations as unknown as Parameters<typeof PublicAuctionView>[0]['auction']}
            currentPlayer={currentPlayer}
            stats={auctionStats}
            bidHistory={fullBidHistory}
            bidders={auctionWithRelations.bidders as unknown as Parameters<typeof PublicAuctionView>[0]['bidders']}
          />
          
          {/* Footer for Public View */}
          <footer className="mt-8 bg-gray-900 dark:bg-black text-white py-6 px-4">
            <div className="max-w-7xl mx-auto">
              <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="flex items-center gap-2">
                  <Image src="/squady-logo.svg" alt="Squady" width={100} height={33} className="h-6 w-auto brightness-0 invert" />
                  <span className="text-xs sm:text-sm text-gray-400">© 2025 Squady. All rights reserved.</span>
                </div>
                <div className="flex items-center gap-3">
                  <a 
                    href="https://www.instagram.com/squady.auction/" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-pink-400 hover:text-pink-300 transition-colors"
                    aria-label="Follow us on Instagram"
                  >
                    <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                    </svg>
                  </a>
                  <a href="https://professio.ai/?utm_source=squady&utm_medium=referral&utm_campaign=powered_by_badge" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs bg-purple-600 text-white border-purple-500 shadow-sm hover:bg-purple-700">
                    <span>Powered by</span>
                    <span className="font-semibold">Professio AI</span>
                  </a>
                </div>
              </div>
            </div>
          </footer>
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
            This auction hasn&apos;t started yet. Please wait for the administrator to begin the auction.
          </p>
          <Button asChild>
            <Link href="/bidder/auctions">Back to My Auctions</Link>
          </Button>
        </div>
      </div>
    )
  }

  if (auction.status === 'COMPLETED') {
    // Show results view
    if (session) {
      return <ResultsView auction={auction} userId={session.user.id} userRole={session.user.role} />
    }
    // If no session (public access), use empty userId and BIDDER role (same pattern as line 68)
    return <ResultsView auction={auction} userId="" userRole="BIDDER" />
  }

  // At this point, we should have a session (non-published auctions require auth, published ones return early)
  // But add a safety check for TypeScript
  if (!session) {
    redirect('/signin')
  }

  // Use AdminAuctionView for all authenticated users
  // Pass viewMode to control which features are available
  const viewMode = isSuperAdmin || (isAdmin && isCreator) ? 'admin' : 'bidder'
  
  // Determine breadcrumb paths based on user role
  const homePath = session.user.role === 'BIDDER' || isParticipant ? '/bidder/auctions' : '/dashboard'
  const homeLabel = session.user.role === 'BIDDER' || isParticipant ? 'My Auctions' : 'Dashboard'
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      {/* Pre-Auction Banner - Show when published but not live */}
      {/* Note: COMPLETED status is already handled earlier, so this won't execute for COMPLETED */}
      {auction.isPublished && !isLiveStatus(auction.status) && auction.status !== 'PAUSED' && auction.scheduledStartDate && (
        <PreAuctionBanner 
          scheduledStartDate={auction.scheduledStartDate}
          auctionName={auction.name}
        />
      )}
      {/* Header with Logo and User Info */}
      <header className={`bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 sticky top-0 z-40 ${auction.isPublished && !isLiveStatus(auction.status) && auction.status !== 'PAUSED' && auction.scheduledStartDate ? 'mt-[88px]' : ''}`}>
        <div className="max-w-full mx-auto px-3 sm:px-6">
          <div className="flex justify-between items-center h-14 sm:h-16">
            {/* Logo */}
            <Link href={homePath} className="flex items-center flex-shrink-0">
              <Image src="/squady-logo.svg" alt="Squady" width={100} height={33} className="h-7 sm:h-8 w-auto" />
            </Link>
            
            {/* User Info */}
            <div className="flex items-center gap-1.5 sm:gap-3">
              {/* Instagram Icon - Always visible */}
              <a
                href="https://www.instagram.com/squady.auction/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-pink-600 dark:text-pink-400 hover:text-pink-700 dark:hover:text-pink-300 transition-colors p-2"
                aria-label="Follow us on Instagram"
              >
                <Instagram className="h-5 w-5" />
              </a>
              <a href="https://professio.ai/?utm_source=squady&utm_medium=referral&utm_campaign=powered_by_badge" target="_blank" rel="noopener noreferrer" className="hidden sm:inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800 shadow-sm hover:from-purple-100 hover:to-pink-100 dark:hover:from-purple-900/30 dark:hover:to-pink-900/30 whitespace-nowrap">
                <span>Powered by</span>
                <span className="font-semibold">Professio AI</span>
              </a>
              <div className="hidden lg:flex items-center gap-2 text-sm">
                <span className="text-gray-700 dark:text-gray-300">Welcome,</span>
                <span className="font-semibold text-gray-900 dark:text-gray-100">{session?.user?.name || 'User'}</span>
              </div>
              <form action="/api/auth/signout" method="post">
                <Button type="submit" variant="ghost" size="sm" className="text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 h-9">
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
          <a href="https://professio.ai/?utm_source=squady&utm_medium=referral&utm_campaign=powered_by_badge" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-2 py-1 rounded-md border text-xs bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800 shadow-sm">
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
        auction={auctionWithRelations as unknown as Parameters<typeof AdminAuctionView>[0]['auction']}
        currentPlayer={currentPlayer}
        stats={auctionStats}
        bidHistory={fullBidHistory}
        viewMode={viewMode}
      />
      
      {/* Footer */}
      <footer className="mt-auto bg-gray-900 dark:bg-black text-white py-6 px-4 sticky top-[100vh]">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-2">
              <Image src="/squady-logo.svg" alt="Squady" width={100} height={33} className="h-6 w-auto brightness-0 invert" />
              <span className="text-sm text-gray-400">© 2025 Squady. All rights reserved.</span>
            </div>
            <div className="flex items-center gap-4 sm:gap-6 text-sm text-gray-400">
              <a 
                href="https://www.instagram.com/squady.auction/" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-pink-400 hover:text-pink-300 transition-colors"
                aria-label="Follow us on Instagram"
              >
                <Instagram className="h-5 w-5" />
              </a>
              <span>Status: {auction.status}</span>
              {session?.user?.role === 'SUPER_ADMIN' && (
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

