'use client'

import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuCheckboxItem } from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Badge } from '@/components/ui/badge'
import { ChevronDown, Search, Filter, ArrowUpDown, Eye, EyeOff, GripVertical } from 'lucide-react'

export interface DataTableColumn {
  key: string
  label: string
  type?: 'string' | 'number' | 'date'
  sortable?: boolean
  filterable?: boolean
}

export interface DataTableProps {
  data: Record<string, any>[]
  columns: DataTableColumn[]
  onEdit?: (item: Record<string, any>) => void
  onDelete?: (item: Record<string, any>) => void
  onRetire?: (item: Record<string, any>) => void
  onIconPlayerToggle?: (item: Record<string, any>) => void
  searchPlaceholder?: string
  emptyMessage?: string
  onColumnReorder?: (reorderedColumns: DataTableColumn[]) => void
  title?: string | React.ReactNode
  description?: string
}

type SortConfig = {
  key: string
  direction: 'asc' | 'desc'
}

type FilterConfig = {
  [key: string]: {
    type: 'text' | 'range'
    value: string | { min: string; max: string }
  }
}

export function DataTable({
  data,
  columns,
  onEdit,
  onDelete,
  onRetire,
  onIconPlayerToggle,
  searchPlaceholder = "Search...",
  emptyMessage = "No data available",
  onColumnReorder,
  title,
  description
}: DataTableProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(null)
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(
    new Set(columns.slice(0, 6).map(col => col.key))
  )
  console.log('Available columns:', columns.map(col => col.key))
  console.log('Initial visible columns:', Array.from(new Set(columns.slice(0, 6).map(col => col.key))))
  const [filters, setFilters] = useState<FilterConfig>({})
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null)
  const [columnOrder, setColumnOrder] = useState<string[]>(columns.map(col => col.key))
  const [columnSelectorOpen, setColumnSelectorOpen] = useState(false)

  // Filter and sort data
  const filteredAndSortedData = useMemo(() => {
    let filtered = data.filter(item => {
      // Search filter
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase()
        const matchesSearch = Object.values(item).some(value => 
          value?.toString().toLowerCase().includes(searchLower)
        )
        if (!matchesSearch) return false
      }

      // Column filters
      for (const [key, filter] of Object.entries(filters)) {
        const itemValue = item[key]
        if (filter.type === 'text') {
          const filterValue = filter.value as string
          if (filterValue && !itemValue?.toString().toLowerCase().includes(filterValue.toLowerCase())) {
            return false
          }
        } else if (filter.type === 'range') {
          const range = filter.value as { min: string; max: string }
          const numValue = Number(itemValue)
          if (!isNaN(numValue)) {
            if (range.min && numValue < Number(range.min)) return false
            if (range.max && numValue > Number(range.max)) return false
          }
        }
      }

      return true
    })

    // Sort data
    if (sortConfig) {
      filtered.sort((a, b) => {
        const aValue = a[sortConfig.key]
        const bValue = b[sortConfig.key]
        
        if (aValue === bValue) return 0
        
        const comparison = aValue < bValue ? -1 : 1
        return sortConfig.direction === 'asc' ? comparison : -comparison
      })
    }

    return filtered
  }, [data, searchTerm, sortConfig, filters])

  const handleSort = (key: string) => {
    const column = columns.find(col => col.key === key)
    if (!column?.sortable) return

    setSortConfig(prev => {
      if (prev?.key === key) {
        return prev.direction === 'asc' 
          ? { key, direction: 'desc' }
          : null
      }
      return { key, direction: 'asc' }
    })
  }

  const toggleColumnVisibility = (key: string) => {
    console.log('Toggling column:', key, 'Current visible columns:', Array.from(visibleColumns))
    setVisibleColumns(prev => {
      const newSet = new Set(prev)
      if (newSet.has(key)) {
        newSet.delete(key)
        console.log('Removed column:', key)
      } else {
        newSet.add(key)
        console.log('Added column:', key)
      }
      console.log('New visible columns:', Array.from(newSet))
      return newSet
    })
  }

  const updateFilter = (key: string, type: 'text' | 'range', value: string | { min: string; max: string }) => {
    setFilters(prev => ({
      ...prev,
      [key]: { type, value }
    }))
  }

  const clearFilter = (key: string) => {
    setFilters(prev => {
      const newFilters = { ...prev }
      delete newFilters[key]
      return newFilters
    })
  }

  const handleDragStart = (e: React.DragEvent, columnKey: string) => {
    setDraggedColumn(columnKey)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = (e: React.DragEvent, targetColumnKey: string) => {
    e.preventDefault()
    
    if (!draggedColumn || draggedColumn === targetColumnKey) {
      setDraggedColumn(null)
      return
    }

    const newOrder = [...columnOrder]
    const draggedIndex = newOrder.indexOf(draggedColumn)
    const targetIndex = newOrder.indexOf(targetColumnKey)
    
    // Remove dragged column and insert at target position
    newOrder.splice(draggedIndex, 1)
    newOrder.splice(targetIndex, 0, draggedColumn)
    
    setColumnOrder(newOrder)
    setDraggedColumn(null)
    
    // Notify parent component of column reorder
    if (onColumnReorder) {
      const reorderedColumns = newOrder.map(key => columns.find(col => col.key === key)!).filter(Boolean)
      onColumnReorder(reorderedColumns)
    }
  }

  const handleDragEnd = () => {
    setDraggedColumn(null)
  }

  // Get columns in the correct order
  const orderedColumns = columnOrder.map(key => columns.find(col => col.key === key)!).filter(Boolean)
  const visibleColumnsList = orderedColumns.filter(col => visibleColumns.has(col.key))

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              {title || `Data (${filteredAndSortedData.length})`}
            </CardTitle>
            <CardDescription>
              {description || 'Manage data with search, sort, and filter options'}
              {visibleColumns.size < columns.length && (
                <span className="text-blue-600 dark:text-blue-400 ml-2">
                  • Showing {visibleColumns.size} of {columns.length} columns
                </span>
              )}
            </CardDescription>
          </div>
          <div className="flex items-center space-x-2">
            {/* Column Selector */}
            <DropdownMenu open={columnSelectorOpen} onOpenChange={setColumnSelectorOpen}>
              <DropdownMenuTrigger asChild>
                <div>
                  <Button variant="outline" size="sm" className="bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700">
                    <Eye className="h-4 w-4 mr-2" />
                    Columns
                    <ChevronDown className="h-4 w-4 ml-2" />
                  </Button>
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <div className="p-2">
                  <div className="text-sm font-medium mb-2">Select Columns to Display</div>
                  <div className="space-y-1 max-h-60 overflow-y-auto">
                    {columns.map((column, index) => (
                      <div
                        key={column.key}
                        className="flex items-center space-x-2 p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                      >
                        <input
                          type="checkbox"
                          checked={visibleColumns.has(column.key)}
                          onChange={(e) => {
                            console.log('Checkbox clicked for column:', column.key, 'Checked:', e.target.checked)
                            e.stopPropagation()
                            toggleColumnVisibility(column.key)
                          }}
                          className="rounded border-gray-300 dark:border-gray-600"
                        />
                        <div className="flex items-center justify-between w-full">
                          <span className="text-sm">{column.label}</span>
                          {index < 6 && (
                            <span className="text-xs text-blue-600 dark:text-blue-400 ml-2">
                              (First 6)
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs"
                      onClick={() => setColumnSelectorOpen(false)}
                    >
                      Close
                    </Button>
                  </div>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
            
            {/* Quick View Toggle */}
            <Button 
              variant="outline" 
              size="sm"
              className="bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
              onClick={() => {
                const isShowingAll = visibleColumns.size === columns.length
                if (isShowingAll) {
                  // Show only first 6 columns
                  setVisibleColumns(new Set(columns.slice(0, 6).map(col => col.key)))
                } else {
                  // Show all columns
                  setVisibleColumns(new Set(columns.map(col => col.key)))
                }
              }}
            >
              {visibleColumns.size === columns.length ? (
                <>
                  <EyeOff className="h-4 w-4 mr-2" />
                  Show First 6
                </>
              ) : (
                <>
                  <Eye className="h-4 w-4 mr-2" />
                  Show All
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="flex items-center space-x-4 mt-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder={searchPlaceholder}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          
          {/* Filter badges */}
          {Object.keys(filters).length > 0 && (
            <div className="flex items-center space-x-2">
              {Object.entries(filters).map(([key, filter]) => (
                <Badge key={key} variant="secondary" className="flex items-center space-x-1">
                  <span>{columns.find(col => col.key === key)?.label}: {typeof filter.value === 'string' ? filter.value : JSON.stringify(filter.value)}</span>
                  <button
                    onClick={() => clearFilter(key)}
                    className="ml-1 hover:text-red-500"
                  >
                    ×
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {filteredAndSortedData.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {emptyMessage}
          </div>
        ) : (
          <div className="overflow-x-auto border rounded-lg w-full max-w-full">
            <div className="relative min-w-max">
              <Table className="min-w-full">
                <TableHeader>
                  <TableRow>
                    {visibleColumnsList.map(column => (
                      <TableHead 
                        key={column.key} 
                        className="relative min-w-[120px] cursor-move"
                        draggable
                        onDragStart={(e) => handleDragStart(e, column.key)}
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, column.key)}
                        onDragEnd={handleDragEnd}
                      >
                        <div className="flex items-center space-x-2">
                          <GripVertical className="h-4 w-4 text-gray-400 cursor-grab" />
                          <span
                            className={column.sortable ? 'cursor-pointer hover:text-primary' : ''}
                            onClick={() => column.sortable && handleSort(column.key)}
                          >
                            {column.label}
                          </span>
                          {column.sortable && (
                            <ArrowUpDown className="h-4 w-4 text-gray-400" />
                          )}
                          {column.filterable && (
                            <Popover>
                              <div>
                                <PopoverTrigger asChild>
                                  <button className="h-6 w-6 p-0 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded flex items-center justify-center">
                                    <Filter className="h-3 w-3" />
                                  </button>
                                </PopoverTrigger>
                              </div>
                              <PopoverContent className="w-64">
                                <div className="space-y-4">
                                  <h4 className="font-medium">Filter by {column.label}</h4>
                                  {column.type === 'number' ? (
                                    <div className="space-y-2">
                                      <Input
                                        type="number"
                                        placeholder="Min value"
                                        value={filters[column.key]?.type === 'range' 
                                          ? (filters[column.key]?.value as { min: string; max: string }).min 
                                          : ''}
                                        onChange={(e) => updateFilter(column.key, 'range', {
                                          min: e.target.value,
                                          max: filters[column.key]?.type === 'range' 
                                            ? (filters[column.key]?.value as { min: string; max: string }).max 
                                            : ''
                                        })}
                                      />
                                      <Input
                                        type="number"
                                        placeholder="Max value"
                                        value={filters[column.key]?.type === 'range' 
                                          ? (filters[column.key]?.value as { min: string; max: string }).max 
                                          : ''}
                                        onChange={(e) => updateFilter(column.key, 'range', {
                                          min: filters[column.key]?.type === 'range' 
                                            ? (filters[column.key]?.value as { min: string; max: string }).min 
                                            : '',
                                          max: e.target.value
                                        })}
                                      />
                                    </div>
                                  ) : (
                                    <Input
                                      placeholder={`Filter by ${column.label}`}
                                      value={filters[column.key]?.type === 'text' 
                                        ? filters[column.key]?.value as string 
                                        : ''}
                                      onChange={(e) => updateFilter(column.key, 'text', e.target.value)}
                                    />
                                  )}
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => clearFilter(column.key)}
                                    className="w-full bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
                                  >
                                    Clear Filter
                                  </Button>
                                </div>
                              </PopoverContent>
                            </Popover>
                          )}
                        </div>
                      </TableHead>
                    ))}
                    {(onEdit || onDelete || onRetire || onIconPlayerToggle) && (
                      <TableHead className="text-right">Actions</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAndSortedData.map((item, index) => (
                    <TableRow key={index}>
                      {visibleColumnsList.map(column => (
                        <TableCell key={column.key} className="min-w-[120px]">
                          <div className="truncate max-w-[200px]" title={item[column.key]?.toString() || '-'}>
                            {item[column.key]?.toString() || '-'}
                          </div>
                        </TableCell>
                      ))}
                      {(onEdit || onDelete || onRetire || onIconPlayerToggle) && (
                        <TableCell className="text-right">
                          <div className="flex justify-end space-x-2 flex-wrap">
                            {onIconPlayerToggle && (
                              <Button
                                variant={item.isIcon ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => onIconPlayerToggle(item)}
                                className={
                                  item.isIcon
                                    ? 'bg-purple-600 hover:bg-purple-700 text-white'
                                    : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                                }
                              >
                                {item.isIcon ? '⭐ Icon' : 'Mark Icon'}
                              </Button>
                            )}
                            {onEdit && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => onEdit(item)}
                                className="bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
                              >
                                Edit
                              </Button>
                            )}
                            {onRetire && (
                              <Button
                                variant={item.status === 'RETIRED' ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => onRetire(item)}
                                className={
                                  item.status === 'RETIRED'
                                    ? 'bg-green-600 hover:bg-green-700 text-white'
                                    : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                                }
                              >
                                {item.status === 'RETIRED' ? 'Unretire' : 'Retire'}
                              </Button>
                            )}
                            {onDelete && (
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => onDelete(item)}
                                className="bg-red-600 hover:bg-red-700 text-white dark:bg-red-600 dark:hover:bg-red-700"
                              >
                                Delete
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {/* Enhanced scroll indicator */}
            <div className="flex justify-center py-2 text-xs text-gray-400 bg-gray-50 dark:bg-gray-800 border-t">
              <div className="flex items-center space-x-2">
                <span>← Scroll horizontally to see more columns →</span>
                <span className="text-blue-600 dark:text-blue-400">
                  ({visibleColumnsList.length} of {orderedColumns.length} columns visible)
                </span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}