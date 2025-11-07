'use client'

import { useState, useMemo, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Player } from '@prisma/client'
import { Checkbox } from '@/components/ui/checkbox'
import { Upload, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import { parseExcelFile, ParsedPlayerData } from '@/lib/excel-parser'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface PlayerTableProps {
  players: Player[]
  auctionId: string
  bidders: Array<{
    id: string
    teamName: string | null
    username: string
    user: {
      name: string | null
    } | null
  }>
  analyticsVisibleColumns?: string[] // Loaded from auction
  onPlayersUpdate?: (players: Player[]) => void // Callback when players are updated
}

export function PlayerTable({ players, auctionId, bidders, analyticsVisibleColumns, onPlayersUpdate }: PlayerTableProps) {
  const [searchTerm, setSearchTerm] = useState('')
  
  // Default visible columns for analytics table
  const defaultColumns = ['name', 'status', 'speciality', 'batting', 'bowling', 'soldPrice', 'soldTo']
  
  // Initialize from saved analytics columns or use defaults
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => {
    if (analyticsVisibleColumns && Array.isArray(analyticsVisibleColumns) && analyticsVisibleColumns.length > 0) {
      return new Set(analyticsVisibleColumns)
    }
    return new Set(defaultColumns)
  })
  
  const [showAddColumn, setShowAddColumn] = useState(false)
  const [newColumnName, setNewColumnName] = useState('')
  
  // Upload stats state
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false)
  const [uploadedData, setUploadedData] = useState<ParsedPlayerData[] | null>(null)
  const [uploadColumns, setUploadColumns] = useState<string[]>([])
  const [uploadError, setUploadError] = useState<string>('')
  const [uploadSuccess, setUploadSuccess] = useState<string>('')
  const [isUploading, setIsUploading] = useState(false)
  const [uploadResults, setUploadResults] = useState<any>(null)
  
  // Load saved columns on mount if provided
  useEffect(() => {
    if (analyticsVisibleColumns && Array.isArray(analyticsVisibleColumns) && analyticsVisibleColumns.length > 0) {
      console.log('Loading saved analytics columns:', analyticsVisibleColumns)
      setVisibleColumns(new Set(analyticsVisibleColumns))
    } else {
      console.log('No saved analytics columns found, using defaults')
    }
  }, [analyticsVisibleColumns])

  // Get all unique column names from player data
  const allColumns = useMemo(() => {
    const columns = new Set<string>(['name', 'status', 'speciality', 'batting', 'bowling', 'soldPrice', 'soldTo'])
    
    players.forEach(player => {
      const data = player.data as any
      if (data && typeof data === 'object') {
        Object.keys(data).forEach(key => {
          if (key && typeof key === 'string') {
            columns.add(key)
          }
        })
      }
    })
    
    return Array.from(columns).sort()
  }, [players])

  // Filter players based on search
  const filteredPlayers = useMemo(() => {
    if (!searchTerm) return players
    
    const search = searchTerm.toLowerCase()
    return players.filter(player => {
      const data = player.data as any
      const name = (data?.Name || data?.name || '').toLowerCase()
      const speciality = (data?.Speciality || '').toLowerCase()
      const status = player.status.toLowerCase()
      
      return name.includes(search) || speciality.includes(search) || status.includes(search)
    })
  }, [players, searchTerm])

  const getPlayerValue = (player: Player, column: string): string | number | null => {
    const data = player.data as any
    
    switch (column) {
      case 'name':
        return data?.Name || data?.name || 'Unknown'
      case 'status':
        return player.status
      case 'speciality':
        return data?.Speciality || 'N/A'
      case 'batting':
        return data?.['Batting Type'] || data?.batting || 'N/A'
      case 'bowling':
        return data?.['Bowling Type'] || data?.bowling || 'N/A'
      case 'soldPrice':
        return player.soldPrice ? `₹${player.soldPrice.toLocaleString('en-IN')}` : '-'
      case 'soldTo':
        if (!player.soldTo) return '-'
        const bidder = bidders.find(b => b.id === player.soldTo)
        return bidder ? (bidder.teamName || bidder.user?.name || bidder.username) : player.soldTo
      default:
        return data?.[column] || '-'
    }
  }

  const toggleColumn = (column: string) => {
    setVisibleColumns(prev => {
      const newSet = new Set(prev)
      if (newSet.has(column)) {
        newSet.delete(column)
      } else {
        newSet.add(column)
      }
      // Save to backend
      saveAnalyticsColumns(Array.from(newSet))
      return newSet
    })
  }
  
  const saveAnalyticsColumns = async (columns: string[]) => {
    try {
      const response = await fetch(`/api/analytics/${auctionId}/columns`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analyticsVisibleColumns: columns })
      })
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to save columns' }))
        console.error('Error saving analytics columns:', errorData)
        throw new Error(errorData.error || 'Failed to save columns')
      } else {
        console.log('Analytics columns saved successfully:', columns)
      }
    } catch (error) {
      console.error('Error saving analytics columns:', error)
      // Show user-friendly error message
      alert('Failed to save column preferences. Please try again.')
    }
  }

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setUploadError('')
    setUploadSuccess('')
    setUploadedData(null)
    setUploadResults(null)

    // Validate file type
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'text/csv' // .csv
    ]

    if (!allowedTypes.includes(file.type) && !file.name.match(/\.(xlsx|xls|csv)$/i)) {
      setUploadError('Please upload a valid Excel (.xlsx, .xls) or CSV file')
      return
    }

    try {
      const result = await parseExcelFile(file)
      
      if (!result.success) {
        setUploadError(result.error || 'Failed to parse file')
        return
      }

      if (!result.data || result.data.length === 0) {
        setUploadError('No player data found in the file')
        return
      }

      // Check if file has Name column
      const firstPlayer = result.data[0]
      if (!firstPlayer.Name && !firstPlayer.name) {
        setUploadError('File must contain a "Name" or "name" column to match players')
        return
      }

      setUploadedData(result.data)
      setUploadColumns(result.columns || [])
      setUploadDialogOpen(true)
    } catch (error) {
      setUploadError('Failed to parse file. Please check the format.')
      console.error('Upload error:', error)
    }
  }

  const handleConfirmUpload = async () => {
    if (!uploadedData || uploadedData.length === 0) return

    setIsUploading(true)
    setUploadError('')
    setUploadSuccess('')

    try {
      // Get the key from URL
      const urlParams = new URLSearchParams(window.location.search)
      const key = urlParams.get('key') || 'tushkiKILLS'

      const response = await fetch(`/api/analytics/${auctionId}/upload-stats?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ players: uploadedData })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to upload stats' }))
        throw new Error(errorData.error || 'Failed to upload stats')
      }

      const result = await response.json()
      setUploadResults(result.results)
      setUploadSuccess(`Successfully updated ${result.results.matched} players!`)
      
      // Refresh page after 2 seconds to show updated data
      // This ensures all new columns and updated player data are visible
      setTimeout(() => {
        window.location.reload()
      }, 2000)
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Failed to upload stats')
      console.error('Upload error:', error)
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Player Table</CardTitle>
          <div className="flex items-center gap-4">
            <Input
              placeholder="Search players..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-64"
            />
            <div className="flex items-center gap-2">
              <input
                id="upload-stats-file"
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileUpload}
                className="hidden"
              />
              <label htmlFor="upload-stats-file">
                <Button variant="outline" type="button" className="cursor-pointer" asChild>
                  <span>
                    <Upload className="w-4 h-4 mr-2" />
                    Upload Stats
                  </span>
                </Button>
              </label>
              <Button
                variant="outline"
                onClick={() => setShowAddColumn(!showAddColumn)}
              >
                {showAddColumn ? 'Hide' : 'Add Column'}
              </Button>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Add Custom Column */}
        {showAddColumn && (
          <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
            <p className="text-sm font-semibold mb-2">Add Custom Column:</p>
            <div className="flex gap-2">
              <Input
                placeholder="Enter column name (e.g., 'Email Address', 'Contact no.')"
                value={newColumnName}
                onChange={(e) => setNewColumnName(e.target.value)}
                  onKeyDown={(e) => {
                  if (e.key === 'Enter' && newColumnName.trim()) {
                    const column = newColumnName.trim()
                    if (!visibleColumns.has(column)) {
                      const newColumns = new Set([...visibleColumns, column])
                      setVisibleColumns(newColumns)
                      saveAnalyticsColumns(Array.from(newColumns))
                    }
                    setNewColumnName('')
                  }
                }}
                className="flex-1"
              />
              <Button
                onClick={() => {
                  if (newColumnName.trim()) {
                    const column = newColumnName.trim()
                    if (!visibleColumns.has(column)) {
                      const newColumns = new Set([...visibleColumns, column])
                      setVisibleColumns(newColumns)
                      saveAnalyticsColumns(Array.from(newColumns))
                    }
                    setNewColumnName('')
                  }
                }}
                disabled={!newColumnName.trim()}
              >
                Add
              </Button>
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
              Tip: Column names are case-sensitive. Check your Excel file for exact column names.
            </p>
          </div>
        )}

        {/* Column Selector */}
        <div className="mb-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <p className="text-sm font-semibold mb-2">Visible Columns:</p>
          <div className="flex flex-wrap gap-2">
            {allColumns.map(column => (
              <label key={column} className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={visibleColumns.has(column)}
                  onCheckedChange={() => toggleColumn(column)}
                />
                <span className="text-sm">{column}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                {Array.from(visibleColumns).map(column => (
                  <th
                    key={column}
                    className="px-4 py-3 text-left text-sm font-semibold text-gray-700 dark:text-gray-300"
                  >
                    {column.charAt(0).toUpperCase() + column.slice(1)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredPlayers.map(player => (
                <tr
                  key={player.id}
                  className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                >
                  {Array.from(visibleColumns).map(column => (
                    <td key={column} className="px-4 py-3 text-sm">
                      {column === 'status' ? (
                        <Badge
                          variant={
                            player.status === 'SOLD'
                              ? 'default'
                              : player.status === 'UNSOLD'
                              ? 'secondary'
                              : 'outline'
                          }
                        >
                          {player.status}
                        </Badge>
                      ) : (
                        <span>{getPlayerValue(player, column)}</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 text-sm text-gray-600 dark:text-gray-400">
          Showing {filteredPlayers.length} of {players.length} players
        </div>
      </CardContent>

      {/* Upload Stats Dialog */}
      <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Upload Player Stats</DialogTitle>
            <DialogDescription>
              Review the uploaded data before confirming. Players will be matched by name.
            </DialogDescription>
          </DialogHeader>

          {uploadError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{uploadError}</AlertDescription>
            </Alert>
          )}

          {uploadSuccess && (
            <Alert className="bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800">
              <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
              <AlertDescription className="text-green-800 dark:text-green-200">
                {uploadSuccess}
              </AlertDescription>
            </Alert>
          )}

          {uploadResults && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                    {uploadResults.matched}
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">Matched</div>
                </div>
                <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                  <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
                    {uploadResults.unmatched}
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">Unmatched</div>
                </div>
                <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                  <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                    {uploadResults.newColumns?.length || 0}
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">New Columns</div>
                </div>
              </div>

              {uploadResults.matchedDetails && uploadResults.matchedDetails.length > 0 && (
                <div>
                  <h4 className="font-semibold mb-2">Matched Players:</h4>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {uploadResults.matchedDetails.map((item: any, idx: number) => (
                      <div key={idx} className="text-sm text-gray-600 dark:text-gray-400">
                        • {item.uploadedName} → {item.playerName}
                        <span className="text-xs text-gray-500 dark:text-gray-500 ml-2">
                          ({item.columnsUpdated?.length || 0} columns, matched via: {item.matchMethod || 'name'})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {uploadResults.unmatchedDetails && uploadResults.unmatchedDetails.length > 0 && (
                <div>
                  <h4 className="font-semibold mb-2">Unmatched Players:</h4>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {uploadResults.unmatchedDetails.map((item: any, idx: number) => (
                      <div key={idx} className="text-sm text-gray-600 dark:text-gray-400">
                        • {item.uploadedName} - {item.reason}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {uploadResults.newColumns && uploadResults.newColumns.length > 0 && (
                <div>
                  <h4 className="font-semibold mb-2">New Columns Added:</h4>
                  <div className="flex flex-wrap gap-2">
                    {uploadResults.newColumns.map((col: string) => (
                      <Badge key={col} variant="outline">{col}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {uploadedData && !uploadResults && (
            <div className="space-y-4">
              <div className="text-sm text-gray-600 dark:text-gray-400">
                Found <strong>{uploadedData.length}</strong> players in the file. 
                Players will be matched by name (case-insensitive).
              </div>
              
              <div className="max-h-60 overflow-y-auto border rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0">
                    <tr>
                      {uploadColumns.slice(0, 5).map(col => (
                        <th key={col} className="px-3 py-2 text-left font-semibold">
                          {col}
                        </th>
                      ))}
                      {uploadColumns.length > 5 && (
                        <th className="px-3 py-2 text-left font-semibold">
                          ... (+{uploadColumns.length - 5} more)
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {uploadedData.slice(0, 10).map((player, idx) => (
                      <tr key={idx} className="border-b">
                        {uploadColumns.slice(0, 5).map(col => (
                          <td key={col} className="px-3 py-2">
                            {String(player[col] || '-')}
                          </td>
                        ))}
                        {uploadColumns.length > 5 && <td className="px-3 py-2">...</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {uploadedData.length > 10 && (
                  <div className="p-2 text-xs text-gray-500 text-center">
                    Showing first 10 of {uploadedData.length} players
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setUploadDialogOpen(false)
                setUploadedData(null)
                setUploadError('')
                setUploadSuccess('')
                setUploadResults(null)
              }}
              disabled={isUploading}
            >
              {uploadResults ? 'Close' : 'Cancel'}
            </Button>
            {!uploadResults && (
              <Button
                onClick={handleConfirmUpload}
                disabled={isUploading || !uploadedData}
              >
                {isUploading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Confirm Upload
                  </>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

