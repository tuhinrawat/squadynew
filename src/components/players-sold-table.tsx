'use client'

import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CheckCircle, XCircle, Eye, Download, ChevronUp, ChevronDown } from 'lucide-react'

interface Player {
  id: string
  name: string
  data: any
  soldPrice: number | null
  soldTo: string | null
  status: string
}

interface PlayersSoldTableProps {
  auction: {
    id: string
    players: Player[]
    bidders: any[]
    bidHistory?: any
  }
}

export function PlayersSoldTable({ auction }: PlayersSoldTableProps) {
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortColumn, setSortColumn] = useState<'status' | 'price'>('status')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'SOLD' | 'UNSOLD' | 'AVAILABLE'>('ALL')
  const [selectedBidder, setSelectedBidder] = useState<string | null>(null)

  const getPlayerName = (player: Player) => {
    if (!player.data) return 'Unknown'
    const data = player.data as any
    return data.name || data.Name || 'Unknown'
  }

  const getPlayerData = (player: Player, field: string) => {
    if (!player.data) return '-'
    const data = player.data as any
    // Try different case variations
    return data[field] || data[field.charAt(0).toUpperCase() + field.slice(1)] || '-'
  }

  const getBuyerInfo = (soldTo: string | null) => {
    if (!soldTo) return null
    return auction.bidders.find(b => b.id === soldTo)
  }

  const getPlayerBidHistory = (playerId: string) => {
    if (!auction.bidHistory) return []
    const bidHistory = Array.isArray(auction.bidHistory) ? auction.bidHistory : []
    
    // Find this player's sale/unsold event to determine the range
    let playerSaleIndex = -1
    let previousPlayerSaleIndex = bidHistory.length
    
    // Find this player's sale event
    for (let i = 0; i < bidHistory.length; i++) {
      const bid = bidHistory[i]
      if (bid.playerId === playerId && (bid.type === 'sold' || bid.type === 'unsold')) {
        playerSaleIndex = i
        break
      }
    }
    
    if (playerSaleIndex === -1) {
      // No sale event found for this player
      return []
    }
    
    // Find the previous player's sale event (this gives us the range)
    for (let i = playerSaleIndex + 1; i < bidHistory.length; i++) {
      const bid = bidHistory[i]
      if (bid.type === 'sold' || bid.type === 'unsold') {
        previousPlayerSaleIndex = i
        break
      }
    }
    
    // Collect all bids between this player's sale and the previous player's sale
    const playerBids: any[] = []
    for (let i = playerSaleIndex; i >= previousPlayerSaleIndex; i--) {
      const bid = bidHistory[i]
      
      // Include all bids (regular bids and the sale/unsold event)
      if (bid.type === 'bid' || (bid.playerId === playerId && (bid.type === 'sold' || bid.type === 'unsold'))) {
        playerBids.unshift(bid)
      }
    }
    
    return playerBids
  }

  // Filter and sort players
  const filteredAndSortedPlayers = useMemo(() => {
    let filtered = auction.players

    // Filter by status
    if (statusFilter !== 'ALL') {
      filtered = filtered.filter(p => p.status === statusFilter)
    }

    // Filter by bidder
    if (selectedBidder) {
      filtered = filtered.filter(player => {
        if (player.soldTo === selectedBidder) return true
        return false
      })
    }

    // Filter by search term
    if (searchTerm) {
      const search = searchTerm.toLowerCase()
      filtered = filtered.filter(player => {
        const playerName = getPlayerName(player).toLowerCase()
        const speciality = getPlayerData(player, 'Speciality')?.toLowerCase() || ''
        const buyer = getBuyerInfo(player.soldTo)
        const buyerName = buyer ? (buyer.teamName || buyer.username || '').toLowerCase() : ''
        return playerName.includes(search) || speciality.includes(search) || buyerName.includes(search)
      })
    }

    // Sort players
    filtered.sort((a, b) => {
      // First, sort by status: SOLD > UNSOLD > AVAILABLE
      const statusOrder = { SOLD: 0, UNSOLD: 1, AVAILABLE: 2 }
      const statusDiff = statusOrder[a.status as keyof typeof statusOrder] - statusOrder[b.status as keyof typeof statusOrder]
      
      if (statusDiff !== 0) {
        return statusDiff
      }

      // If both are SOLD, sort by price (descending by default)
      if (a.status === 'SOLD' && b.status === 'SOLD') {
        if (sortColumn === 'price') {
          const aPrice = a.soldPrice || 0
          const bPrice = b.soldPrice || 0
          return sortDirection === 'asc' ? aPrice - bPrice : bPrice - aPrice
        }
      }

      return 0
    })

    return filtered
  }, [auction.players, statusFilter, searchTerm, sortColumn, sortDirection, selectedBidder, getPlayerName, getPlayerData, getBuyerInfo])

  const soldPlayers = filteredAndSortedPlayers.filter(p => p.status === 'SOLD')
  const unsoldPlayers = filteredAndSortedPlayers.filter(p => p.status === 'UNSOLD')
  const availablePlayers = filteredAndSortedPlayers.filter(p => p.status === 'AVAILABLE')

  const handleExport = () => {
    const csvRows = []
    
    // Helper function to escape CSV values
    const escapeCSV = (value: any): string => {
      if (value === null || value === undefined) return ''
      const str = String(value)
      // If the value contains comma, quote, or newline, wrap in quotes and escape quotes
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`
      }
      return str
    }
    
    // Add header row
    const headers = [
      'Status',
      'Player Name',
      'Speciality',
      'Batting Type',
      'Bowling Type',
      'Buyer Team',
      'Buyer Name',
      'Price'
    ]
    csvRows.push(headers.join(','))
    
    // Add data rows
    auction.players.forEach(player => {
      const buyer = getBuyerInfo(player.soldTo)
      const row = [
        escapeCSV(player.status),
        escapeCSV(getPlayerName(player)),
        escapeCSV(getPlayerData(player, 'Speciality')),
        escapeCSV(getPlayerData(player, 'Batting Type')),
        escapeCSV(getPlayerData(player, 'Bowling Type')),
        buyer ? escapeCSV(buyer.teamName || buyer.username) : '',
        buyer ? escapeCSV(buyer.user?.name || buyer.username) : '',
        player.soldPrice ? escapeCSV(`₹${player.soldPrice.toLocaleString('en-IN')}`) : ''
      ]
      csvRows.push(row.join(','))
    })
    
    // Create and download CSV
    const csvContent = csvRows.join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', 'players_sold_table.csv')
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <Card>
      <CardHeader className="p-3 sm:p-6">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="text-sm sm:text-base text-gray-900 dark:text-gray-100">Players Status</CardTitle>
            <div className="flex items-center gap-3">
              <div className="flex gap-2 text-xs sm:text-sm">
                <Badge className="bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300">
                  Sold: {soldPlayers.length}
                </Badge>
                <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-300">
                  Unsold: {unsoldPlayers.length}
                </Badge>
                <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
                  Available: {availablePlayers.length}
                </Badge>
              </div>
              <Button onClick={handleExport} variant="outline" size="sm" className="text-xs sm:text-sm text-gray-900 bg-white border-gray-300 hover:bg-gray-50 dark:text-gray-100 dark:bg-gray-800 dark:border-gray-600 dark:hover:bg-gray-700">
                <Download className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                <span className="hidden sm:inline">Export</span>
                <span className="sm:hidden">Export</span>
              </Button>
            </div>
          </div>
          
          {/* Search and Filter Controls */}
          <div className="flex flex-col sm:flex-row gap-3">
            <Input
              placeholder="Search by player name, speciality, or buyer..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="flex-1"
            />
            <div className="flex gap-2">
              <Button
                variant={statusFilter === 'ALL' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter('ALL')}
                className={`text-xs ${statusFilter === 'ALL' ? '' : 'text-gray-900 bg-white border-gray-300 hover:bg-gray-50 dark:text-gray-100 dark:bg-gray-800 dark:border-gray-600 dark:hover:bg-gray-700'}`}
              >
                All
              </Button>
              <Button
                variant={statusFilter === 'SOLD' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter('SOLD')}
                className={`text-xs ${statusFilter === 'SOLD' ? '' : 'text-gray-900 bg-white border-gray-300 hover:bg-gray-50 dark:text-gray-100 dark:bg-gray-800 dark:border-gray-600 dark:hover:bg-gray-700'}`}
              >
                Sold
              </Button>
              <Button
                variant={statusFilter === 'UNSOLD' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter('UNSOLD')}
                className={`text-xs ${statusFilter === 'UNSOLD' ? '' : 'text-gray-900 bg-white border-gray-300 hover:bg-gray-50 dark:text-gray-100 dark:bg-gray-800 dark:border-gray-600 dark:hover:bg-gray-700'}`}
              >
                Unsold
              </Button>
              <Button
                variant={statusFilter === 'AVAILABLE' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter('AVAILABLE')}
                className={`text-xs ${statusFilter === 'AVAILABLE' ? '' : 'text-gray-900 bg-white border-gray-300 hover:bg-gray-50 dark:text-gray-100 dark:bg-gray-800 dark:border-gray-600 dark:hover:bg-gray-700'}`}
              >
                Available
              </Button>
            </div>
          </div>

          {/* Bidder Filter */}
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <span className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300">Filter by Bidder:</span>
            <div className="flex flex-wrap gap-2">
              <Button
                variant={selectedBidder === null ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedBidder(null)}
                className={`text-xs ${selectedBidder === null ? '' : 'text-gray-900 bg-white border-gray-300 hover:bg-gray-50 dark:text-gray-100 dark:bg-gray-800 dark:border-gray-600 dark:hover:bg-gray-700'}`}
              >
                All Bidders
              </Button>
              {auction.bidders.map((bidder) => (
                <Button
                  key={bidder.id}
                  variant={selectedBidder === bidder.id ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedBidder(selectedBidder === bidder.id ? null : bidder.id)}
                  className={`text-xs ${selectedBidder === bidder.id ? '' : 'text-gray-900 bg-white border-gray-300 hover:bg-gray-50 dark:text-gray-100 dark:bg-gray-800 dark:border-gray-600 dark:hover:bg-gray-700'}`}
                >
                  {bidder.teamName || bidder.username}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-3 sm:p-6">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 sm:w-16">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (sortColumn === 'status') {
                        setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
                      } else {
                        setSortColumn('status')
                        setSortDirection('asc')
                      }
                    }}
                    className="h-8 px-2 text-gray-900 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-700"
                  >
                    Status
                    {sortColumn === 'status' && (sortDirection === 'asc' ? <ChevronUp className="ml-1 h-3 w-3" /> : <ChevronDown className="ml-1 h-3 w-3" />)}
                  </Button>
                </TableHead>
                <TableHead className="w-12 sm:w-16">Icon</TableHead>
                <TableHead className="min-w-[150px]">Player Name</TableHead>
                <TableHead className="hidden sm:table-cell min-w-[100px]">Speciality</TableHead>
                <TableHead className="hidden md:table-cell min-w-[100px]">Batting</TableHead>
                <TableHead className="hidden lg:table-cell min-w-[100px]">Bowling</TableHead>
                <TableHead className="min-w-[150px]">Buyer (Team & Name)</TableHead>
                <TableHead className="min-w-[100px]">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (sortColumn === 'price') {
                        setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
                      } else {
                        setSortColumn('price')
                        setSortDirection('desc')
                      }
                    }}
                    className="h-8 px-2 text-gray-900 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-700"
                  >
                    Price
                    {sortColumn === 'price' && (sortDirection === 'asc' ? <ChevronUp className="ml-1 h-3 w-3" /> : <ChevronDown className="ml-1 h-3 w-3" />)}
                  </Button>
                </TableHead>
                <TableHead className="w-16">Bid History</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAndSortedPlayers.map((player) => {
                const buyer = getBuyerInfo(player.soldTo)
                const status = player.status
                
                return (
                  <TableRow key={player.id}>
                    <TableCell>
                      {status === 'SOLD' ? (
                        <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
                      ) : status === 'UNSOLD' ? (
                        <XCircle className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                      ) : (
                        <div className="h-5 w-5 rounded-full border-2 border-gray-300 dark:border-gray-600" />
                      )}
                    </TableCell>
                    <TableCell>
                      {(player as any).isIcon && (
                        <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-300 text-xs">
                          ⭐ Icon
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-semibold text-sm sm:text-base">
                      {getPlayerName(player)}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                        {getPlayerData(player, 'Speciality') || '-'}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                        {getPlayerData(player, 'Batting Type') || '-'}
                      </div>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                        {getPlayerData(player, 'Bowling Type') || '-'}
                      </div>
                    </TableCell>
                    <TableCell>
                      {buyer ? (
                        <div className="text-xs sm:text-sm">
                          <div className="font-medium text-gray-900 dark:text-gray-100">
                            {buyer.teamName || buyer.username}
                          </div>
                          <div className="text-xs text-gray-600 dark:text-gray-400">
                            {buyer.user?.name || buyer.username}
                          </div>
                        </div>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500 text-xs sm:text-sm">-</span>
                      )}
                    </TableCell>
                    <TableCell className="font-semibold">
                      {player.soldPrice ? (
                        <span className="text-green-600 dark:text-green-400 text-sm sm:text-base">
                          ₹{player.soldPrice.toLocaleString('en-IN')}
                        </span>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500 text-xs sm:text-sm">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button 
                        variant="ghost" 
                        size="icon"
                        className="h-6 w-6 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800"
                        onClick={() => {
                          setSelectedPlayer(player)
                          setDialogOpen(true)
                        }}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      {/* Bid History Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="text-gray-900 dark:text-gray-100">
              {selectedPlayer ? getPlayerName(selectedPlayer) : 'Bid History'}
            </DialogTitle>
            <DialogDescription className="text-gray-600 dark:text-gray-400">
              View the complete bid history for this player
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 overflow-y-auto max-h-[60vh]">
            {selectedPlayer && (
              <div className="space-y-2">
                {getPlayerBidHistory(selectedPlayer.id).length === 0 ? (
                  <p className="text-sm text-gray-600 dark:text-gray-400">No bid history available for this player.</p>
                ) : (
                  getPlayerBidHistory(selectedPlayer.id).map((bid: any, index: number) => (
                    <div key={index} className="p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                      {bid.type === 'bid' ? (
                        <div className="text-sm">
                          <div className="font-semibold text-gray-900 dark:text-gray-100">
                            {bid.bidderName} {bid.teamName && `(${bid.teamName})`}
                          </div>
                          <div className="text-green-600 dark:text-green-400 font-medium mt-1">
                            ₹{bid.amount.toLocaleString('en-IN')}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            {new Date(bid.timestamp).toLocaleString()}
                          </div>
                        </div>
                      ) : bid.type === 'sold' ? (
                        <div className="text-sm">
                          <div className="font-semibold text-green-700 dark:text-green-300">Sold to {bid.bidderName} {bid.teamName && `(${bid.teamName})`}</div>
                          <div className="text-green-600 dark:text-green-400 font-medium mt-1">
                            ₹{bid.amount.toLocaleString('en-IN')}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            {new Date(bid.timestamp).toLocaleString()}
                          </div>
                        </div>
                      ) : bid.type === 'unsold' ? (
                        <div className="text-sm">
                          <div className="font-semibold text-orange-700 dark:text-orange-300">Player Unsold</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            {new Date(bid.timestamp).toLocaleString()}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

