'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Plus, Trash2, Edit } from 'lucide-react'

export interface CustomField {
  id: string
  name: string
  label: string
  type: 'TEXT' | 'NUMBER' | 'EMAIL' | 'PHONE' | 'DATE' | 'SELECT' | 'MULTISELECT' | 'CHECKBOX' | 'TEXTAREA' | 'URL'
  required: boolean
  placeholder?: string
  options?: string[] // For SELECT and MULTISELECT
  defaultValue?: any
}

interface FormBuilderProps {
  fields: CustomField[]
  onFieldsChange: (fields: CustomField[]) => void
  onAddPlayer: (playerData: Record<string, any>) => Promise<void>
  existingColumns?: string[]
}

export function FormBuilder({ fields, onFieldsChange, onAddPlayer, existingColumns = [] }: FormBuilderProps) {
  const [open, setOpen] = useState(false)
  const [editingField, setEditingField] = useState<CustomField | null>(null)
  const [formData, setFormData] = useState<Record<string, any>>({})
  const [isLoading, setIsLoading] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const addField = (field: Omit<CustomField, 'id'>) => {
    const newField: CustomField = {
      ...field,
      id: Date.now().toString()
    }
    onFieldsChange([...fields, newField])
    setOpen(false)
    setEditingField(null)
  }

  const updateField = (id: string, updates: Partial<CustomField>) => {
    onFieldsChange(fields.map(field => 
      field.id === id ? { ...field, ...updates } : field
    ))
    setOpen(false)
    setEditingField(null)
  }

  const deleteField = (id: string) => {
    onFieldsChange(fields.filter(field => field.id !== id))
  }

  const handleFieldChange = (fieldId: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      [fieldId]: value
    }))
    
    // Clear error when user starts typing
    if (errors[fieldId]) {
      setErrors(prev => {
        const newErrors = { ...prev }
        delete newErrors[fieldId]
        return newErrors
      })
    }
  }

  const validateForm = () => {
    const newErrors: Record<string, string> = {}
    
    fields.forEach(field => {
      if (field.required && !formData[field.id]) {
        newErrors[field.id] = `${field.label} is required`
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
      // Convert form data to player data format
      const playerData: Record<string, any> = {}
      fields.forEach(field => {
        if (formData[field.id] !== undefined) {
          playerData[field.name] = formData[field.id]
        }
      })

      await onAddPlayer(playerData)
      
      // Reset form
      setFormData({})
      setErrors({})
      setOpen(false)
    } catch (error) {
      console.error('Error adding player:', error)
      setErrors({ submit: 'Failed to add player. Please try again.' })
    } finally {
      setIsLoading(false)
    }
  }

  const renderFieldInput = (field: CustomField) => {
    const value = formData[field.id] || field.defaultValue || ''
    const error = errors[field.id]

    switch (field.type) {
      case 'TEXT':
      case 'EMAIL':
      case 'PHONE':
      case 'URL':
        return (
          <Input
            type={field.type.toLowerCase()}
            value={value}
            onChange={(e) => handleFieldChange(field.id, e.target.value)}
            placeholder={field.placeholder}
            className={error ? 'border-red-500' : ''}
          />
        )
      
      case 'NUMBER':
        return (
          <Input
            type="number"
            value={value}
            onChange={(e) => handleFieldChange(field.id, Number(e.target.value))}
            placeholder={field.placeholder}
            className={error ? 'border-red-500' : ''}
          />
        )
      
      case 'DATE':
        return (
          <Input
            type="date"
            value={value}
            onChange={(e) => handleFieldChange(field.id, e.target.value)}
            className={error ? 'border-red-500' : ''}
          />
        )
      
      case 'TEXTAREA':
        return (
          <Textarea
            value={value}
            onChange={(e) => handleFieldChange(field.id, e.target.value)}
            placeholder={field.placeholder}
            className={error ? 'border-red-500' : ''}
          />
        )
      
      case 'SELECT':
        return (
          <Select value={value} onValueChange={(val) => handleFieldChange(field.id, val)}>
            <SelectTrigger className={error ? 'border-red-500' : ''}>
              <SelectValue placeholder={field.placeholder || `Select ${field.label}`} />
            </SelectTrigger>
            <SelectContent>
              {field.options?.map((option, index) => (
                <SelectItem key={index} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      
      case 'MULTISELECT':
        const selectedValues = Array.isArray(value) ? value : []
        return (
          <div className="space-y-2">
            {field.options?.map((option, index) => (
              <div key={index} className="flex items-center space-x-2">
                <Checkbox
                  id={`${field.id}-${index}`}
                  checked={selectedValues.includes(option)}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      handleFieldChange(field.id, [...selectedValues, option])
                    } else {
                      handleFieldChange(field.id, selectedValues.filter(v => v !== option))
                    }
                  }}
                />
                <Label htmlFor={`${field.id}-${index}`}>{option}</Label>
              </div>
            ))}
          </div>
        )
      
      case 'CHECKBOX':
        return (
          <div className="flex items-center space-x-2">
            <Checkbox
              id={field.id}
              checked={value}
              onCheckedChange={(checked) => handleFieldChange(field.id, checked)}
            />
            <Label htmlFor={field.id}>{field.label}</Label>
          </div>
        )
      
      default:
        return (
          <Input
            value={value}
            onChange={(e) => handleFieldChange(field.id, e.target.value)}
            placeholder={field.placeholder}
            className={error ? 'border-red-500' : ''}
          />
        )
    }
  }

  return (
    <div className="space-y-6">
      {/* Dynamic Form - Show Add Player at top if fields exist */}
      {fields.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Add Player Manually</CardTitle>
            <CardDescription>
              Fill out the form below to add a new player
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {fields.map((field) => (
              <div key={field.id} className="space-y-2">
                <Label htmlFor={field.id}>
                  {field.label}
                  {field.required && <span className="text-red-500 ml-1">*</span>}
                </Label>
                {renderFieldInput(field)}
                {errors[field.id] && (
                  <p className="text-sm text-red-500">{errors[field.id]}</p>
                )}
              </div>
            ))}

            {errors.submit && (
              <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-3 rounded-md">
                {errors.submit}
              </div>
            )}

            <div className="flex justify-end space-x-4">
              <Button 
              onClick={handleSubmit} 
              disabled={isLoading} 
              className="bg-blue-600 hover:bg-blue-700 text-white dark:bg-blue-600 dark:hover:bg-blue-700 disabled:opacity-50"
            >
                {isLoading ? 'Adding...' : 'Add Player'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Field Management */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle>Custom Fields for Manual Entry</CardTitle>
              <CardDescription>
                Define fields for manually adding players (not needed for Excel upload)
              </CardDescription>
            </div>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <div>
                  <Button type="button" className="bg-blue-600 hover:bg-blue-700 text-white dark:bg-blue-600 dark:hover:bg-blue-700">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Field
                  </Button>
                </div>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>
                    {editingField ? 'Edit Field' : 'Add New Field'}
                  </DialogTitle>
                  <DialogDescription>
                    Configure the field properties
                  </DialogDescription>
                </DialogHeader>
                <FieldEditor
                  field={editingField}
                  onSave={(idOrField, updates) => {
                    if (editingField) {
                      updateField(idOrField as string, updates!)
                    } else {
                      addField(idOrField as Omit<CustomField, 'id'>)
                    }
                  }}
                  onCancel={() => {
                    setOpen(false)
                    setEditingField(null)
                  }}
                />
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {fields.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>No custom fields defined.</p>
              <p className="mt-2 text-sm">Add fields here only if you want to manually add players one by one.</p>
              <p className="mt-1 text-sm">Excel uploads use the columns from your Excel file.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {fields.map((field) => (
                <div key={field.id} className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2">
                      <span className="font-medium">{field.label}</span>
                      <span className="text-sm text-gray-500">({field.type})</span>
                      {field.required && <span className="text-red-500 text-sm">*</span>}
                    </div>
                    <div className="text-sm text-gray-500">
                      Field name: {field.name}
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditingField(field)
                        setOpen(true)
                      }}
                      className="bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => deleteField(field.id)}
                      className="bg-red-600 hover:bg-red-700 text-white dark:bg-red-600 dark:hover:bg-red-700"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// Field Editor Component
interface FieldEditorProps {
  field: CustomField | null
  onSave: (idOrField: string | Omit<CustomField, 'id'>, updates?: Partial<CustomField>) => void
  onCancel: () => void
}

function FieldEditor({ field, onSave, onCancel }: FieldEditorProps) {
  const [formData, setFormData] = useState({
    name: field?.name || '',
    label: field?.label || '',
    type: field?.type || 'TEXT' as CustomField['type'],
    required: field?.required || false,
    placeholder: field?.placeholder || '',
    options: field?.options?.join('\n') || '',
    defaultValue: field?.defaultValue || ''
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  const handleSave = () => {
    const newErrors: Record<string, string> = {}
    
    if (!formData.name.trim()) {
      newErrors.name = 'Field name is required'
    }
    
    if (!formData.label.trim()) {
      newErrors.label = 'Display label is required'
    }
    
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    const fieldData = {
      ...formData,
      options: formData.options ? formData.options.split('\n').filter(Boolean) : undefined,
      id: field?.id
    }

    if (field?.id) {
      // Update existing field
      onSave(field.id, fieldData)
    } else {
      // Add new field
      onSave(fieldData)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="name">Field Name</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => {
              setFormData(prev => ({ ...prev, name: e.target.value }))
              if (errors.name) {
                setErrors(prev => ({ ...prev, name: '' }))
              }
            }}
            placeholder="e.g., playerName"
            className={errors.name ? 'border-red-500' : ''}
          />
          {errors.name && <p className="text-sm text-red-500 mt-1">{errors.name}</p>}
        </div>
        <div>
          <Label htmlFor="label">Display Label</Label>
          <Input
            id="label"
            value={formData.label}
            onChange={(e) => {
              setFormData(prev => ({ ...prev, label: e.target.value }))
              if (errors.label) {
                setErrors(prev => ({ ...prev, label: '' }))
              }
            }}
            placeholder="e.g., Player Name"
            className={errors.label ? 'border-red-500' : ''}
          />
          {errors.label && <p className="text-sm text-red-500 mt-1">{errors.label}</p>}
        </div>
      </div>

      <div>
        <Label htmlFor="type">Field Type</Label>
        <Select value={formData.type} onValueChange={(value) => setFormData(prev => ({ ...prev, type: value as CustomField['type'] }))}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="TEXT">Text</SelectItem>
            <SelectItem value="NUMBER">Number</SelectItem>
            <SelectItem value="EMAIL">Email</SelectItem>
            <SelectItem value="PHONE">Phone</SelectItem>
            <SelectItem value="DATE">Date</SelectItem>
            <SelectItem value="SELECT">Select (Dropdown)</SelectItem>
            <SelectItem value="MULTISELECT">Multi-Select</SelectItem>
            <SelectItem value="CHECKBOX">Checkbox</SelectItem>
            <SelectItem value="TEXTAREA">Text Area</SelectItem>
            <SelectItem value="URL">URL</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="placeholder">Placeholder Text</Label>
        <Input
          id="placeholder"
          value={formData.placeholder}
          onChange={(e) => setFormData(prev => ({ ...prev, placeholder: e.target.value }))}
          placeholder="Optional placeholder text"
        />
      </div>

      {(formData.type === 'SELECT' || formData.type === 'MULTISELECT') && (
        <div>
          <Label htmlFor="options">Options (one per line)</Label>
          <Textarea
            id="options"
            value={formData.options}
            onChange={(e) => setFormData(prev => ({ ...prev, options: e.target.value }))}
            placeholder="Option 1&#10;Option 2&#10;Option 3"
            rows={4}
          />
        </div>
      )}

      <div className="flex items-center space-x-2">
        <Checkbox
          id="required"
          checked={formData.required}
          onCheckedChange={(checked) => setFormData(prev => ({ ...prev, required: !!checked }))}
        />
        <Label htmlFor="required">Required field</Label>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel} className="bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700">
          Cancel
        </Button>
        <Button onClick={handleSave} className="bg-blue-600 hover:bg-blue-700 text-white dark:bg-blue-600 dark:hover:bg-blue-700">
          {field ? 'Update Field' : 'Add Field'}
        </Button>
      </DialogFooter>
    </div>
  )
}
