import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'
import { AdminAuctionView } from '@/components/admin-auction-view'
import { BidderAuctionView } from '@/components/bidder-auction-view'
import { PublicAuctionView } from '@/components/public-auction-view'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { ResultsView } from '@/components/results-view'

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

  // If auction is published and live/paused/completed, allow public viewing without auth
  if (auction.isPublished && (auction.status === 'LIVE' || auction.status === 'PAUSED' || auction.status === 'COMPLETED')) {
    if (!session) {
      // If completed, show results view for public
      if (auction.status === 'COMPLETED') {
        // Need to provide a dummy userId and role for public access
        return <ResultsView auction={auction} userId="" userRole="BIDDER" />
      }
      // Get current player if exists
      let currentPlayer = null
      if (auction.currentPlayerId) {
        currentPlayer = await prisma.player.findUnique({
          where: { id: auction.currentPlayerId }
        })
      }

      // Calculate stats
      const totalPlayers = auction.players.length
      const soldPlayers = auction.players.filter(p => p.status === 'SOLD').length
      const unsoldPlayers = auction.players.filter(p => p.status === 'UNSOLD').length
      const availablePlayers = totalPlayers - soldPlayers - unsoldPlayers

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
        <PublicAuctionView 
          auction={auction}
          currentPlayer={currentPlayer}
          stats={stats}
          bidHistory={bidHistory}
          bidders={auction.bidders}
        />
      )
    }
  }

  // For non-published or non-live auctions, require authentication and proper access
  if (!session) {
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

  // Calculate stats
  const totalPlayers = auction.players.length
  const soldPlayers = auction.players.filter(p => p.status === 'SOLD').length
  const unsoldPlayers = auction.players.filter(p => p.status === 'UNSOLD').length
  const availablePlayers = totalPlayers - soldPlayers - unsoldPlayers

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

  return isSuperAdmin || (isAdmin && isCreator) ? (
    <AdminAuctionView 
      auction={auction}
      currentPlayer={currentPlayer}
      stats={stats}
      bidHistory={bidHistory}
    />
  ) : (
    <BidderAuctionView
      auction={auction}
      currentPlayer={currentPlayer}
      stats={stats}
    />
  )
}

