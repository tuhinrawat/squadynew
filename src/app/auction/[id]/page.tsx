import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { AdminAuctionView } from '@/components/admin-auction-view'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import Image from 'next/image'
import { ResultsView } from '@/components/results-view'
import { ChevronRight, Home, Instagram } from 'lucide-react'
import { PreAuctionBanner } from '@/components/pre-auction-banner'
import { CountdownToLiveWrapper } from '@/components/countdown-to-live-wrapper'
import { PublicAuctionWrapper } from '@/components/public-auction-wrapper'
import { isCuid } from '@/lib/slug'
import { isLiveStatus } from '@/lib/auction-status'
import { calculateAuctionStats, parseBidHistory } from '@/lib/auction-view-data'
import type { Metadata } from 'next'

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

export default async function LiveAuctionPage({ params, searchParams }: { params: { id: string }; searchParams: { [key: string]: string | string[] | undefined } }) {
  const session = await getServerSession(authOptions)

  // The presenter link (?presenter=1) is meant to be projected full-screen
  // for a room to watch - the breadcrumb bar and marketing footer below are
  // for the interactive public page, not for that. See PublicAuctionView
  // for the actual stage redesign this drives.
  const isPresenterMode = searchParams.presenter === '1'

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
    // Carry query params (e.g. ?presenter=1) through the redirect - without
    // this, the presenter link would silently drop its flag the moment an
    // auction has a slug, landing the anchor on the plain public view.
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(searchParams)) {
      if (Array.isArray(value)) {
        value.forEach(v => query.append(key, v))
      } else if (value !== undefined) {
        query.set(key, value)
      }
    }
    const queryString = query.toString()
    redirect(`/auction/${auctionWithSlug.slug}${queryString ? `?${queryString}` : ''}`)
  }

  // Current player is already in the `players` relation just fetched above -
  // derive it from there instead of a second round-trip to the database.
  let currentPlayer = auction.currentPlayerId
    ? auction.players.find(p => p.id === auction.currentPlayerId) ?? null
    : null

  // If current player is SOLD, don't show them - but this is a page LOAD,
  // not an action, so the write-back has to be safe against a request that
  // legitimately advances currentPlayerId moments later (the offline-
  // console reconcile route resolves a player and re-picks the next one as
  // two separate writes, not one transaction, so there's a brief real
  // window where a concurrent page load sees this exact state). Guarding
  // the update on currentPlayerId still equaling the stale value observed
  // above makes it a no-op if that reconcile (or anything else) already
  // moved it on - a page reload should never have a mutating side effect
  // that can clobber a fresher value written a moment later.
  if (currentPlayer && currentPlayer.status === 'SOLD') {
    await prisma.auction.updateMany({
      where: { id: auction.id, currentPlayerId: currentPlayer.id },
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

      // If published but DRAFT status - show ONLY full-page countdown (nothing else).
      // Always routed through CountdownToLiveWrapper, scheduled date or not -
      // that component is also what listens for the admin actually starting
      // the auction (via Pusher) and plays the going-live transition the
      // instant that happens, rather than only after a scheduled time passes
      // or a manual refresh. Without a scheduled date it just shows a
      // "waiting" message instead of a ticking countdown.
      if (auction.status === 'DRAFT') {
        return (
          <CountdownToLiveWrapper
            auction={auctionWithRelations as unknown as Parameters<typeof CountdownToLiveWrapper>[0]['auction']}
            initialCurrentPlayer={currentPlayer}
            initialStats={auctionStats}
            initialBidHistory={fullBidHistory}
            bidders={auctionWithRelations.bidders as unknown as Parameters<typeof CountdownToLiveWrapper>[0]['bidders']}
          />
        )
      }

      // For LIVE, PAUSED, and MOCK_RUN status, show full auction view
      if (isLiveStatus(auction.status) || auction.status === 'PAUSED') {
        return (
          // The live auction page is a dark "broadcast stage" by design, not
          // a light page with a dark card floating on it - forcing dark mode
          // here (rather than only on the stage component) also activates
          // the dark: variants already authored, but never triggered, on the
          // breadcrumb bar and PublicHeader below, so the whole page
          // reads as one immersive surface instead of a dark box on white.
          <div className="dark">
          <div className={`min-h-screen bg-[#05070a] ${isPresenterMode ? '' : 'pb-20 sm:pb-0'}`}>
            {/* Breadcrumbs - Hidden on mobile for public view, and entirely
                in presenter mode (projected full-screen, no browser chrome
                needed) */}
            {!isPresenterMode && (
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
            )}

          <PublicAuctionWrapper
            auction={auctionWithRelations as unknown as Parameters<typeof PublicAuctionWrapper>[0]['auction']}
            currentPlayer={currentPlayer}
            stats={auctionStats}
            bidHistory={fullBidHistory}
            bidders={auctionWithRelations.bidders as unknown as Parameters<typeof PublicAuctionWrapper>[0]['bidders']}
          />
          
          {/* Footer for Public View - Professional Single Line. Mobile keeps
              a fixed bar (content has pb-20 to clear it); desktop uses the
              same sticky-top-[100vh] trick as the logged-in view's footer
              below - pinned to the bottom of the viewport when the stage
              content is shorter than it, in normal flow otherwise. Dropped
              entirely in presenter mode - a projected screen has no room
              for it and no browser chrome to anchor it against.
              bottom-0 on mobile - this now sits flush at the true bottom of
              the screen, with the taller, more tappable Recent Sales bar
              sitting just above it (bottom-8, matching this footer's own
              ~32px height) - see SoldTicker in public-auction-view. */}
          {!isPresenterMode && (
            <footer className="mt-8 sm:mt-8 bg-gradient-to-b from-gray-900 to-black border-t border-gray-800 fixed bottom-0 left-0 right-0 sm:sticky sm:top-[100vh] sm:bottom-auto sm:left-auto sm:right-auto z-20">
              <div className="max-w-7xl mx-auto px-3 py-3">
                {/* Instagram used to be duplicated here - it's already always
                    visible in the sticky header above, so this was the same
                    link shown twice on every screen. */}
                <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                  <Image src="/squady-logo.svg" alt="Squady" width={80} height={26} className="h-4 sm:h-5 w-auto brightness-0 invert flex-shrink-0" />
                  <div className="hidden sm:block w-px h-3 bg-gray-700" />
                  <span className="text-[10px] sm:text-xs text-gray-500 whitespace-nowrap">© 2025</span>
                </div>
              </div>
            </footer>
          )}
        </div>
        </div>
        )
      }
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
      
      {/* Footer - Professional Single Line */}
      <footer className="mt-auto bg-gradient-to-b from-gray-900 to-black border-t border-gray-800 py-3 px-4 sticky top-[100vh]">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 sm:gap-3">
              <Image src="/squady-logo.svg" alt="Squady" width={80} height={26} className="h-4 sm:h-5 w-auto brightness-0 invert" />
              <div className="hidden sm:block w-px h-3 bg-gray-700" />
              <span className="text-xs text-gray-500">© 2025</span>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 text-xs text-gray-500">
              <a 
                href="https://www.instagram.com/squady.auction/" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-gray-400 hover:text-pink-400 transition-colors"
                aria-label="Instagram"
              >
                <Instagram className="h-4 w-4" />
              </a>
              <div className="w-px h-3 bg-gray-700" />
              <span className="hidden sm:inline text-gray-500">Status: <span className="text-gray-400">{auction.status}</span></span>
              {session?.user?.role === 'SUPER_ADMIN' && (
                <>
                  <div className="w-px h-3 bg-gray-700 hidden sm:block" />
                  <span className="text-purple-400 text-xs hidden sm:inline">Admin</span>
                </>
              )}
            </div>
          </div>
        </div>
      </footer>
      {/* Floating Promo Chip intentionally not rendered on live auction */}
    </div>
  )
}

