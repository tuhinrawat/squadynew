'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { DataTable, DataTableColumn } from '@/components/data-table'
import { parseExcelFile, ParsedPlayerData, validatePlayerData, cleanPlayerData } from '@/lib/excel-parser'
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, Loader2, Plus } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'

interface Player {
  id: string
  data: Record<string, any>
  status: string
  createdAt: string
}

export default function PlayerManagement() {
  const params = useParams()
  const router = useRouter()
  const auctionId = params.id as string

  const [players, setPlayers] = useState<Player[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [parsedData, setParsedData] = useState<ParsedPlayerData[] | null>(null)
  const [columns, setColumns] = useState<string[]>([])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [addPlayerOpen, setAddPlayerOpen] = useState(false)
  const [newPlayerData, setNewPlayerData] = useState<Record<string, string>>({})
  const [addingPlayer, setAddingPlayer] = useState(false)
  const [auctionRules, setAuctionRules] = useState<any>(null)

  // Fetch players and auction details on component mount
  useEffect(() => {
    fetchAuctionDetails()
    fetchPlayers()
  }, [auctionId])

  const fetchAuctionDetails = async () => {
    try {
      const response = await fetch(`/api/auctions/${auctionId}`)
      const data = await response.json()
      
      if (response.ok && data.auction) {
        // Load saved column order if available
        if (data.auction.columnOrder && Array.isArray(data.auction.columnOrder)) {
          setColumns(data.auction.columnOrder)
        }
        // Store auction rules
        if (data.auction.rules) {
          setAuctionRules(data.auction.rules)
        }
      }
    } catch (error) {
      console.error('Error fetching auction details:', error)
    }
  }

  const fetchPlayers = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/auctions/${auctionId}/players`)
      const data = await response.json()
      
      if (response.ok) {
        setPlayers(data.players)
        
        // Only update columns if we don't have saved order
        if (columns.length === 0) {
          // Extract unique columns from existing players while preserving order
          const allColumns: string[] = []
          const seenColumns = new Set<string>()
          
          data.players.forEach((player: Player) => {
            Object.keys(player.data).forEach(key => {
              if (!seenColumns.has(key)) {
                allColumns.push(key)
                seenColumns.add(key)
              }
            })
          })
          setColumns(allColumns)
        }
      } else {
        setError(data.error || 'Failed to fetch players')
      }
    } catch (error) {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setError('')
    setSuccess('')
    setParsedData(null)

    // Validate file type
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'text/csv' // .csv
    ]

    if (!allowedTypes.includes(file.type)) {
      setError('Please upload a valid Excel (.xlsx, .xls) or CSV file')
      return
    }

    try {
      const result = await parseExcelFile(file)
      
      if (!result.success) {
        setError(result.error || 'Failed to parse file')
        return
      }

      // Validate the parsed data
      const validation = validatePlayerData(result.data!)
      if (!validation.valid) {
        setError(validation.errors.join(', '))
        return
      }

      setParsedData(result.data!)
      setColumns(result.columns!)
      setSuccess(`File parsed successfully! Found ${result.data!.length} players.`)
    } catch (error) {
      setError('Failed to parse file. Please check the format.')
    }
  }

  const handleConfirmUpload = async () => {
    if (!parsedData) return

    setUploading(true)
    setError('')

    try {
      // Clean the data before uploading
      const cleanedData = parsedData.map(cleanPlayerData)

      const response = await fetch(`/api/auctions/${auctionId}/players/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ players: cleanedData, columnOrder: columns }),
      })

      const data = await response.json()

      if (response.ok) {
        let message = `Successfully uploaded ${data.count} players!`
        if (data.duplicateCount > 0) {
          message += ` (${data.duplicateCount} duplicates skipped)`
        }
        setSuccess(message)
        setParsedData(null)
        // Don't clear columns - keep the Excel column order
        // setColumns([]) - REMOVED
        // Refresh the players list
        await fetchPlayers()
      } else {
        setError(data.error || 'Failed to upload players')
      }
    } catch (error) {
      setError('Network error. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  const handleClearAllPlayers = async () => {
    if (!confirm('Are you sure you want to clear ALL players? This action cannot be undone.')) return

    try {
      const response = await fetch(`/api/auctions/${auctionId}/players/clear`, {
        method: 'DELETE',
      })

      const result = await response.json()

      if (response.ok) {
        setSuccess(`Successfully cleared ${result.count} players!`)
        fetchPlayers() // Refresh the player list
      } else {
        setError(result.error || 'Failed to clear players.')
      }
    } catch (error) {
      setError('Network error. Please try again.')
    }
  }

  const handleAddPlayer = async () => {
    if (!columns.length) {
      setError('Please upload Excel file first to define columns')
      return
    }

    setAddingPlayer(true)
    setError('')

    try {
      const response = await fetch(`/api/auctions/${auctionId}/players`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: newPlayerData }),
      })

      const result = await response.json()

      if (response.ok) {
        setSuccess('Player added successfully!')
        setAddPlayerOpen(false)
        setNewPlayerData({})
        fetchPlayers()
      } else {
        setError(result.error || 'Failed to add player')
      }
    } catch (error) {
      setError('Network error. Please try again.')
    } finally {
      setAddingPlayer(false)
    }
  }


  const handleColumnReorder = (reorderedColumns: DataTableColumn[]) => {
    // Update the column order in state
    const newColumnOrder = reorderedColumns.map(col => col.key)
    setColumns(newColumnOrder)
  }

  const handleEditPlayer = async (player: any) => {
    console.log('Edit button clicked for player:', player)
    // For now, just show an alert with player data
    // TODO: Implement proper edit modal
    const playerData = Object.entries(player.data)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n')
    
    const newData = prompt(`Edit player data:\n\n${playerData}\n\nEnter new data (JSON format):`, JSON.stringify(player.data, null, 2))
    
    if (newData) {
      try {
        const parsedData = JSON.parse(newData)
        
        const response = await fetch(`/api/auctions/${auctionId}/players/${player.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: parsedData }),
        })

        const result = await response.json()

        if (response.ok) {
          setSuccess('Player updated successfully!')
          await fetchPlayers()
        } else {
          setError(result.error || 'Failed to update player')
        }
      } catch (error) {
        setError('Invalid JSON format or network error')
      }
    }
  }

  const handleDeletePlayer = async (player: any) => {
    console.log('Delete button clicked for player:', player)
    if (!confirm('Are you sure you want to delete this player?')) return

    try {
      const response = await fetch(`/api/auctions/${auctionId}/players/${player.id}`, {
        method: 'DELETE',
      })

      const data = await response.json()

      if (response.ok) {
        setSuccess('Player deleted successfully!')
        await fetchPlayers()
      } else {
        setError(data.error || 'Failed to delete player')
      }
    } catch (error) {
      setError('Network error. Please try again.')
    }
  }

  const handleRetirePlayer = async (player: any) => {
    const newStatus = player.status === 'RETIRED' ? 'AVAILABLE' : 'RETIRED'
    const action = newStatus === 'AVAILABLE' ? 'unretire' : 'retire'
    
    if (!confirm(`Are you sure you want to ${action} this player?`)) return

    try {
      const response = await fetch(`/api/auctions/${auctionId}/players/${player.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })

      const data = await response.json()

      if (response.ok) {
        setSuccess(`Player ${action}d successfully!`)
        await fetchPlayers()
      } else {
        setError(data.error || `Failed to ${action} player`)
      }
    } catch (error) {
      setError('Network error. Please try again.')
    }
  }

  const handleToggleIconPlayer = async (player: any) => {
    const isIcon = !(player as any).isIcon
    const action = isIcon ? 'mark as icon player' : 'remove icon player status'
    
    if (!confirm(`Are you sure you want to ${action}?`)) return

    try {
      const response = await fetch(`/api/auctions/${auctionId}/players/${player.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isIcon }),
      })

      const data = await response.json()

      if (response.ok) {
        setSuccess(`Player ${action} successfully!`)
        await fetchPlayers()
      } else {
        // Show error message from the API
        setError(data.error || `Failed to ${action} player`)
        // Clear error after 5 seconds
        setTimeout(() => setError(''), 5000)
      }
    } catch (error) {
      setError('Network error. Please try again.')
      setTimeout(() => setError(''), 5000)
    }
  }

  // Convert players to DataTable format and sort by isIcon (icon players first)
  const tableData = players.map(player => ({
    ...player.data,
    id: player.id,
    status: player.status,
    isIcon: (player as any).isIcon || false,
    createdAt: new Date(player.createdAt).toLocaleDateString()
  })).sort((a, b) => {
    // Sort by isIcon (true first), then by createdAt
    if (a.isIcon !== b.isIcon) {
      return b.isIcon ? 1 : -1
    }
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  })

  // Create DataTable columns
  const tableColumns: DataTableColumn[] = [
    ...columns.map(col => ({
      key: col,
      label: col,
      sortable: true,
      filterable: true,
      type: typeof (tableData[0] as any)?.[col] === 'number' ? 'number' as const : 'string' as const
    })),
    {
      key: 'isIcon',
      label: 'Icon Player',
      sortable: true,
      filterable: true
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      filterable: true
    },
    {
      key: 'createdAt',
      label: 'Added',
      sortable: true
    }
  ]

  return (
    <div className="space-y-6 w-full max-w-full overflow-hidden">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Player Management</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-2">
            Upload and manage players for this auction
          </p>
        </div>
        <Button variant="outline" onClick={() => router.back()} className="bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700">
          Back to Auctions
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

      {/* Upload Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <FileSpreadsheet className="h-5 w-5 mr-2" />
            Upload Players from Excel/CSV
          </CardTitle>
          <CardDescription>
            Upload player data from Excel (.xlsx, .xls) or CSV files
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center space-x-4">
            <Input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileUpload}
              className="flex-1"
            />
            <Button
              onClick={handleConfirmUpload}
              disabled={!parsedData || uploading}
              className="bg-blue-600 hover:bg-blue-700 text-white dark:bg-blue-600 dark:hover:bg-blue-700 disabled:opacity-50"
            >
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Confirm Upload
                </>
              )}
            </Button>
          </div>

          {/* Preview Table */}
          {parsedData && (
            <div className="mt-6">
              <h3 className="text-lg font-semibold mb-4">Preview (First 5 rows, First 6 columns)</h3>
              <div className="overflow-x-auto max-w-full">
                <table className="w-full border-collapse border border-gray-300 dark:border-gray-600 min-w-max">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-800">
                      {columns.slice(0, 6).map(col => (
                        <th key={col} className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-left min-w-[120px]">
                          {col}
                        </th>
                      ))}
                      {columns.length > 6 && (
                        <th className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-left bg-blue-50 dark:bg-blue-900/20">
                          +{columns.length - 6} more columns
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedData.slice(0, 5).map((row, index) => (
                      <tr key={index}>
                        {columns.slice(0, 6).map(col => (
                          <td key={col} className="border border-gray-300 dark:border-gray-600 px-3 py-2 min-w-[120px]">
                            {row[col]?.toString() || '-'}
                          </td>
                        ))}
                        {columns.length > 6 && (
                          <td className="border border-gray-300 dark:border-gray-600 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 text-gray-500 dark:text-gray-400">
                            ...
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {columns.length > 6 && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                  Showing first 6 columns. All {columns.length} columns will be available in the main table.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Players Table */}
      <div className="space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin" />
            <span className="ml-2">Loading players...</span>
          </div>
        ) : (
          <>
            <div className="flex justify-end space-x-2 mb-2">
              {columns.length > 0 && (
                <Dialog open={addPlayerOpen} onOpenChange={setAddPlayerOpen}>
                  <DialogTrigger asChild>
                    <div>
                      <Button
                        variant="default"
                        size="sm"
                        className="bg-blue-600 hover:bg-blue-700 text-white dark:bg-blue-600 dark:hover:bg-blue-700"
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Add Player
                      </Button>
                    </div>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>Add New Player</DialogTitle>
                      <DialogDescription>
                        Fill in the player details using the columns from your Excel file
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      {columns.map((col) => (
                        <div key={col} className="space-y-2">
                          <Label htmlFor={`new-player-${col}`}>{col}</Label>
                          <Input
                            id={`new-player-${col}`}
                            value={newPlayerData[col] || ''}
                            onChange={(e) => setNewPlayerData(prev => ({ ...prev, [col]: e.target.value }))}
                            placeholder={`Enter ${col}`}
                          />
                        </div>
                      ))}
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setAddPlayerOpen(false)} className="text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800">
                        Cancel
                      </Button>
                      <Button 
                        onClick={handleAddPlayer} 
                        disabled={addingPlayer}
                        className="bg-blue-600 hover:bg-blue-700 text-white"
                      >
                        {addingPlayer ? 'Adding...' : 'Add Player'}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
              {players.length > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleClearAllPlayers}
                  className="bg-red-600 hover:bg-red-700 text-white dark:bg-red-600 dark:hover:bg-red-700"
                >
                  Clear All Players
                </Button>
              )}
            </div>

            <div className="overflow-x-auto max-w-full">
              <DataTable
                data={tableData}
                columns={tableColumns}
                onEdit={handleEditPlayer}
                onDelete={handleDeletePlayer}
                onRetire={handleRetirePlayer}
                onIconPlayerToggle={handleToggleIconPlayer}
                onColumnReorder={handleColumnReorder}
                searchPlaceholder="Search players..."
                emptyMessage="No players found. Upload a file or add players manually."
                title={
                  <div className="flex items-center gap-2">
                    <span>Players ({players.length})</span>
                    <Badge variant="default" className="bg-purple-600 text-white">
                      ⭐ {players.filter((p: any) => p.isIcon).length} / {auctionRules?.iconPlayerCount || 10} Icon Players
                    </Badge>
                  </div>
                }
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
