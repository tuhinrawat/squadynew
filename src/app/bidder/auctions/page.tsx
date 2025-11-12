import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Navbar from '@/components/navbar'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

const getStatusColor = (status: string) => {
  switch (status) {
    case 'LIVE':
      return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
    case 'PAUSED':
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
    case 'COMPLETED':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
    default:
      return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
  }
}

export default async function BidderAuctions() {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect('/signin')
  }

  // Redirect non-bidders to dashboard
  if (session.user?.role !== 'BIDDER') {
    redirect('/dashboard')
  }

  // Fetch all auctions where user is a bidder
  const bidders = await prisma.bidder.findMany({
    where: {
      userId: session.user.id
    },
    include: {
      auction: {
        include: {
          players: true,
          _count: {
            select: {
              players: true,
              bidders: true
            }
          }
        }
      }
    },
    orderBy: {
      createdAt: 'desc'
    }
  })

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
              My Auctions
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              Welcome, {session.user?.name}! View and join your assigned auctions.
            </p>
          </div>

          {bidders.length === 0 ? (
            <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg shadow">
              <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-300 mb-4">
                No Assigned Auctions
              </h2>
              <p className="text-gray-500 dark:text-gray-400">
                You haven't been assigned to any auctions yet. Contact your administrator to be added to an auction.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {bidders.map((bidder) => {
                const auction = bidder.auction
                const wonPlayers = auction.players.filter(
                  p => p.status === 'SOLD' && p.soldTo === bidder.id
                ).length

                return (
                  <Card key={auction.id} className="flex flex-col">
                    <CardHeader>
                      <div className="flex justify-between items-start mb-2">
                        <CardTitle className="text-lg">{auction.name}</CardTitle>
                        <Badge className={getStatusColor(auction.status)}>
                          {auction.status}
                        </Badge>
                      </div>
                      {auction.description && (
                        <CardDescription className="line-clamp-2">
                          {auction.description}
                        </CardDescription>
                      )}
                    </CardHeader>
                    <CardContent className="flex-1 space-y-2">
                      <div className="text-sm">
                        <span className="font-medium">Team:</span> {bidder.teamName || bidder.username}
                      </div>
                      <div className="text-sm">
                        <span className="font-medium">Remaining Purse:</span>{' '}
                        ₹{bidder.remainingPurse.toLocaleString('en-IN')}
                      </div>
                      {auction.status === 'COMPLETED' ? (
                        <div className="text-sm">
                          <span className="font-medium">Players Won:</span> {wonPlayers}
                        </div>
                      ) : (
                        <div className="text-sm">
                          <span className="font-medium">Total Players:</span> {auction._count.players}
                        </div>
                      )}
                    </CardContent>
                    <CardFooter>
                      {(auction.status === 'LIVE' || auction.status === 'MOCK_RUN' || auction.status === 'PAUSED') ? (
                        <Button asChild className="w-full">
                          <Link href={`/auction/${auction.id}`} target="_blank" rel="noopener noreferrer">Join Auction</Link>
                        </Button>
                      ) : auction.status === 'COMPLETED' ? (
                        <Button variant="outline" asChild className="w-full">
                          <Link href={`/auction/${auction.id}`} target="_blank" rel="noopener noreferrer">View Results</Link>
                        </Button>
                      ) : (
                        <Button disabled className="w-full">
                          Auction Not Started
                        </Button>
                      )}
                    </CardFooter>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

