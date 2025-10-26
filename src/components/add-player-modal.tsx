'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Plus } from 'lucide-react'

interface AddPlayerModalProps {
  onAddPlayer: (playerData: Record<string, any>) => Promise<void>
  existingColumns?: string[]
}

export function AddPlayerModal({ onAddPlayer, existingColumns = [] }: AddPlayerModalProps) {
  const [open, setOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [playerData, setPlayerData] = useState<Record<string, any>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Common player fields
  const commonFields = [
    { key: 'Name', label: 'Name', required: true },
    { key: 'Age', label: 'Age', type: 'number' },
    { key: 'Role', label: 'Role' },
    { key: 'Base Price', label: 'Base Price', type: 'number' },
    { key: 'Matches', label: 'Matches', type: 'number' },
    { key: 'Average', label: 'Average', type: 'number' },
    { key: 'Team', label: 'Team' },
    { key: 'Country', label: 'Country' },
    { key: 'Experience', label: 'Experience', type: 'number' },
    { key: 'Specialization', label: 'Specialization' }
  ]

  // Get all unique fields (common + existing columns)
  const allFields = [
    ...commonFields,
    ...existingColumns
      .filter(col => !commonFields.some(field => field.key === col))
      .map(col => ({ key: col, label: col }))
  ]

  const handleFieldChange = (key: string, value: string) => {
    setPlayerData(prev => ({
      ...prev,
      [key]: value
    }))
    
    // Clear error when user starts typing
    if (errors[key]) {
      setErrors(prev => {
        const newErrors = { ...prev }
        delete newErrors[key]
        return newErrors
      })
    }
  }

  const validateForm = () => {
    const newErrors: Record<string, string> = {}
    
    // Check required fields
    commonFields.forEach(field => {
      if (field.required && !playerData[field.key]?.toString().trim()) {
        newErrors[field.key] = `${field.label} is required`
      }
    })

    // Validate number fields
    commonFields.forEach(field => {
      if (field.type === 'number' && playerData[field.key]) {
        const value = Number(playerData[field.key])
        if (isNaN(value)) {
          newErrors[field.key] = `${field.label} must be a valid number`
        }
      }
    })

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async () => {
    if (!validateForm()) {
      return
    }

    setIsLoading(true)
    try {
      // Clean the data - remove empty values and convert numbers
      const cleanedData: Record<string, any> = {}
      Object.entries(playerData).forEach(([key, value]) => {
        if (value && value.toString().trim()) {
          const field = commonFields.find(f => f.key === key)
          if (field?.type === 'number') {
            cleanedData[key] = Number(value)
          } else {
            cleanedData[key] = value.toString().trim()
          }
        }
      })

      await onAddPlayer(cleanedData)
      
      // Reset form
      setPlayerData({})
      setErrors({})
      setOpen(false)
    } catch (error) {
      console.error('Error adding player:', error)
      setErrors({ submit: 'Failed to add player. Please try again.' })
    } finally {
      setIsLoading(false)
    }
  }

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen)
    if (!newOpen) {
      // Reset form when closing
      setPlayerData({})
      setErrors({})
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <div>
          <Button type="button">
            <Plus className="h-4 w-4 mr-2" />
            Add Player Manually
          </Button>
        </div>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add New Player</DialogTitle>
          <DialogDescription>
            Enter player information manually. All fields are optional except Name.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Common Fields */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Basic Information</CardTitle>
              <CardDescription>
                Essential player details
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {commonFields.map(field => (
                  <div key={field.key} className="space-y-2">
                    <Label htmlFor={field.key}>
                      {field.label}
                      {field.required && <span className="text-red-500 ml-1">*</span>}
                    </Label>
                    <Input
                      id={field.key}
                      type={field.type === 'number' ? 'number' : 'text'}
                      value={playerData[field.key] || ''}
                      onChange={(e) => handleFieldChange(field.key, e.target.value)}
                      placeholder={`Enter ${field.label.toLowerCase()}`}
                      className={errors[field.key] ? 'border-red-500' : ''}
                    />
                    {errors[field.key] && (
                      <p className="text-sm text-red-500">{errors[field.key]}</p>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Additional Fields */}
          {existingColumns.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Additional Fields</CardTitle>
                <CardDescription>
                  Fields from your existing player data
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {existingColumns
                    .filter(col => !commonFields.some(field => field.key === col))
                    .map(column => (
                      <div key={column} className="space-y-2">
                        <Label htmlFor={column}>{column}</Label>
                        <Input
                          id={column}
                          value={playerData[column] || ''}
                          onChange={(e) => handleFieldChange(column, e.target.value)}
                          placeholder={`Enter ${column.toLowerCase()}`}
                        />
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {errors.submit && (
          <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-3 rounded-md">
            {errors.submit}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} className="text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800">
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isLoading}>
            {isLoading ? 'Adding...' : 'Add Player'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
