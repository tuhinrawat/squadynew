'use client'

import { useState, useEffect, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { DataTable, DataTableColumn } from '@/components/data-table'
import { parseExcelFile, ParsedPlayerData, validatePlayerData, cleanPlayerData } from '@/lib/excel-parser'
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, Loader2, Plus, BarChart3 } from 'lucide-react'
import { logger } from '@/lib/logger'
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
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<Set<string>>(new Set())
  const [batchProcessing, setBatchProcessing] = useState(false)
  const [visibleColumns, setVisibleColumns] = useState<string[]>([])
  const [auctionStatus, setAuctionStatus] = useState<string>('DRAFT')
  const [isPublished, setIsPublished] = useState<boolean>(false)
  const [editingPlayer, setEditingPlayer] = useState<Player | null>(null)
  const [editPlayerData, setEditPlayerData] = useState<Record<string, string>>({})
  const [savingPlayer, setSavingPlayer] = useState(false)

  // Import Player Stats dialog - a separate sheet (name, Cricheroes profile,
  // Batting_*/Bowling_* columns) merged into EXISTING players, as opposed to
  // the upload section above which creates new players.
  const [statsDialogOpen, setStatsDialogOpen] = useState(false)
  const [statsUploadedData, setStatsUploadedData] = useState<ParsedPlayerData[] | null>(null)
  const [statsUploadColumns, setStatsUploadColumns] = useState<string[]>([])
  const [statsUploadError, setStatsUploadError] = useState('')
  const [statsUploading, setStatsUploading] = useState(false)
  const [statsUploadResults, setStatsUploadResults] = useState<{
    matched: number
    unmatched: number
    matchedDetails: Array<{ playerName: string; uploadedName: string; columnsUpdated: string[]; matchMethod: string }>
    unmatchedDetails: Array<{ uploadedName: string; reason: string }>
    newColumns: string[]
  } | null>(null)

  // Check if editing is allowed - only block during LIVE and MOCK_RUN
  const isEditingAllowed = auctionStatus !== 'LIVE' && auctionStatus !== 'MOCK_RUN'

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
        // Store auction status and published state
        setAuctionStatus(data.auction.status)
        setIsPublished(data.auction.isPublished || false)
        
        // Load saved column order if available
        if (data.auction.columnOrder && Array.isArray(data.auction.columnOrder)) {
          setColumns(data.auction.columnOrder)
        }
        // Load saved visible columns if available
        if (data.auction.visibleColumns && Array.isArray(data.auction.visibleColumns)) {
          setVisibleColumns(data.auction.visibleColumns)
        }
        // Store auction rules
        if (data.auction.rules) {
          setAuctionRules(data.auction.rules)
        }
      }
    } catch (error) {
      logger.error('Error fetching auction details:', error)
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

  const handleStatsFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setStatsUploadError('')
    setStatsUploadedData(null)
    setStatsUploadResults(null)

    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
    ]
    if (!allowedTypes.includes(file.type) && !file.name.match(/\.(xlsx|xls|csv)$/i)) {
      setStatsUploadError('Please upload a valid Excel (.xlsx, .xls) or CSV file')
      return
    }

    try {
      const result = await parseExcelFile(file)
      if (!result.success || !result.data || result.data.length === 0) {
        setStatsUploadError(result.error || 'No player data found in the file')
        return
      }

      setStatsUploadedData(result.data)
      setStatsUploadColumns(result.columns || [])
      setStatsDialogOpen(true)
    } catch {
      setStatsUploadError('Failed to parse file. Please check the format.')
    } finally {
      // Allow re-selecting the same file later
      event.target.value = ''
    }
  }

  const handleConfirmStatsUpload = async () => {
    if (!statsUploadedData || statsUploadedData.length === 0) return

    setStatsUploading(true)
    setStatsUploadError('')

    try {
      const response = await fetch(`/api/auctions/${auctionId}/players/upload-stats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ players: statsUploadedData }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to import player stats')
      }

      setStatsUploadResults(data.results)
      await fetchPlayers()
    } catch (error) {
      setStatsUploadError(error instanceof Error ? error.message : 'Network error. Please try again.')
    } finally {
      setStatsUploading(false)
    }
  }

  const closeStatsDialog = () => {
    setStatsDialogOpen(false)
    setStatsUploadedData(null)
    setStatsUploadColumns([])
    setStatsUploadError('')
    setStatsUploadResults(null)
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

  const handleVisibleColumnsChange = async (newVisibleColumns: string[]) => {
    setVisibleColumns(newVisibleColumns)
    // Save to backend
    try {
      await fetch(`/api/auctions/${auctionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibleColumns: newVisibleColumns })
      })
    } catch (error) {
      logger.error('Error saving visible columns:', error)
    }
  }

  const handleEditPlayer = async (player: any) => {
    // Check if auction is in editable state
    if (!isEditingAllowed) {
      if (auctionStatus === 'LIVE') {
        setError('Cannot edit players while auction is LIVE')
      } else if (auctionStatus === 'MOCK_RUN') {
        setError('Cannot edit players while in MOCK_RUN mode. Reset the auction to enable editing.')
      }
      return
    }
    
    // Find the full player data
    const fullPlayer = players.find(p => p.id === player.id)
    if (!fullPlayer) return
    
    // Set the editing player and populate the form
    setEditingPlayer(fullPlayer)
    
    // Convert player data to editable format (all as strings)
    const editData: Record<string, string> = {}
    Object.entries(fullPlayer.data).forEach(([key, value]) => {
      editData[key] = value != null ? String(value) : ''
    })
    setEditPlayerData(editData)
  }
  
  const handleSavePlayerEdit = async () => {
    if (!editingPlayer) return
    
    try {
      setSavingPlayer(true)
      setError('')
      
      // Convert string values back to appropriate types
      const updatedData: Record<string, any> = {}
      Object.entries(editPlayerData).forEach(([key, value]) => {
        // Try to preserve original type
        const originalValue = editingPlayer.data[key]
        if (typeof originalValue === 'number' && !isNaN(Number(value))) {
          updatedData[key] = Number(value)
        } else {
          updatedData[key] = value
        }
      })
      
      const response = await fetch(`/api/auctions/${auctionId}/players/${editingPlayer.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: updatedData }),
      })

      const result = await response.json()

      if (response.ok) {
        setSuccess('Player updated successfully!')
        await fetchPlayers()
        setEditingPlayer(null)
        setEditPlayerData({})
      } else {
        setError(result.error || 'Failed to update player')
      }
    } catch (error) {
      setError('Failed to save player data')
      logger.error('Error saving player:', error)
    } finally {
      setSavingPlayer(false)
    }
  }

  const handleDeletePlayer = async (player: any) => {
    logger.log('Delete player clicked')
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

  const handleToggleBidderChoice = async (player: any) => {
    const isIcon = !(player as any).isIcon
    const action = isIcon ? 'mark as Bidder Choice' : 'remove Bidder Choice status'
    
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

  const handleBatchMarkBidderChoice = async (markAsBidderChoice: boolean) => {
    if (selectedPlayerIds.size === 0) {
      setError('Please select at least one player')
      return
    }

    const action = markAsBidderChoice ? 'mark as Bidder Choice' : 'remove Bidder Choice status from'
    if (!confirm(`Are you sure you want to ${action} ${selectedPlayerIds.size} player(s)?`)) return

    setBatchProcessing(true)
    setError('')
    setSuccess('')

    try {
      const response = await fetch(`/api/auctions/${auctionId}/players/batch-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerIds: Array.from(selectedPlayerIds),
          updates: { isIcon: markAsBidderChoice }
        }),
      })

      const data = await response.json()

      if (response.ok) {
        setSuccess(data.message || `Successfully updated ${selectedPlayerIds.size} player(s)!`)
        setSelectedPlayerIds(new Set()) // Clear selection
        await fetchPlayers()
      } else {
        setError(data.error || `Failed to update players`)
      }
    } catch (error) {
      setError('Network error. Please try again.')
    } finally {
      setBatchProcessing(false)
      // Clear messages after 5 seconds
      setTimeout(() => {
        setError('')
        setSuccess('')
      }, 5000)
    }
  }

  const handleBatchRetire = async (retire: boolean) => {
    if (selectedPlayerIds.size === 0) {
      setError('Please select at least one player')
      return
    }

    const action = retire ? 'retire' : 'unretire'
    if (!confirm(`Are you sure you want to ${action} ${selectedPlayerIds.size} player(s)?`)) return

    setBatchProcessing(true)
    setError('')
    setSuccess('')

    try {
      const response = await fetch(`/api/auctions/${auctionId}/players/batch-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerIds: Array.from(selectedPlayerIds),
          updates: { status: retire ? 'RETIRED' : 'AVAILABLE' }
        }),
      })

      const data = await response.json()

      if (response.ok) {
        setSuccess(data.message || `Successfully ${action}d ${selectedPlayerIds.size} player(s)!`)
        setSelectedPlayerIds(new Set()) // Clear selection
        await fetchPlayers()
      } else {
        setError(data.error || `Failed to ${action} players`)
      }
    } catch (error) {
      setError('Network error. Please try again.')
    } finally {
      setBatchProcessing(false)
      // Clear messages after 5 seconds
      setTimeout(() => {
        setError('')
        setSuccess('')
      }, 5000)
    }
  }

  // Convert players to DataTable format and sort by isIcon (Bidder Choice first).
  // Memoized - this previously re-mapped and re-sorted the entire player
  // list, and rebuilt every column definition, on every render (including
  // ones triggered by unrelated state like a form field), which also
  // defeated DataTable's own internal memoization since it received a new
  // array/object identity each time regardless of whether the data changed.
  const tableData = useMemo(() => players.map(player => ({
    ...player.data,
    id: player.id,
    status: player.status,
    isIcon: (player as any).isIcon || false,
    createdAt: new Date(player.createdAt).toLocaleDateString()
  })).sort((a, b) => {
    // Sort by isIcon (Bidder Choice first), then by createdAt
    if (a.isIcon !== b.isIcon) {
      return b.isIcon ? 1 : -1
    }
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  }), [players])

  // Create DataTable columns
  const tableColumns: DataTableColumn[] = useMemo(() => [
    ...columns.map(col => ({
      key: col,
      label: col,
      sortable: true,
      filterable: true,
      type: typeof (tableData[0] as any)?.[col] === 'number' ? 'number' as const : 'string' as const
    })),
    {
      key: 'isIcon',
      label: 'Bidder Choice',
      sortable: true,
      filterable: true,
      render: (value: boolean) => (
        value ? (
          <Badge className="bg-purple-600 text-white font-semibold">
            ⭐ Bidder Choice
          </Badge>
        ) : (
          <span className="text-gray-400 text-sm">-</span>
        )
      )
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      filterable: true,
      render: (value: string) => {
        if (value === 'RETIRED') {
          return (
            <Badge className="bg-orange-600 text-white font-semibold">
              🏁 Retired
            </Badge>
          )
        } else if (value === 'SOLD') {
          return (
            <Badge className="bg-green-600 text-white font-semibold">
              ✓ Sold
            </Badge>
          )
        } else if (value === 'UNSOLD') {
          return (
            <Badge className="bg-gray-600 text-white font-semibold">
              ✗ Unsold
            </Badge>
          )
        } else {
          return (
            <Badge className="bg-blue-600 text-white font-semibold">
              Available
            </Badge>
          )
        }
      }
    },
    {
      key: 'createdAt',
      label: 'Added',
      sortable: true
    }
  ], [columns, tableData])

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

      {/* Warning for Live/Mock Run Status */}
      {!isEditingAllowed && (
        <Alert className="bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800">
          <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
          <AlertDescription className="text-yellow-800 dark:text-yellow-200">
            <strong>Editing Disabled:</strong> Player data cannot be edited 
            {auctionStatus === 'LIVE' && ' while the auction is LIVE'}
            {auctionStatus === 'MOCK_RUN' && ' while in MOCK_RUN mode'}
            .
            {auctionStatus === 'MOCK_RUN' && ' Reset the auction to enable editing.'}
          </AlertDescription>
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

      {/* Import Player Stats - enriches EXISTING players with career stats
          from a separate sheet, unlike the upload above which creates new
          players. Kept as its own card/action since the two operations do
          very different things and conflating them would be confusing. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <BarChart3 className="h-5 w-5 mr-2" />
            Import Player Stats
          </CardTitle>
          <CardDescription>
            Import a separate sheet (player name, Cricheroes profile, batting/bowling stats) and match it
            against the players already in this auction. Matches by Cricheroes profile link first, falling
            back to name (and contact number, if present) when a row has no link or no link match.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center space-x-4">
            <Input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleStatsFileUpload}
              className="flex-1"
            />
          </div>
          {statsUploadError && !statsDialogOpen && (
            <p className="text-sm text-red-600 dark:text-red-400 mt-2">{statsUploadError}</p>
          )}
        </CardContent>
      </Card>

      {/* Import Player Stats - preview/confirm dialog */}
      <Dialog open={statsDialogOpen} onOpenChange={(open) => { if (!open) closeStatsDialog() }}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import Player Stats</DialogTitle>
            <DialogDescription>
              Review the uploaded data before confirming. Nothing is saved until you confirm.
            </DialogDescription>
          </DialogHeader>

          {statsUploadError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{statsUploadError}</AlertDescription>
            </Alert>
          )}

          {statsUploadResults ? (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{statsUploadResults.matched}</div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">Matched</div>
                </div>
                <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                  <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{statsUploadResults.unmatched}</div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">Unmatched</div>
                </div>
                <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                  <div className="text-2xl font-bold text-green-600 dark:text-green-400">{statsUploadResults.newColumns.length}</div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">Columns Added</div>
                </div>
              </div>

              {statsUploadResults.matchedDetails.length > 0 && (
                <div>
                  <h4 className="font-semibold mb-2">Matched Players:</h4>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {statsUploadResults.matchedDetails.map((item, idx) => (
                      <div key={idx} className="text-sm text-gray-600 dark:text-gray-400">
                        &bull; {item.uploadedName} &rarr; {item.playerName}
                        <span className="text-xs text-gray-500 dark:text-gray-500 ml-2">
                          ({item.columnsUpdated.length} columns, matched via: {item.matchMethod})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {statsUploadResults.unmatchedDetails.length > 0 && (
                <div>
                  <h4 className="font-semibold mb-2">Unmatched Rows:</h4>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {statsUploadResults.unmatchedDetails.map((item, idx) => (
                      <div key={idx} className="text-sm text-gray-600 dark:text-gray-400">
                        &bull; {item.uploadedName} - {item.reason}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : statsUploadedData && (
            <div className="space-y-4">
              <div className="text-sm text-gray-600 dark:text-gray-400">
                Found <strong>{statsUploadedData.length}</strong> rows in the file. Matching by Cricheroes profile
                link first, then by name{statsUploadColumns.some(c => /contact|phone|mobile/i.test(c)) ? ' and contact number' : ''}.
              </div>

              <div className="max-h-60 overflow-y-auto border rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0">
                    <tr>
                      {statsUploadColumns.slice(0, 5).map(col => (
                        <th key={col} className="px-3 py-2 text-left font-semibold">{col}</th>
                      ))}
                      {statsUploadColumns.length > 5 && (
                        <th className="px-3 py-2 text-left font-semibold">... (+{statsUploadColumns.length - 5} more)</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {statsUploadedData.slice(0, 10).map((row, idx) => (
                      <tr key={idx} className="border-b border-gray-200 dark:border-gray-700">
                        {statsUploadColumns.slice(0, 5).map(col => (
                          <td key={col} className="px-3 py-2">{String(row[col] ?? '-')}</td>
                        ))}
                        {statsUploadColumns.length > 5 && <td className="px-3 py-2">...</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {statsUploadedData.length > 10 && (
                  <div className="p-2 text-xs text-gray-500 text-center">
                    Showing first 10 of {statsUploadedData.length} rows
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeStatsDialog} disabled={statsUploading}>
              {statsUploadResults ? 'Close' : 'Cancel'}
            </Button>
            {!statsUploadResults && (
              <Button onClick={handleConfirmStatsUpload} disabled={statsUploading || !statsUploadedData}>
                {statsUploading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Confirm Import
                  </>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

            {/* Edit Player Dialog */}
            <Dialog open={!!editingPlayer} onOpenChange={(open) => !open && setEditingPlayer(null)}>
              <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Edit Player Data</DialogTitle>
                  <DialogDescription>
                    Update player information. All fields from your Excel file are shown below.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  {editingPlayer && Object.keys(editingPlayer.data).map((col) => (
                    <div key={col} className="space-y-2">
                      <Label htmlFor={`edit-player-${col}`} className="font-semibold">{col}</Label>
                      <Input
                        id={`edit-player-${col}`}
                        value={editPlayerData[col] || ''}
                        onChange={(e) => setEditPlayerData(prev => ({ ...prev, [col]: e.target.value }))}
                        placeholder={`Enter ${col}`}
                        className="bg-white dark:bg-gray-800"
                      />
                    </div>
                  ))}
                </div>
                <DialogFooter>
                  <Button 
                    variant="outline" 
                    onClick={() => {
                      setEditingPlayer(null)
                      setEditPlayerData({})
                    }}
                    disabled={savingPlayer}
                    className="text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800"
                  >
                    Cancel
                  </Button>
                  <Button 
                    onClick={handleSavePlayerEdit} 
                    disabled={savingPlayer}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    {savingPlayer ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      'Save Changes'
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Batch Action Buttons */}
            {selectedPlayerIds.size > 0 && (
              <Card className="bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800">
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                        {selectedPlayerIds.size} player(s) selected
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedPlayerIds(new Set())}
                        className="text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                      >
                        Clear selection
                      </Button>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <Button
                        onClick={() => handleBatchMarkBidderChoice(true)}
                        disabled={batchProcessing}
                        className="bg-purple-600 hover:bg-purple-700 text-white"
                      >
                        {batchProcessing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        ⭐ Mark as Bidder Choice
                      </Button>
                      <Button
                        onClick={() => handleBatchMarkBidderChoice(false)}
                        disabled={batchProcessing}
                        variant="outline"
                        className="border-purple-600 text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20"
                      >
                        {batchProcessing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        Remove Bidder Choice
                      </Button>
                      <Button
                        onClick={() => handleBatchRetire(true)}
                        disabled={batchProcessing}
                        className="bg-orange-600 hover:bg-orange-700 text-white"
                      >
                        {batchProcessing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        Mark as Retired
                      </Button>
                      <Button
                        onClick={() => handleBatchRetire(false)}
                        disabled={batchProcessing}
                        variant="outline"
                        className="border-green-600 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20"
                      >
                        {batchProcessing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        Mark as Available
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="overflow-x-auto max-w-full">
              <DataTable
                data={tableData}
                columns={tableColumns}
                onEdit={isEditingAllowed ? handleEditPlayer : undefined}
                onDelete={handleDeletePlayer}
                onColumnReorder={handleColumnReorder}
                searchPlaceholder="Search players..."
                emptyMessage="No players found. Upload a file or add players manually."
                enableSelection={true}
                selectedItems={selectedPlayerIds}
                onSelectionChange={setSelectedPlayerIds}
                visibleColumnsInitial={visibleColumns}
                onVisibleColumnsChange={handleVisibleColumnsChange}
                title={
                  <div className="flex items-center gap-2">
                    <span>Players ({players.length})</span>
                    <Badge variant="default" className="bg-purple-600 text-white">
                      ⭐ {players.filter((p: any) => p.isIcon).length} / {auctionRules?.iconPlayerCount ?? 10} Bidder Choice
                    </Badge>
                    {!isEditingAllowed && (
                      <Badge variant="outline" className="bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200 border-yellow-300 dark:border-yellow-700">
                        🔒 Editing Locked
                      </Badge>
                    )}
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
