'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, Plus, Edit, Trash2, Calendar, MapPin, Trophy } from 'lucide-react'
import { format } from 'date-fns'

interface Bidder {
  id: string
  teamName: string | null
  username: string
  user: {
    name: string
    email: string
  }
}

interface Fixture {
  id: string
  matchName: string
  team1Id: string
  team2Id: string
  matchDate: string | null
  venue: string | null
  status: string
  result: string | null
  team1: Bidder
  team2: Bidder
  createdAt: string
  updatedAt: string
}

export default function FixturesPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const [fixtures, setFixtures] = useState<Fixture[]>([])
  const [bidders, setBidders] = useState<Bidder[]>([])
  const [loading, setLoading] = useState(true)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingFixture, setEditingFixture] = useState<Fixture | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const [formData, setFormData] = useState({
    matchName: '',
    team1Id: '',
    team2Id: '',
    matchDate: '',
    venue: '',
    status: 'SCHEDULED',
    result: ''
  })

  useEffect(() => {
    fetchFixtures()
    fetchBidders()
  }, [params.id])

  const fetchFixtures = async () => {
    try {
      const response = await fetch(`/api/auctions/${params.id}/fixtures`)
      if (response.ok) {
        const data = await response.json()
        setFixtures(data.fixtures)
      }
    } catch (error) {
      console.error('Error fetching fixtures:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchBidders = async () => {
    try {
      const response = await fetch(`/api/auctions/${params.id}/bidders`)
      if (response.ok) {
        const data = await response.json()
        setBidders(data.bidders)
      }
    } catch (error) {
      console.error('Error fetching bidders:', error)
    }
  }

  const handleOpenDialog = (fixture?: Fixture) => {
    if (fixture) {
      setEditingFixture(fixture)
      setFormData({
        matchName: fixture.matchName,
        team1Id: fixture.team1Id,
        team2Id: fixture.team2Id,
        matchDate: fixture.matchDate ? format(new Date(fixture.matchDate), "yyyy-MM-dd'T'HH:mm") : '',
        venue: fixture.venue || '',
        status: fixture.status,
        result: fixture.result || ''
      })
    } else {
      setEditingFixture(null)
      setFormData({
        matchName: '',
        team1Id: '',
        team2Id: '',
        matchDate: '',
        venue: '',
        status: 'SCHEDULED',
        result: ''
      })
    }
    setIsDialogOpen(true)
  }

  const handleCloseDialog = () => {
    setIsDialogOpen(false)
    setEditingFixture(null)
    setFormData({
      matchName: '',
      team1Id: '',
      team2Id: '',
      matchDate: '',
      venue: '',
      status: 'SCHEDULED',
      result: ''
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    try {
      const url = editingFixture
        ? `/api/auctions/${params.id}/fixtures/${editingFixture.id}`
        : `/api/auctions/${params.id}/fixtures`

      const method = editingFixture ? 'PUT' : 'POST'

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      })

      if (response.ok) {
        await fetchFixtures()
        handleCloseDialog()
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to save fixture')
      }
    } catch (error) {
      console.error('Error saving fixture:', error)
      alert('Failed to save fixture')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (fixtureId: string) => {
    if (!confirm('Are you sure you want to delete this fixture?')) {
      return
    }

    setDeleting(fixtureId)

    try {
      const response = await fetch(`/api/auctions/${params.id}/fixtures/${fixtureId}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        await fetchFixtures()
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to delete fixture')
      }
    } catch (error) {
      console.error('Error deleting fixture:', error)
      alert('Failed to delete fixture')
    } finally {
      setDeleting(null)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'SCHEDULED':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
      case 'COMPLETED':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
      case 'CANCELLED':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200'
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  return (
    <div className="container mx-auto py-6 px-4 sm:px-6 lg:px-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Manage Fixtures</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Create and manage matches between teams
          </p>
        </div>
        <Button onClick={() => handleOpenDialog()} className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Create Fixture
        </Button>
      </div>

      {fixtures.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Trophy className="h-12 w-12 text-gray-400 mb-4" />
            <p className="text-lg font-medium text-gray-600 dark:text-gray-400 mb-2">
              No fixtures yet
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-500 mb-4">
              Create your first fixture to schedule matches between teams
            </p>
            <Button onClick={() => handleOpenDialog()} className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Create Fixture
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {fixtures.map((fixture) => (
            <Card key={fixture.id} className="hover:shadow-lg transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex justify-between items-start">
                  <CardTitle className="text-lg">{fixture.matchName}</CardTitle>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(fixture.status)}`}>
                    {fixture.status}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Teams */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between p-2 bg-blue-50 dark:bg-blue-900/20 rounded">
                    <span className="text-sm font-medium">
                      {fixture.team1.teamName || fixture.team1.user.name}
                    </span>
                  </div>
                  <div className="text-center text-xs font-bold text-gray-500">VS</div>
                  <div className="flex items-center justify-between p-2 bg-red-50 dark:bg-red-900/20 rounded">
                    <span className="text-sm font-medium">
                      {fixture.team2.teamName || fixture.team2.user.name}
                    </span>
                  </div>
                </div>

                {/* Match Details */}
                <div className="space-y-2 pt-2 border-t">
                  {fixture.matchDate && (
                    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                      <Calendar className="h-4 w-4" />
                      <span>{format(new Date(fixture.matchDate), 'PPp')}</span>
                    </div>
                  )}
                  {fixture.venue && (
                    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                      <MapPin className="h-4 w-4" />
                      <span>{fixture.venue}</span>
                    </div>
                  )}
                  {fixture.result && (
                    <div className="flex items-center gap-2 text-sm">
                      <Trophy className="h-4 w-4 text-yellow-500" />
                      <span className="font-medium">{fixture.result}</span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleOpenDialog(fixture)}
                    className="flex-1"
                  >
                    <Edit className="h-3 w-3 mr-1" />
                    Edit
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDelete(fixture.id)}
                    disabled={deleting === fixture.id}
                    className="flex-1"
                  >
                    {deleting === fixture.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <>
                        <Trash2 className="h-3 w-3 mr-1" />
                        Delete
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={handleCloseDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingFixture ? 'Edit Fixture' : 'Create Fixture'}
            </DialogTitle>
            <DialogDescription>
              {editingFixture
                ? 'Update the fixture details'
                : 'Schedule a new match between two teams'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="matchName">Match Name *</Label>
              <Input
                id="matchName"
                value={formData.matchName}
                onChange={(e) => setFormData({ ...formData, matchName: e.target.value })}
                placeholder="e.g., Final Match, Semi-Final 1"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="team1">Team 1 *</Label>
              <Select
                value={formData.team1Id}
                onValueChange={(value) => setFormData({ ...formData, team1Id: value })}
                required
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select team 1" />
                </SelectTrigger>
                <SelectContent>
                  {bidders.map((bidder) => (
                    <SelectItem key={bidder.id} value={bidder.id}>
                      {bidder.teamName || bidder.user.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="team2">Team 2 *</Label>
              <Select
                value={formData.team2Id}
                onValueChange={(value) => setFormData({ ...formData, team2Id: value })}
                required
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select team 2" />
                </SelectTrigger>
                <SelectContent>
                  {bidders.map((bidder) => (
                    <SelectItem
                      key={bidder.id}
                      value={bidder.id}
                      disabled={bidder.id === formData.team1Id}
                    >
                      {bidder.teamName || bidder.user.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="matchDate">Match Date & Time</Label>
              <Input
                id="matchDate"
                type="datetime-local"
                value={formData.matchDate}
                onChange={(e) => setFormData({ ...formData, matchDate: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="venue">Venue</Label>
              <Input
                id="venue"
                value={formData.venue}
                onChange={(e) => setFormData({ ...formData, venue: e.target.value })}
                placeholder="e.g., Stadium Name, Ground Name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select
                value={formData.status}
                onValueChange={(value) => setFormData({ ...formData, status: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SCHEDULED">Scheduled</SelectItem>
                  <SelectItem value="COMPLETED">Completed</SelectItem>
                  <SelectItem value="CANCELLED">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="result">Result</Label>
              <Input
                id="result"
                value={formData.result}
                onChange={(e) => setFormData({ ...formData, result: e.target.value })}
                placeholder="e.g., Team 1 won by 50 runs"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleCloseDialog}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {editingFixture ? 'Update' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

