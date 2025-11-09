'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { MoreVertical, Users, Edit, Trash2, Play, Globe, UserPlus, Eye, Copy, Share2, Link2 } from 'lucide-react'
import { AuctionStatus } from '@prisma/client'
import { toast } from 'sonner'

const getStatusBadge = (status: AuctionStatus, isPublished: boolean = false) => {
  const colors = {
    DRAFT: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
    LIVE: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    PAUSED: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    COMPLETED: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
  }

  // Show "PUBLISHED" for published DRAFT auctions instead of "DRAFT"
  const displayText = (status === 'DRAFT' && isPublished) ? 'PUBLISHED' : status

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colors[status]}`}>
      {displayText}
    </span>
  )
}

interface Auction {
  id: string
  name: string
  description: string | null
  rules?: any
  status: AuctionStatus
  isPublished: boolean
  createdAt: Date
  totalViews: number
  uniqueVisitors: number
  peakViewers: number
  _count: {
    players: number
    bidders: number
  }
}

interface AuctionsTableProps {
  auctions: Auction[]
}

export function AuctionsTable({ auctions }: AuctionsTableProps) {
  const router = useRouter()
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [duplicateSuccessDialogOpen, setDuplicateSuccessDialogOpen] = useState(false)
  const [duplicatedBidders, setDuplicatedBidders] = useState<any[]>([])
  const [newAuctionId, setNewAuctionId] = useState<string | null>(null)
  const [auctionToDelete, setAuctionToDelete] = useState<Auction | null>(null)
  const [selectedAuction, setSelectedAuction] = useState<Auction | null>(null)
  const [editFormData, setEditFormData] = useState({
    name: '',
    description: '',
    image: '',
    scheduledStartDate: '',
    scheduledStartTime: '',
    minBidIncrement: 1000,
    countdownSeconds: 15,
    maxTeamSize: '',
    enforcePurse: true,
    iconPlayerCount: 10,
    mandatoryTeamSize: 12,
    bidderCount: 10
  })

  const handleManagePlayers = (auctionId: string) => {
    router.push(`/dashboard/auctions/${auctionId}/players`)
  }

  const handleManageBidders = (auctionId: string) => {
    router.push(`/dashboard/auctions/${auctionId}/bidders`)
  }

  const handleViewAuction = (auctionId: string) => {
    window.open(`/auction/${auctionId}`, '_blank', 'noopener,noreferrer')
  }

  const handleEdit = (auction: Auction) => {
    setSelectedAuction(auction)
    
    // Extract rules from auction
    const rules = auction.rules as any
    
    // Parse scheduledStartDate if it exists
    let scheduledStartDate = ''
    let scheduledStartTime = ''
    const auctionWithDate = auction as any // Type assertion to access scheduledStartDate
    if (auctionWithDate.scheduledStartDate) {
      const date = new Date(auctionWithDate.scheduledStartDate)
      scheduledStartDate = date.toISOString().split('T')[0]
      scheduledStartTime = date.toTimeString().slice(0, 5) // HH:MM format
    }
    
    const auctionData = auction as any
    setEditFormData({
      name: auction.name,
      description: auction.description || '',
      image: auctionData.image || '',
      scheduledStartDate,
      scheduledStartTime,
      minBidIncrement: rules?.minBidIncrement || 1000,
      countdownSeconds: rules?.countdownSeconds || 15,
      maxTeamSize: rules?.maxTeamSize?.toString() || '',
      enforcePurse: rules?.enforcePurse !== undefined ? rules.enforcePurse : true,
      iconPlayerCount: rules?.iconPlayerCount ?? 10,
      mandatoryTeamSize: rules?.mandatoryTeamSize || 12,
      bidderCount: rules?.bidderCount || 10
    })
    setEditDialogOpen(true)
  }

  const handleSaveEdit = async () => {
    if (!selectedAuction) return

    // Ensure all required fields are included, even if they're 0 or empty
    const rules = {
      minBidIncrement: editFormData.minBidIncrement || 1000,
      countdownSeconds: editFormData.countdownSeconds || 15,
      maxTeamSize: editFormData.maxTeamSize ? Number(editFormData.maxTeamSize) : null,
      enforcePurse: editFormData.enforcePurse !== undefined ? editFormData.enforcePurse : true,
      iconPlayerCount: editFormData.iconPlayerCount !== undefined ? Number(editFormData.iconPlayerCount) : 10,
      mandatoryTeamSize: editFormData.mandatoryTeamSize || 12,
      bidderCount: editFormData.bidderCount !== undefined ? Number(editFormData.bidderCount) : 10
    }

    try {
      // Prepare request body
      const requestBody: any = {
        name: editFormData.name,
        description: editFormData.description,
        image: editFormData.image || null,
        rules: rules
      }

      // Only include scheduledStartDate if both date and time are provided
      if (editFormData.scheduledStartDate && editFormData.scheduledStartTime) {
        try {
          requestBody.scheduledStartDate = new Date(`${editFormData.scheduledStartDate}T${editFormData.scheduledStartTime}`).toISOString()
        } catch (dateError) {
          console.error('Error creating date:', dateError)
          // If date creation fails, don't include it
        }
      } else if (editFormData.scheduledStartDate || editFormData.scheduledStartTime) {
        // If only one is provided, clear it by sending null
        requestBody.scheduledStartDate = null
      }

      const response = await fetch(`/api/auctions/${selectedAuction.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      })

      if (response.ok) {
        toast.success('Auction updated successfully!')
        setEditDialogOpen(false)
        window.location.reload()
      } else {
        const data = await response.json()
        toast.error(data.error || 'Failed to update auction')
      }
    } catch (error) {
      console.error('Error updating auction:', error)
      toast.error('Failed to update auction')
    }
  }

  const handleStartAuction = async (auctionId: string, auction: any) => {
    if (!auction.isPublished) {
      toast.error('Please publish the auction first before starting it')
      return
    }
    
    try {
      const response = await fetch(`/api/auction/${auctionId}/start`, {
        method: 'POST'
      })
      if (response.ok) {
        toast.success('Auction started successfully!')
        window.open(`/auction/${auctionId}`, '_blank', 'noopener,noreferrer')
      } else {
        const data = await response.json()
        toast.error(data.error || 'Failed to start auction')
      }
    } catch (error) {
      console.error('Error starting auction:', error)
      toast.error('Failed to start auction')
    }
  }

  const handlePublish = async (auctionId: string) => {
    try {
      const response = await fetch(`/api/auctions/${auctionId}/publish`, {
        method: 'POST'
      })
      if (response.ok) {
        toast.success('Auction published successfully!')
        window.location.reload() // Refresh to show updated status
      } else {
        const data = await response.json()
        toast.error(data.error || 'Failed to publish auction')
      }
    } catch (error) {
      console.error('Error publishing auction:', error)
      toast.error('Failed to publish auction')
    }
  }

  const handleCopyUrl = (auctionId: string) => {
    const url = `${window.location.origin}/auction/${auctionId}`
    navigator.clipboard.writeText(url).then(() => {
      toast.success('Auction URL copied to clipboard!')
    }).catch(() => {
      toast.error('Failed to copy URL')
    })
  }

  const handleDelete = (auction: Auction) => {
    setAuctionToDelete(auction)
    setDeleteDialogOpen(true)
  }

  const confirmDelete = async () => {
    if (!auctionToDelete) return

    try {
      const response = await fetch(`/api/auctions/${auctionToDelete.id}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        toast.success('Auction deleted successfully!')
        setDeleteDialogOpen(false)
        window.location.reload()
      } else {
        const data = await response.json()
        toast.error(data.error || 'Failed to delete auction')
      }
    } catch (error) {
      console.error('Error deleting auction:', error)
      toast.error('Failed to delete auction')
    }
  }

  const handleDuplicate = async (auction: Auction) => {
    try {
      const response = await fetch(`/api/auctions/${auction.id}/duplicate`, {
        method: 'POST'
      })

      if (response.ok) {
        const data = await response.json()
        setDuplicatedBidders(data.bidders || [])
        setNewAuctionId(data.auctionId)
        setDuplicateSuccessDialogOpen(true)
      } else {
        const data = await response.json()
        toast.error(data.error || 'Failed to duplicate auction')
      }
    } catch (error) {
      console.error('Error duplicating auction:', error)
      toast.error('Failed to duplicate auction')
    }
  }

  return (
    <>
      {/* Mobile Card View */}
      <div className="lg:hidden space-y-3">
        {auctions.map((auction) => (
          <div
            key={auction.id}
            className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-3"
          >
            <div className="flex justify-between items-start">
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">
                  {auction.name}
                </h3>
                {auction.description && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mt-1">
                    {auction.description}
                  </p>
                )}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => handleManagePlayers(auction.id)}>
                    <Users className="mr-2 h-4 w-4" />
                    Manage Players
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleManageBidders(auction.id)}>
                    <UserPlus className="mr-2 h-4 w-4" />
                    Manage Bidders
                  </DropdownMenuItem>
                  {(auction.status === 'LIVE' || auction.status === 'PAUSED') && (
                    <DropdownMenuItem onClick={() => handleViewAuction(auction.id)}>
                      <Eye className="mr-2 h-4 w-4" />
                      View Live Auction
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => handleEdit(auction)}>
                    <Edit className="mr-2 h-4 w-4" />
                    Edit
                  </DropdownMenuItem>
                  {auction.status === 'COMPLETED' && (
                    <DropdownMenuItem onClick={() => handleDuplicate(auction)}>
                      <Copy className="mr-2 h-4 w-4" />
                      Duplicate Auction
                    </DropdownMenuItem>
                  )}
                  {auction.status === 'DRAFT' && (
                    <DropdownMenuItem onClick={() => handleStartAuction(auction.id, auction)}>
                      <Play className="mr-2 h-4 w-4" />
                      Start Auction
                    </DropdownMenuItem>
                  )}
                  {!auction.isPublished && (
                    <DropdownMenuItem onClick={() => handlePublish(auction.id)}>
                      <Globe className="mr-2 h-4 w-4" />
                      Publish
                    </DropdownMenuItem>
                  )}
                  {auction.isPublished && (
                    <DropdownMenuItem onClick={() => handleCopyUrl(auction.id)}>
                      <Link2 className="mr-2 h-4 w-4" />
                      Copy URL
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onClick={() => handleDelete(auction)}
                    className="text-red-600 dark:text-red-400"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-4">
                <span className="text-gray-600 dark:text-gray-400">Players:</span>
                <span className="font-medium text-gray-900 dark:text-gray-100">{auction._count.players}</span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-gray-600 dark:text-gray-400">Bidders:</span>
                <span className="font-medium text-gray-900 dark:text-gray-100">{auction._count.bidders}</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>{getStatusBadge(auction.status, auction.isPublished)}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {new Date(auction.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop Table View */}
      <div className="hidden lg:block overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Name</TableHead>
              <TableHead className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</TableHead>
              <TableHead className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Players</TableHead>
              <TableHead className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Bidders</TableHead>
              <TableHead className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Views</TableHead>
              <TableHead className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Unique</TableHead>
              <TableHead className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Peak</TableHead>
              <TableHead className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Created</TableHead>
              <TableHead className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider w-16">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {auctions.map((auction) => (
              <TableRow key={auction.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <TableCell>
                  <div>
                    <div className="font-medium text-sm text-gray-900 dark:text-gray-100">{auction.name}</div>
                    {auction.description && (
                      <div className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                        {auction.description}
                      </div>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {getStatusBadge(auction.status, auction.isPublished)}
                </TableCell>
                <TableCell className="text-sm text-gray-900 dark:text-gray-100">
                  {auction._count.players}
                </TableCell>
                <TableCell className="text-sm text-gray-900 dark:text-gray-100">
                  {auction._count.bidders}
                </TableCell>
                <TableCell className="text-sm text-gray-900 dark:text-gray-100 font-medium">
                  {auction.totalViews.toLocaleString()}
                </TableCell>
                <TableCell className="text-sm text-gray-600 dark:text-gray-400">
                  {auction.uniqueVisitors.toLocaleString()}
                </TableCell>
                <TableCell className="text-sm text-gray-600 dark:text-gray-400">
                  {auction.peakViewers}
                </TableCell>
                <TableCell className="text-sm text-gray-600 dark:text-gray-400">
                  {new Date(auction.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </TableCell>
            <TableCell className="text-right">
              <DropdownMenu>
                <DropdownMenuTrigger className="h-8 w-8 p-0 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md flex items-center justify-center">
                  <span className="sr-only">Open menu</span>
                  <MoreVertical className="h-4 w-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => handleManagePlayers(auction.id)}>
                    <Users className="mr-2 h-4 w-4" />
                    Manage Players
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleManageBidders(auction.id)}>
                    <UserPlus className="mr-2 h-4 w-4" />
                    Manage Bidders
                  </DropdownMenuItem>
                  {(auction.status === 'LIVE' || auction.status === 'PAUSED') && (
                    <DropdownMenuItem onClick={() => handleViewAuction(auction.id)}>
                      <Eye className="mr-2 h-4 w-4" />
                      View Live Auction
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => handleEdit(auction)}>
                    <Edit className="mr-2 h-4 w-4" />
                    Edit
                  </DropdownMenuItem>
                  {auction.status === 'COMPLETED' && (
                    <DropdownMenuItem onClick={() => handleDuplicate(auction)}>
                      <Copy className="mr-2 h-4 w-4" />
                      Duplicate Auction
                    </DropdownMenuItem>
                  )}
                  {auction.status === 'DRAFT' && (
                    <DropdownMenuItem onClick={() => handleStartAuction(auction.id, auction)}>
                      <Play className="mr-2 h-4 w-4" />
                      Start Auction
                    </DropdownMenuItem>
                  )}
                  {!auction.isPublished && (
                    <DropdownMenuItem onClick={() => handlePublish(auction.id)}>
                      <Globe className="mr-2 h-4 w-4" />
                      Publish
                    </DropdownMenuItem>
                  )}
                  {auction.isPublished && (
                    <DropdownMenuItem onClick={() => handleCopyUrl(auction.id)}>
                      <Link2 className="mr-2 h-4 w-4" />
                      Copy URL
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem variant="destructive" onClick={() => handleDelete(auction)}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
      </div>
      
      {/* Dialogs */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Auction</DialogTitle>
            <DialogDescription>
              Update the auction details below.
            </DialogDescription>
          </DialogHeader>
          {selectedAuction && selectedAuction.status === 'DRAFT' ? (
            <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
              {/* Basic Info */}
              <div className="space-y-2">
                <Label htmlFor="edit-name">Auction Name *</Label>
                <Input 
                  id="edit-name" 
                  value={editFormData.name}
                  onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                  placeholder="Enter auction name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-description">Description</Label>
                <Textarea 
                  id="edit-description" 
                  value={editFormData.description}
                  onChange={(e) => setEditFormData({ ...editFormData, description: e.target.value })}
                  rows={3}
                  placeholder="Enter auction description (optional)"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-image">Cover Image URL</Label>
                <Input 
                  id="edit-image" 
                  value={editFormData.image}
                  onChange={(e) => setEditFormData({ ...editFormData, image: e.target.value })}
                  placeholder="https://example.com/image.jpg (optional)"
                  type="url"
                />
                <p className="text-xs text-muted-foreground">
                  Add a cover image for your auction. This will appear in URL previews when shared on social media.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-scheduledStartDate">Scheduled Start Date</Label>
                  <Input
                    id="edit-scheduledStartDate"
                    type="date"
                    value={editFormData.scheduledStartDate}
                    onChange={(e) => setEditFormData({ ...editFormData, scheduledStartDate: e.target.value })}
                    min={new Date().toISOString().split('T')[0]}
                  />
                  <p className="text-xs text-gray-500">When the auction is scheduled to start (optional)</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-scheduledStartTime">Scheduled Start Time</Label>
                  <Input
                    id="edit-scheduledStartTime"
                    type="time"
                    value={editFormData.scheduledStartTime}
                    onChange={(e) => setEditFormData({ ...editFormData, scheduledStartTime: e.target.value })}
                    disabled={!editFormData.scheduledStartDate}
                  />
                  <p className="text-xs text-gray-500">Time when the auction starts (optional)</p>
                </div>
              </div>

              {/* Bidding Rules */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-minBidIncrement">Minimum Bid Increment *</Label>
                  <Input 
                    id="edit-minBidIncrement"
                    type="number"
                    value={editFormData.minBidIncrement}
                    onChange={(e) => setEditFormData({ ...editFormData, minBidIncrement: Number(e.target.value) })}
                    min="1"
                  />
                  <p className="text-xs text-gray-500">Minimum amount by which bids must increase</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-countdownSeconds">Countdown Timer (seconds) *</Label>
                  <Input 
                    id="edit-countdownSeconds"
                    type="number"
                    value={editFormData.countdownSeconds}
                    onChange={(e) => setEditFormData({ ...editFormData, countdownSeconds: Number(e.target.value) })}
                    min="5"
                  />
                  <p className="text-xs text-gray-500">Time limit for each player auction</p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-maxTeamSize">Maximum Team Size</Label>
                <Input 
                  id="edit-maxTeamSize"
                  type="number"
                  value={editFormData.maxTeamSize}
                  onChange={(e) => setEditFormData({ ...editFormData, maxTeamSize: e.target.value })}
                  min="1"
                  max="50"
                  placeholder="Leave empty for no limit"
                />
                <p className="text-xs text-gray-500">Maximum players a bidder can acquire (optional)</p>
              </div>

              {/* Auction Rules */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-iconPlayerCount">Icon Players Count</Label>
                  <Input 
                    id="edit-iconPlayerCount"
                    type="number"
                    value={editFormData.iconPlayerCount ?? ''}
                    onChange={(e) => {
                      const value = e.target.value === '' ? 0 : Number(e.target.value)
                      setEditFormData({ ...editFormData, iconPlayerCount: value })
                    }}
                    min="0"
                  />
                  <p className="text-xs text-gray-500">Number of icon players to be auctioned first (in random order). Set to 0 to skip icon players.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-mandatoryTeamSize">Mandatory Team Size *</Label>
                  <Input 
                    id="edit-mandatoryTeamSize"
                    type="number"
                    value={editFormData.mandatoryTeamSize}
                    onChange={(e) => setEditFormData({ ...editFormData, mandatoryTeamSize: Number(e.target.value) })}
                    min="1"
                  />
                  <p className="text-xs text-gray-500">Minimum players including bidder (e.g., 11 players + 1 bidder = 12)</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-bidderCount">Required Bidders Count *</Label>
                  <Input 
                    id="edit-bidderCount"
                    type="number"
                    value={editFormData.bidderCount ?? ''}
                    onChange={(e) => {
                      const value = e.target.value === '' ? 0 : Number(e.target.value)
                      setEditFormData({ ...editFormData, bidderCount: value })
                    }}
                    min="1"
                  />
                  <p className="text-xs text-gray-500">Minimum number of bidders required to publish the auction</p>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="edit-enforcePurse"
                  checked={editFormData.enforcePurse}
                  onCheckedChange={(checked) => 
                    setEditFormData({ ...editFormData, enforcePurse: checked as boolean })
                  }
                />
                <Label htmlFor="edit-enforcePurse" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                  Enforce Purse Limit
                </Label>
              </div>
              <p className="text-xs text-gray-500 ml-6">Prevent bidders from bidding more than their remaining purse amount</p>

              {/* Status and Statistics (Read-only) */}
              <div className="space-y-2">
                <Label>Status</Label>
                <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800 rounded-md text-sm">
                  {selectedAuction.status}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Statistics</Label>
                <div className="grid grid-cols-2 gap-4">
                  <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800 rounded-md">
                    <div className="text-xs text-gray-500 dark:text-gray-400">Players</div>
                    <div className="text-lg font-semibold">{selectedAuction._count.players}</div>
                  </div>
                  <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800 rounded-md">
                    <div className="text-xs text-gray-500 dark:text-gray-400">Bidders</div>
                    <div className="text-lg font-semibold">{selectedAuction._count.bidders}</div>
                  </div>
                </div>
              </div>
            </div>
          ) : selectedAuction ? (
            <div className="space-y-4">
              <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md">
                <p className="text-sm text-yellow-800 dark:text-yellow-200">
                  You can only edit auctions that are in DRAFT status. This auction has already been started or published.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Auction Name</Label>
                <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800 rounded-md text-sm">
                  {selectedAuction.name}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800 rounded-md text-sm">
                  {selectedAuction.description || 'No description'}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800 rounded-md text-sm">
                  {selectedAuction.status}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Statistics</Label>
                <div className="grid grid-cols-2 gap-4">
                  <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800 rounded-md">
                    <div className="text-xs text-gray-500 dark:text-gray-400">Players</div>
                    <div className="text-lg font-semibold">{selectedAuction._count.players}</div>
                  </div>
                  <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800 rounded-md">
                    <div className="text-xs text-gray-500 dark:text-gray-400">Bidders</div>
                    <div className="text-lg font-semibold">{selectedAuction._count.bidders}</div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)} className="text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800">
              Cancel
            </Button>
            <Button 
              onClick={handleSaveEdit}
              disabled={selectedAuction?.status !== 'DRAFT'}
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Duplicate Success Dialog */}
      <Dialog open={duplicateSuccessDialogOpen} onOpenChange={setDuplicateSuccessDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Auction Duplicated Successfully!</DialogTitle>
            <DialogDescription>
              Bidders have been copied with new credentials. Please share these credentials with the bidders.
            </DialogDescription>
          </DialogHeader>
          {duplicatedBidders.length > 0 && (
            <div className="space-y-4">
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md p-4">
                <div className="text-sm font-semibold text-green-800 dark:text-green-200 mb-4">
                  Copied Bidders ({duplicatedBidders.length}):
                </div>
                <div className="space-y-4">
                  {duplicatedBidders.map((bidder, index) => (
                    <div key={index} className="border-l-4 border-blue-500 pl-3 bg-white dark:bg-gray-800 py-3 rounded-r">
                      <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-2">
                        {bidder.teamName || bidder.name} - {bidder.name}
                      </div>
                      <div className="space-y-2">
                        <div>
                          <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-0.5">Username:</div>
                          <div className="text-sm font-mono text-gray-900 dark:text-gray-100 break-all">{bidder.username}</div>
                        </div>
                        <div>
                          <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-0.5">Password:</div>
                          <div className="text-sm font-mono text-gray-900 dark:text-gray-100 break-all">{bidder.password}</div>
                        </div>
                        <div>
                          <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-0.5">Email:</div>
                          <div className="text-sm font-mono text-gray-900 dark:text-gray-100 break-all">{bidder.email}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md p-3">
                <p className="text-sm text-yellow-800 dark:text-yellow-200">
                  <strong>Note:</strong> Save these credentials securely. They will not be shown again.
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              onClick={() => {
                setDuplicateSuccessDialogOpen(false)
                setDuplicatedBidders([])
                if (newAuctionId) {
                  window.location.href = `/dashboard/auctions/${newAuctionId}/players`
                } else {
                  window.location.reload()
                }
              }}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              Go to Auction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Auction</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{auctionToDelete?.name}"? This action cannot be undone.
              This will also delete all associated players and bidders.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
