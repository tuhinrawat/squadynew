import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import dynamic from 'next/dynamic'
import { isCuid } from '@/lib/slug'
import { Prisma } from '@prisma/client'

// Dynamically import client component with SSR disabled
const AnalyticsView = dynamic(() => import('@/components/analytics-view').then(mod => ({ default: mod.AnalyticsView })), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">Loading analytics...</p>
      </div>
    </div>
  )
})

export default async function AnalyticsPage({ 
  params,
  searchParams 
}: { 
  params: { id: string }
  searchParams: { key?: string }
}) {
  // Check for special key
  if (searchParams.key !== 'tushkiKILLS') {
    redirect('/')
  }

  // Determine if the param is a slug or an ID
  const isId = isCuid(params.id)
  
  // Fetch auction by slug or ID (support both for analytics)
  const auction = isId
    ? await prisma.auction.findUnique({
        where: { id: params.id },
        include: {
          players: {
            orderBy: {
              createdAt: 'asc'
            }
          },
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
          players: {
            orderBy: {
              createdAt: 'asc'
            }
          },
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
    redirect('/')
  }

  // No need to find a specific bidder - user will select from list
  if (!auction.bidders || auction.bidders.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">No Bidders Found</h1>
          <p className="text-gray-600">No bidders registered for this auction.</p>
        </div>
      </div>
    )
  }

  // Fetch bid history
  let bidHistory: any[] = []
  if (auction.bidHistory && typeof auction.bidHistory === 'object') {
    const bidHistoryData = auction.bidHistory as any
    if (Array.isArray(bidHistoryData)) {
      bidHistory = bidHistoryData
    }
  }

  // Get current player
  const currentPlayer = auction.players.find(p => p.id === auction.currentPlayerId) || null

  // Serialize data for client component (Prisma objects need to be serialized)
  const serializedAuction = {
    ...auction,
    createdAt: auction.createdAt.toISOString(),
    analyticsVisibleColumns: (auction as any).analyticsVisibleColumns || null,
    players: auction.players.map(p => ({
      ...p,
      createdAt: p.createdAt.toISOString(),
      data: p.data
    })),
    bidders: auction.bidders.map(b => ({
      ...b,
      createdAt: b.createdAt.toISOString(),
      user: b.user ? {
        ...b.user
      } : null
    }))
  }

  const serializedCurrentPlayer = currentPlayer ? {
    ...currentPlayer,
    createdAt: currentPlayer.createdAt.toISOString(),
    data: currentPlayer.data
  } : null

  return (
    <AnalyticsView
      auction={serializedAuction as any}
      currentPlayer={serializedCurrentPlayer as any}
      bidHistory={bidHistory}
    />
  )
}

