'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { CheckCircle, AlertCircle, Loader2, Table2, ArrowUp, ArrowDown, Save, Search } from 'lucide-react'

interface BidderPrioritiesUploadProps {
  auctionId: string
  bidders: Array<{
    id: string
    teamName: string | null
    username: string
    user: {
      name: string | null
    } | null
  }>
  players: Array<{
    id: string
    data: any
  }>
}

export function BidderPrioritiesUpload({ auctionId, bidders, players }: BidderPrioritiesUploadProps) {
  const [priorities, setPriorities] = useState<Record<string, Record<string, number>>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  
  // Player order state - allows reordering of players in columns
  const [playerOrder, setPlayerOrder] = useState<string[]>([])
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    fetchPriorities()
  }, [auctionId])

  // Initialize player order from players array (only if not loaded from server)
  useEffect(() => {
    if (players.length > 0 && playerOrder.length === 0) {
      // Get all player names from players array
      const names = players
        .map(p => {
          const data = p.data as any
          return data?.Name || data?.name || 'Unknown'
        })
        .filter((name, index, self) => self.indexOf(name) === index) // Remove duplicates
        .sort()
      setPlayerOrder(names)
    }
  }, [players, playerOrder.length])
  
  // Save player order whenever it changes
  const savePlayerOrder = async (newOrder: string[]) => {
    try {
      await fetch(`/api/analytics/${auctionId}/bidder-priorities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: 'tushkiKILLS',
          bidderPriorities: priorities,
          playerOrder: newOrder
        })
      })
    } catch (error) {
      console.error('Error saving player order:', error)
    }
  }

  const fetchPriorities = async () => {
    try {
      const response = await fetch(`/api/analytics/${auctionId}/bidder-priorities?key=tushkiKILLS`)
      if (response.ok) {
        const data = await response.json()
        setPriorities(data.bidderPriorities || {})
        
        // Load saved player order if available
        if (data.playerOrder && Array.isArray(data.playerOrder) && data.playerOrder.length > 0) {
          setPlayerOrder(data.playerOrder)
        }
      }
    } catch (error) {
      console.error('Error fetching priorities:', error)
    }
  }

  // Get all players with their names
  const allPlayers = players
    .map(p => {
      const data = p.data as any
      const name = data?.Name || data?.name || 'Unknown'
      return {
        id: p.id,
        name: name
      }
    })
    .filter((p, index, self) => 
      self.findIndex(pl => pl.name === p.name) === index // Remove duplicates by name
    )

  // Get ordered players (use playerOrder if set, otherwise use allPlayers sorted)
  const orderedPlayers = playerOrder.length > 0
    ? playerOrder
        .map(name => allPlayers.find(p => p.name === name))
        .filter(Boolean) as typeof allPlayers
    : allPlayers.sort((a, b) => a.name.localeCompare(b.name))

  // Add any players not in the order list
  const finalOrderedPlayers = [
    ...orderedPlayers,
    ...allPlayers.filter(p => !orderedPlayers.find(op => op.name === p.name))
  ]

  // Get bidder names
  const bidderNames = bidders.map(b => 
    b.teamName || b.user?.name || b.username || 'Unknown'
  ).sort()

  // Handle priority change
  const handlePriorityChange = (bidderName: string, playerName: string, value: string) => {
    const numValue = value === '' ? undefined : parseInt(value)
    
    setPriorities(prev => {
      const newPriorities = { ...prev }
      if (!newPriorities[bidderName]) {
        newPriorities[bidderName] = {}
      }
      
      if (numValue && numValue > 0) {
        newPriorities[bidderName][playerName] = numValue
      } else {
        // Remove priority if empty or invalid
        delete newPriorities[bidderName][playerName]
        if (Object.keys(newPriorities[bidderName]).length === 0) {
          delete newPriorities[bidderName]
        }
      }
      
      return newPriorities
    })
  }

  // Move player in order
  const movePlayer = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return
    if (direction === 'down' && index === finalOrderedPlayers.length - 1) return

    // Initialize playerOrder if not set
    const currentOrder = playerOrder.length > 0 
      ? playerOrder 
      : finalOrderedPlayers.map(p => p.name)
    
    const newOrder = [...currentOrder]
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    
    // Swap positions
    ;[newOrder[index], newOrder[targetIndex]] = [newOrder[targetIndex], newOrder[index]]
    setPlayerOrder(newOrder)
    
    // Save player order immediately
    savePlayerOrder(newOrder)
  }

  // Search and move player to front
  const handleSearchAndMove = (e: React.FormEvent) => {
    e.preventDefault()
    if (!searchTerm.trim()) return

    const searchLower = searchTerm.toLowerCase().trim()
    
    // Find matching player (case-insensitive, partial match)
    const matchingPlayer = finalOrderedPlayers.find(p => 
      p.name.toLowerCase().includes(searchLower)
    )

    if (matchingPlayer) {
      // Initialize playerOrder if not set
      const currentOrder = playerOrder.length > 0 
        ? playerOrder 
        : finalOrderedPlayers.map(p => p.name)
      
      // Remove player from current position and move to front
      const newOrder = currentOrder.filter(name => name !== matchingPlayer.name)
      newOrder.unshift(matchingPlayer.name) // Add to front
      
      setPlayerOrder(newOrder)
      setSearchTerm('') // Clear search
      
      // Save player order immediately
      savePlayerOrder(newOrder)
    } else {
      // Player not found - show error or just clear search
      setSearchTerm('')
    }
  }

  const handleSave = async () => {
    setLoading(true)
    setError('')
    setSuccess('')

    try {
      // Get current player order (use state or fallback to finalOrderedPlayers)
      const currentOrder = playerOrder.length > 0 
        ? playerOrder 
        : finalOrderedPlayers.map(p => p.name)

      const response = await fetch(`/api/analytics/${auctionId}/bidder-priorities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: 'tushkiKILLS',
          bidderPriorities: priorities,
          playerOrder: currentOrder
        })
      })

      const data = await response.json()

      if (response.ok) {
        setSuccess('Bidder priorities and player order saved successfully!')
        setTimeout(() => setSuccess(''), 3000)
      } else {
        setError(data.error || 'Failed to save priorities')
      }
    } catch (error) {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }


  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Table2 className="w-5 h-5" />
          Bidder Priority Matrix
        </CardTitle>
        <CardDescription>
          Edit bidder priorities directly in the table. Lower numbers = higher priority (1 = first choice). Use arrows to reorder player columns.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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

        <div className="flex flex-col gap-4 mb-4">
          <div className="flex justify-between items-center">
            <div className="text-sm text-gray-600 dark:text-gray-400">
              {finalOrderedPlayers.length} players × {bidderNames.length} bidders
            </div>
            <Button onClick={handleSave} disabled={loading} className="gap-2">
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save Priorities
                </>
              )}
            </Button>
          </div>
          
          {/* Search player and move to front */}
          <form onSubmit={handleSearchAndMove} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                type="text"
                placeholder="Search player name and press Enter to move to first column..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Button type="submit" variant="outline" size="sm">
              Move to Front
            </Button>
          </form>
        </div>

        <div className="overflow-x-auto border rounded-lg bg-gray-50 dark:bg-gray-900">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr>
                <th className="border p-2 bg-gray-200 dark:bg-gray-800 sticky left-0 z-20 min-w-[150px]">
                  Bidder / Player
                </th>
                {finalOrderedPlayers.map((player, index) => (
                  <th key={player.name} className="border p-2 bg-gray-200 dark:bg-gray-800 min-w-[100px] relative group">
                    <div className="flex items-center justify-between gap-1">
                      <span className="truncate" title={player.name}>
                        {player.name.length > 12 ? player.name.substring(0, 12) + '...' : player.name}
                      </span>
                      <div className="flex flex-col opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => movePlayer(index, 'up')}
                          disabled={index === 0}
                          className="p-0.5 hover:bg-gray-300 dark:hover:bg-gray-700 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                          title="Move left"
                        >
                          <ArrowUp className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => movePlayer(index, 'down')}
                          disabled={index === finalOrderedPlayers.length - 1}
                          className="p-0.5 hover:bg-gray-300 dark:hover:bg-gray-700 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                          title="Move right"
                        >
                          <ArrowDown className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bidderNames.map(bidderName => (
                <tr key={bidderName} className="hover:bg-gray-100 dark:hover:bg-gray-800/50">
                  <td className="border p-2 bg-gray-100 dark:bg-gray-800 sticky left-0 z-10 font-semibold">
                    {bidderName}
                  </td>
                  {finalOrderedPlayers.map(({ name: playerName }) => {
                    const priority = priorities[bidderName]?.[playerName]
                    return (
                      <td key={playerName} className="border p-1 text-center">
                        <Input
                          type="number"
                          min="1"
                          value={priority || ''}
                          onChange={(e) => handlePriorityChange(bidderName, playerName, e.target.value)}
                          className="w-full h-8 text-center text-xs p-1"
                          placeholder="-"
                        />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        <p className="text-xs text-gray-500 mt-2">
          Tip: Click the arrow buttons on column headers to reorder players. Enter priority numbers (1 = highest priority).
        </p>
      </CardContent>
    </Card>
  )
}

