'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { CustomField, FormBuilder } from '@/components/form-builder'

export default function NewAuction() {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    minBidIncrement: 1000,
    countdownSeconds: 15,
    maxTeamSize: '',
    enforcePurse: true,
    isPublished: false,
    registrationOpen: true,
    iconPlayerCount: 10,
    mandatoryTeamSize: 12,
    bidderCount: 10
  })
  const [customFields, setCustomFields] = useState<CustomField[]>([]) // Add custom fields state
  const [isLoading, setIsLoading] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const router = useRouter()

  const validateForm = () => {
    const newErrors: Record<string, string> = {}

    if (!formData.name.trim()) {
      newErrors.name = 'Auction name is required'
    }

    if (formData.minBidIncrement < 1) {
      newErrors.minBidIncrement = 'Minimum bid increment must be at least 1'
    }

    if (formData.countdownSeconds < 5) {
      newErrors.countdownSeconds = 'Countdown must be at least 5 seconds'
    }

    if (formData.maxTeamSize && (Number(formData.maxTeamSize) < 1 || Number(formData.maxTeamSize) > 50)) {
      newErrors.maxTeamSize = 'Team size must be between 1 and 50'
    }

    if (formData.iconPlayerCount < 1) {
      newErrors.iconPlayerCount = 'Icon player count must be at least 1'
    }

    if (formData.mandatoryTeamSize < 1) {
      newErrors.mandatoryTeamSize = 'Mandatory team size must be at least 1'
    }

    if (formData.bidderCount < 1) {
      newErrors.bidderCount = 'Bidder count must be at least 1'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!validateForm()) {
      return
    }

    setIsLoading(true)

    try {
      const rules = {
        minBidIncrement: formData.minBidIncrement,
        countdownSeconds: formData.countdownSeconds,
        maxTeamSize: formData.maxTeamSize ? Number(formData.maxTeamSize) : null,
        enforcePurse: formData.enforcePurse,
        iconPlayerCount: formData.iconPlayerCount,
        mandatoryTeamSize: formData.mandatoryTeamSize,
        bidderCount: formData.bidderCount
      }

      const response = await fetch('/api/auctions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: formData.name,
          description: formData.description || null,
          rules,
          isPublished: formData.isPublished,
          registrationOpen: formData.registrationOpen,
          customFields: customFields.length > 0 ? customFields : null // Include custom fields
        }),
      })

      const data = await response.json()

      if (response.ok) {
        router.push(`/dashboard/auctions/${data.auction.id}/players`)
      } else {
        setErrors({ submit: data.error || 'Something went wrong' })
      }
    } catch (error) {
      setErrors({ submit: 'Network error. Please try again.' })
    } finally {
      setIsLoading(false)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target
    const checked = (e.target as HTMLInputElement).checked
    
    setFormData(prev => ({ 
      ...prev, 
      [name]: type === 'checkbox' ? checked : value 
    }))
    
    // Clear error when user starts typing
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }))
    }
  }

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    const numValue = value === '' ? '' : Number(value)
    
    setFormData(prev => ({ 
      ...prev, 
      [name]: numValue 
    }))
    
    // Clear error when user starts typing
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }))
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-4">
        <Link href="/dashboard/auctions">
          <Button variant="outline" size="sm">← Back to Auctions</Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Create New Auction</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-2">
            Set up a new auction event with custom rules and settings
          </p>
        </div>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Auction Details</CardTitle>
          <CardDescription>
            Configure your auction settings and rules
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="name">Auction Name *</Label>
              <Input
                id="name"
                name="name"
                value={formData.name}
                onChange={handleChange}
                placeholder="Enter auction name"
                className={errors.name ? 'border-red-500' : ''}
              />
              {errors.name && (
                <p className="text-sm text-red-600">{errors.name}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={handleChange}
                placeholder="Enter auction description (optional)"
                rows={3}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="minBidIncrement">Minimum Bid Increment *</Label>
                <Input
                  id="minBidIncrement"
                  name="minBidIncrement"
                  type="number"
                  value={formData.minBidIncrement}
                  onChange={handleNumberChange}
                  min="1"
                  className={errors.minBidIncrement ? 'border-red-500' : ''}
                />
                {errors.minBidIncrement && (
                  <p className="text-sm text-red-600">{errors.minBidIncrement}</p>
                )}
                <p className="text-xs text-gray-500">Minimum amount by which bids must increase</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="countdownSeconds">Countdown Timer (seconds) *</Label>
                <Input
                  id="countdownSeconds"
                  name="countdownSeconds"
                  type="number"
                  value={formData.countdownSeconds}
                  onChange={handleNumberChange}
                  min="5"
                  className={errors.countdownSeconds ? 'border-red-500' : ''}
                />
                {errors.countdownSeconds && (
                  <p className="text-sm text-red-600">{errors.countdownSeconds}</p>
                )}
                <p className="text-xs text-gray-500">Time limit for each player auction</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="maxTeamSize">Maximum Team Size</Label>
              <Input
                id="maxTeamSize"
                name="maxTeamSize"
                type="number"
                value={formData.maxTeamSize}
                onChange={handleNumberChange}
                min="1"
                max="50"
                placeholder="Leave empty for no limit"
                className={errors.maxTeamSize ? 'border-red-500' : ''}
              />
              {errors.maxTeamSize && (
                <p className="text-sm text-red-600">{errors.maxTeamSize}</p>
              )}
              <p className="text-xs text-gray-500">Maximum players a bidder can acquire (optional)</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="iconPlayerCount">Icon Players Count *</Label>
                <Input
                  id="iconPlayerCount"
                  name="iconPlayerCount"
                  type="number"
                  value={formData.iconPlayerCount}
                  onChange={handleNumberChange}
                  min="1"
                  className={errors.iconPlayerCount ? 'border-red-500' : ''}
                />
                {errors.iconPlayerCount && (
                  <p className="text-sm text-red-600">{errors.iconPlayerCount}</p>
                )}
                <p className="text-xs text-gray-500">Number of icon players to be auctioned first (in random order)</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="mandatoryTeamSize">Mandatory Team Size *</Label>
                <Input
                  id="mandatoryTeamSize"
                  name="mandatoryTeamSize"
                  type="number"
                  value={formData.mandatoryTeamSize}
                  onChange={handleNumberChange}
                  min="1"
                  className={errors.mandatoryTeamSize ? 'border-red-500' : ''}
                />
                {errors.mandatoryTeamSize && (
                  <p className="text-sm text-red-600">{errors.mandatoryTeamSize}</p>
                )}
                <p className="text-xs text-gray-500">Minimum players including bidder (e.g., 11 players + 1 bidder = 12)</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="bidderCount">Required Bidders Count *</Label>
                <Input
                  id="bidderCount"
                  name="bidderCount"
                  type="number"
                  value={formData.bidderCount}
                  onChange={handleNumberChange}
                  min="1"
                  className={errors.bidderCount ? 'border-red-500' : ''}
                />
                {errors.bidderCount && (
                  <p className="text-sm text-red-600">{errors.bidderCount}</p>
                )}
                <p className="text-xs text-gray-500">Minimum number of bidders required to publish the auction</p>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="enforcePurse"
                name="enforcePurse"
                checked={formData.enforcePurse}
                onCheckedChange={(checked) => 
                  setFormData(prev => ({ ...prev, enforcePurse: checked as boolean }))
                }
              />
              <Label htmlFor="enforcePurse" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                Enforce Purse Limit
              </Label>
            </div>
            <p className="text-xs text-gray-500 ml-6">Prevent bidders from bidding more than their remaining purse amount</p>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="isPublished"
                name="isPublished"
                checked={formData.isPublished}
                onCheckedChange={(checked) => 
                  setFormData(prev => ({ ...prev, isPublished: checked as boolean }))
                }
              />
              <Label htmlFor="isPublished" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                Publish Auction
              </Label>
            </div>
            <p className="text-xs text-gray-500 ml-6">Make this auction visible for public player registration</p>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="registrationOpen"
                name="registrationOpen"
                checked={formData.registrationOpen}
                onCheckedChange={(checked) => 
                  setFormData(prev => ({ ...prev, registrationOpen: checked as boolean }))
                }
              />
              <Label htmlFor="registrationOpen" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                Open Registration
              </Label>
            </div>
            <p className="text-xs text-gray-500 ml-6">Allow players to register for this auction</p>

            {errors.submit && (
              <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 p-3 rounded-md">
                {errors.submit}
              </div>
            )}

            <div className="flex justify-end space-x-4">
              <Link href="/dashboard/auctions">
                <Button type="button" variant="outline">Cancel</Button>
              </Link>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? 'Creating...' : 'Create Auction'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Optional: Registration Fields for Public Registration */}
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Player Registration Fields (Optional)</CardTitle>
          <CardDescription>
            Define custom fields for public player registration from the landing page. 
            Leave empty if you're using Excel upload only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FormBuilder
            fields={customFields}
            onFieldsChange={setCustomFields}
            onAddPlayer={async () => {}} // Not used in creation, just for field definition
            existingColumns={[]}
          />
        </CardContent>
      </Card>
    </div>
  )
}
