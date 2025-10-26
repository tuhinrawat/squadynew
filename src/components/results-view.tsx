'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Download, ArrowLeft, CheckCircle, XCircle } from 'lucide-react'
import Link from 'next/link'
import { formatCurrency } from '@/lib/currency'

interface ResultsViewProps {
  auction: any
  userId: string
  userRole: 'ADMIN' | 'BIDDER'
}

export function ResultsView({ auction, userId, userRole }: ResultsViewProps) {
  const soldPlayers = auction.players.filter((p: any) => p.status === 'SOLD')
  const unsoldPlayers = auction.players.filter((p: any) => p.status === 'UNSOLD')

  // Get user's team/bidder info
  const userBidder = auction.bidders.find((b: any) => b.userId === userId)
  const wonPlayers = soldPlayers.filter((p: any) => p.soldTo === userBidder?.id)

  const totalSpent = wonPlayers.reduce((sum: number, p: any) => sum + (p.soldPrice || 0), 0)
  const remainingPurse = userBidder ? userBidder.purseAmount - totalSpent : 0

  const handleDownloadResults = () => {
    // Create CSV content
    const csvHeaders = ['Player Name', 'Status', 'Sold To', 'Sold Price']
    const csvRows = auction.players.map((p: any) => {
      const data = p.data as Record<string, any>
      const playerName = data.name || data.Name || 'Unknown'
      return [
        playerName,
        p.status,
        p.soldTo ? auction.bidders.find((b: any) => b.id === p.soldTo)?.teamName || 'Unknown' : 'N/A',
        p.soldPrice || 'N/A'
      ]
    })

    const csvContent = [
      csvHeaders.join(','),
      ...csvRows.map(row => row.join(','))
    ].join('\n')

    // Download
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${auction.name}-results.csv`
    a.click()
    window.URL.revokeObjectURL(url)
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">{auction.name}</h1>
            <Badge className="mt-2 bg-blue-500">COMPLETED</Badge>
          </div>
          <div className="flex gap-4">
            {userId && (
              <Button variant="outline" asChild>
                <Link href={userRole === 'ADMIN' ? '/dashboard/auctions' : '/bidder/auctions'}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back
                </Link>
              </Button>
            )}
            {auction.isPublished && (
              <Button onClick={handleDownloadResults}>
                <Download className="mr-2 h-4 w-4" />
                Download Results
              </Button>
            )}
          </div>
        </div>

        {/* Bidders Summary (Admin View) */}
        {userRole === 'ADMIN' && userId && (
          <Card>
            <CardHeader>
              <CardTitle>Bidders Summary</CardTitle>
              <CardDescription>Summary of all bidders in this auction</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[150px]">Team Name</TableHead>
                      <TableHead className="hidden md:table-cell">Bidder Name</TableHead>
                      <TableHead>Players Won</TableHead>
                      <TableHead>Total Spent</TableHead>
                      <TableHead>Remaining Purse</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {auction.bidders.map((bidder: any) => {
                      const bidderWonPlayers = soldPlayers.filter((p: any) => p.soldTo === bidder.id)
                      const bidderTotalSpent = bidderWonPlayers.reduce((sum: number, p: any) => sum + (p.soldPrice || 0), 0)
                      return (
                        <TableRow key={bidder.id}>
                          <TableCell className="font-medium">{bidder.teamName || bidder.username}</TableCell>
                          <TableCell className="hidden md:table-cell text-gray-600 dark:text-gray-400">{bidder.user?.name || bidder.username}</TableCell>
                          <TableCell>{bidderWonPlayers.length}</TableCell>
                          <TableCell>{formatCurrency(bidderTotalSpent)}</TableCell>
                          <TableCell>{formatCurrency(bidder.remainingPurse)}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* User's Summary (Bidder View) */}
        {userRole === 'BIDDER' && userBidder && userId && (
          <Card>
            <CardHeader>
              <CardTitle>Your Summary</CardTitle>
              <CardDescription>Your results from this auction</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">Players Won</div>
                  <div className="text-2xl font-bold">{wonPlayers.length}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">Total Spent</div>
                  <div className="text-2xl font-bold">{formatCurrency(totalSpent)}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">Remaining Purse</div>
                  <div className="text-2xl font-bold">{formatCurrency(userBidder.remainingPurse)}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">Team</div>
                  <div className="text-2xl font-bold">{userBidder.teamName || userBidder.username}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* All Players Table */}
        <Card>
          <CardHeader>
            <CardTitle>All Players</CardTitle>
            <CardDescription>
              {soldPlayers.length} Sold, {unsoldPlayers.length} Unsold
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">Status</TableHead>
                    <TableHead className="min-w-[150px]">Player Name</TableHead>
                    <TableHead className="hidden sm:table-cell min-w-[100px]">Speciality</TableHead>
                    <TableHead className="hidden md:table-cell min-w-[100px]">Batting</TableHead>
                    <TableHead className="hidden lg:table-cell min-w-[100px]">Bowling</TableHead>
                    <TableHead className="min-w-[150px]">Buyer (Team & Name)</TableHead>
                    <TableHead className="min-w-[100px]">Price</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auction.players.map((player: any) => {
                    const data = player.data as Record<string, any>
                    const playerName = data.name || data.Name || 'Unknown'
                    const soldToBidder = auction.bidders.find((b: any) => b.id === player.soldTo)
                    const isUsersPlayer = player.soldTo === userBidder?.id

                    return (
                      <TableRow 
                        key={player.id} 
                        className={isUsersPlayer && userId ? 'bg-green-50 dark:bg-green-900/20' : ''}
                      >
                        <TableCell>
                          <Badge className={
                            player.status === 'SOLD' ? 'bg-green-500' :
                            player.status === 'UNSOLD' ? 'bg-orange-500' :
                            'bg-blue-500'
                          }>
                            {player.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium">{playerName}</TableCell>
                        <TableCell className="hidden sm:table-cell">{data.speciality || data.Speciality || '-'}</TableCell>
                        <TableCell className="hidden md:table-cell">{data['Batting Type'] || '-'}</TableCell>
                        <TableCell className="hidden lg:table-cell">{data['Bowling Type'] || '-'}</TableCell>
                        <TableCell>
                          {soldToBidder ? (
                            <div className="text-sm">
                              <div className="font-medium text-gray-900 dark:text-gray-100">
                                {soldToBidder.teamName || soldToBidder.username}
                              </div>
                              <div className="text-xs text-gray-600 dark:text-gray-400">
                                {soldToBidder.user?.name || soldToBidder.username}
                              </div>
                            </div>
                          ) : (
                            <span className="text-gray-400 dark:text-gray-500">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {player.soldPrice ? (
                            <span className="font-semibold text-green-600 dark:text-green-400">
                              ₹{player.soldPrice.toLocaleString('en-IN')}
                            </span>
                          ) : (
                            <span className="text-gray-400 dark:text-gray-500">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

