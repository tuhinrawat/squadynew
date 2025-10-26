'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertCircle, CheckCircle, Plus, Edit, Trash2, Loader2 } from 'lucide-react'

interface Bidder {
  id: string
  teamName: string | null
  username: string
  purseAmount: number
  remainingPurse: number
  logoUrl: string | null
  user: {
    id: string
    email: string
    name: string
    createdAt: string
  }
}

interface BidderCredentials {
  username: string
  password: string
}

export default function BidderManagement() {
  const params = useParams()
  const router = useRouter()
  const auctionId = params.id as string

  const [bidders, setBidders] = useState<Bidder[]>([])
  const [loading, setLoading] = useState(true)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [successDialogOpen, setSuccessDialogOpen] = useState(false)
  const [credentials, setCredentials] = useState<BidderCredentials | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  const [formData, setFormData] = useState({
    name: '',
    teamName: '',
    email: '',
    username: '',
    password: '',
    purseAmount: 10000000
  })

  useEffect(() => {
    fetchBidders()
  }, [auctionId])

  const fetchBidders = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/auctions/${auctionId}/bidders`)
      const data = await response.json()

      if (response.ok) {
        setBidders(data.bidders)
      } else {
        setError(data.error || 'Failed to fetch bidders')
      }
    } catch (error) {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleCreateBidder = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsCreating(true)

    try {
      const response = await fetch(`/api/auctions/${auctionId}/bidders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      const result = await response.json()

      if (response.ok) {
        setCredentials({
          username: result.bidder.username,
          password: result.bidder.password
        })
        setCreateDialogOpen(false)
        setSuccessDialogOpen(true)
        setFormData({
          name: '',
          teamName: '',
          email: '',
          username: '',
          password: '',
          purseAmount: 10000000
        })
        fetchBidders()
      } else {
        setError(result.error || 'Failed to create bidder')
      }
    } catch (error) {
      setError('Network error. Please try again.')
    } finally {
      setIsCreating(false)
    }
  }

  const handleDeleteBidder = async (bidderId: string) => {
    if (!confirm('Are you sure you want to delete this bidder?')) return

    try {
      const response = await fetch(`/api/auctions/${auctionId}/bidders/${bidderId}`, {
        method: 'DELETE'
      })

      const result = await response.json()

      if (response.ok) {
        setSuccess('Bidder deleted successfully')
        fetchBidders()
      } else {
        setError(result.error || 'Failed to delete bidder')
      }
    } catch (error) {
      setError('Network error. Please try again.')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Bidder Management</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-2">
            Add and manage bidders for this auction
          </p>
        </div>
        <Button
          onClick={() => setCreateDialogOpen(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white dark:bg-blue-600 dark:hover:bg-blue-700"
        >
          <Plus className="h-4 w-4 mr-2" />
          Create Bidder
        </Button>
      </div>

      {/* Alerts */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert>
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}

      {/* Bidders Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Bidders ({bidders.length})</CardTitle>
          <CardDescription>
            View and manage all registered bidders
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" />
              <span className="ml-2">Loading bidders...</span>
            </div>
          ) : bidders.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-lg text-gray-700 dark:text-gray-300">No bidders registered yet.</p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Get started by creating your first bidder.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Team Name</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Username</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Initial Purse</TableHead>
                    <TableHead>Remaining Purse</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bidders.map((bidder) => (
                    <TableRow key={bidder.id}>
                      <TableCell className="font-medium">
                        {bidder.teamName || '-'}
                      </TableCell>
                      <TableCell>{bidder.user.name}</TableCell>
                      <TableCell>{bidder.username}</TableCell>
                      <TableCell>{bidder.user.email}</TableCell>
                      <TableCell>
                        ₹{bidder.purseAmount.toLocaleString('en-IN')}
                      </TableCell>
                      <TableCell>
                        <span className={`font-medium ${
                          bidder.remainingPurse < bidder.purseAmount / 4
                            ? 'text-red-600 dark:text-red-400'
                            : bidder.remainingPurse < bidder.purseAmount / 2
                            ? 'text-yellow-600 dark:text-yellow-400'
                            : 'text-green-600 dark:text-green-400'
                        }`}>
                          ₹{bidder.remainingPurse.toLocaleString('en-IN')}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end space-x-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => console.log('Edit', bidder.id)}
                            className="bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleDeleteBidder(bidder.id)}
                            className="bg-red-600 hover:bg-red-700 text-white dark:bg-red-600 dark:hover:bg-red-700"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Bidder Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Bidder</DialogTitle>
            <DialogDescription>
              Add a new bidder to this auction. The bidder will receive login credentials.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateBidder} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Full name"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="teamName">Team Name</Label>
                <Input
                  id="teamName"
                  value={formData.teamName}
                  onChange={(e) => setFormData({ ...formData, teamName: e.target.value })}
                  placeholder="Team name (optional)"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email *</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="email@example.com"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="username">Username *</Label>
                <Input
                  id="username"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  placeholder="Unique username"
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="password">Password *</Label>
                <Input
                  id="password"
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="Min 6 characters"
                  minLength={6}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="purseAmount">Initial Purse Amount (₹) *</Label>
                <Input
                  id="purseAmount"
                  type="number"
                  value={formData.purseAmount}
                  onChange={(e) => setFormData({ ...formData, purseAmount: Number(e.target.value) })}
                  placeholder="₹ 1,00,00,000"
                  required
                />
              </div>
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isCreating}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {isCreating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Bidder'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Success Dialog */}
      <Dialog open={successDialogOpen} onOpenChange={setSuccessDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bidder Created Successfully!</DialogTitle>
            <DialogDescription>
              Please share these credentials with the bidder.
            </DialogDescription>
          </DialogHeader>
          {credentials && (
            <div className="space-y-4">
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md p-4">
                <div className="text-sm font-semibold text-green-800 dark:text-green-200 mb-4">
                  Login Credentials:
                </div>
                <div className="space-y-4">
                  <div className="border-l-4 border-blue-500 pl-3 bg-white dark:bg-gray-800 py-2 rounded-r">
                    <div className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-1">
                      Username
                    </div>
                    <div className="text-base font-mono text-gray-900 dark:text-gray-100 break-all">
                      {credentials.username}
                    </div>
                  </div>
                  <div className="border-l-4 border-blue-500 pl-3 bg-white dark:bg-gray-800 py-2 rounded-r">
                    <div className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-1">
                      Password
                    </div>
                    <div className="text-base font-mono text-gray-900 dark:text-gray-100 break-all">
                      {credentials.password}
                    </div>
                  </div>
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
                setSuccessDialogOpen(false)
                setCredentials(null)
              }}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
