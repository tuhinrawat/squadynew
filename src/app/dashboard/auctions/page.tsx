import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { AuctionsTable } from '@/components/auctions-table'

const PAGE_SIZE = 25

export default async function AuctionsList({ searchParams }: { searchParams: { page?: string } }) {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect('/signin')
  }

  if (session.user?.role !== 'ADMIN' && session.user?.role !== 'SUPER_ADMIN') {
    redirect('/bidder/auctions')
  }

  // SUPER_ADMIN can see all auctions, regular admins see only their own
  const where = session.user?.role === 'SUPER_ADMIN'
    ? undefined
    : { createdById: session.user.id }

  const requestedPage = Number(searchParams.page) || 1
  const page = Math.max(1, Math.floor(requestedPage))

  // Paginated - a SUPER_ADMIN's list spans every auction on the platform
  // (no createdById filter above) and a busy admin's own list can also grow
  // into the hundreds; loading it all unbounded on every dashboard visit
  // doesn't scale with either.
  const [auctions, totalCount] = await Promise.all([
    prisma.auction.findMany({
      where,
      orderBy: {
        createdAt: 'desc'
      },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        description: true,
        image: true,
        rules: true,
        scheduledStartDate: true,
        status: true,
        isPublished: true,
        createdAt: true,
        totalViews: true,
        timerViews: true,
        uniqueVisitors: true,
        peakViewers: true,
        _count: {
          select: {
            players: true,
            bidders: true
          }
        }
      }
    }),
    prisma.auction.count({ where })
  ])

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  return (
    <div className="space-y-3">
      {/* Compact Header */}
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 dark:border-gray-700 pb-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Auctions</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {totalCount} {totalCount === 1 ? 'auction' : 'auctions'}
            {totalPages > 1 && ` · page ${page} of ${totalPages}`}
          </p>
        </div>
        <Link href="/dashboard/auctions/new">
          <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white">
            + New
          </Button>
        </Link>
      </div>

      {/* Table Card - No extra padding or description */}
      <Card>
        <CardContent className="p-0">
          {auctions.length === 0 ? (
            <div className="text-center py-16 px-4">
              <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              <h3 className="mt-3 text-sm font-semibold text-gray-900 dark:text-white">No auctions yet</h3>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Get started by creating your first auction</p>
              <div className="mt-5">
                <Link href="/dashboard/auctions/new">
                  <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white">Create Auction</Button>
                </Link>
              </div>
            </div>
          ) : (
            <AuctionsTable auctions={auctions} />
          )}
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 pt-1">
          {page <= 1 ? (
            <Button size="sm" variant="outline" disabled>Previous</Button>
          ) : (
            <Link href={`/dashboard/auctions?page=${page - 1}`}>
              <Button size="sm" variant="outline">Previous</Button>
            </Link>
          )}
          <span className="text-xs text-gray-500 dark:text-gray-400">Page {page} of {totalPages}</span>
          {page >= totalPages ? (
            <Button size="sm" variant="outline" disabled>Next</Button>
          ) : (
            <Link href={`/dashboard/auctions?page=${page + 1}`}>
              <Button size="sm" variant="outline">Next</Button>
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
