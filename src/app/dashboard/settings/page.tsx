'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import { Loader2, Copy, Check } from 'lucide-react'

interface Invitation {
  id: string
  code: string
  used: boolean
  usedBy: string | null
  usedAt: string | null
  createdAt: string
  expiresAt: string | null
}

export default function SettingsPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [newCode, setNewCode] = useState<string>('')
  const [expiresDays, setExpiresDays] = useState<number>(30)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isFetching, setIsFetching] = useState(true)

  useEffect(() => {
    // Redirect if not super admin
    if (session?.user?.role !== 'SUPER_ADMIN') {
      router.push('/dashboard')
    }
  }, [session, router])

  useEffect(() => {
    fetchInvitations()
  }, [])

  const fetchInvitations = async () => {
    try {
      setIsFetching(true)
      const response = await fetch('/api/invitations')
      if (response.ok) {
        const data = await response.json()
        setInvitations(data.invitations || [])
      }
    } catch (error) {
      console.error('Error fetching invitations:', error)
    } finally {
      setIsFetching(false)
    }
  }

  const handleCreateInvitation = async () => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresDays })
      })

      if (response.ok) {
        const data = await response.json()
        setNewCode(data.invitation.code)
        toast.success('Invitation code created successfully!')
        fetchInvitations()
      } else {
        const data = await response.json()
        toast.error(data.error || 'Failed to create invitation code')
      }
    } catch (error) {
      toast.error('Failed to create invitation code')
    } finally {
      setIsLoading(false)
    }
  }

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code)
    setCopiedCode(code)
    toast.success('Code copied to clipboard!')
    setTimeout(() => setCopiedCode(null), 2000)
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Never'
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  const isExpired = (invitation: Invitation) => {
    if (!invitation.expiresAt) return false
    return new Date() > new Date(invitation.expiresAt)
  }

  // Don't render if not super admin
  if (session?.user?.role !== 'SUPER_ADMIN') {
    return null
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Settings</h1>
        <p className="text-gray-600 dark:text-gray-400">Manage invitation codes for new admins</p>
      </div>

      {/* Create New Invitation */}
      <Card>
        <CardHeader>
          <CardTitle>Create Invitation Code</CardTitle>
          <CardDescription>
            Generate a new invitation code to allow someone to sign up as an admin
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label htmlFor="expiresDays" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Valid for (days)
            </label>
            <Input
              id="expiresDays"
              type="number"
              value={expiresDays}
              onChange={(e) => setExpiresDays(Number(e.target.value))}
              min="1"
              max="365"
              className="max-w-xs"
            />
            <p className="mt-1 text-xs text-gray-500">Invitation code will expire after this many days</p>
          </div>

          <Button
            onClick={handleCreateInvitation}
            disabled={isLoading}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              'Generate Invitation Code'
            )}
          </Button>

          {newCode && (
            <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md">
              <p className="text-sm font-semibold text-green-800 dark:text-green-200 mb-2">
                Invitation Code Created!
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 bg-white dark:bg-gray-800 border border-green-300 dark:border-green-700 rounded text-sm font-mono text-green-900 dark:text-green-100">
                  {newCode}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleCopyCode(newCode)}
                  className="border-green-300 dark:border-green-700"
                >
                  {copiedCode === newCode ? (
                    <Check className="h-4 w-4 text-green-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="mt-2 text-xs text-green-700 dark:text-green-300">
                Share this code with the person you want to invite. They'll need it to sign up.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Existing Invitations */}
      <Card>
        <CardHeader>
          <CardTitle>Invitation Codes</CardTitle>
          <CardDescription>View all invitation codes and their status</CardDescription>
        </CardHeader>
        <CardContent>
          {isFetching ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : invitations.length === 0 ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              No invitation codes yet. Create one above.
            </div>
          ) : (
            <div className="space-y-3">
              {invitations.map((invitation) => (
                <div
                  key={invitation.id}
                  className={`p-4 border rounded-md ${
                    invitation.used
                      ? 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                      : isExpired(invitation)
                      ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'
                      : 'bg-white dark:bg-gray-900 border-green-200 dark:border-green-800'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <code className="text-lg font-mono font-bold text-gray-900 dark:text-gray-100">
                          {invitation.code}
                        </code>
                        {invitation.used && (
                          <span className="px-2 py-1 text-xs font-semibold bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded">
                            USED
                          </span>
                        )}
                        {!invitation.used && isExpired(invitation) && (
                          <span className="px-2 py-1 text-xs font-semibold bg-yellow-200 dark:bg-yellow-800 text-yellow-800 dark:text-yellow-200 rounded">
                            EXPIRED
                          </span>
                        )}
                        {!invitation.used && !isExpired(invitation) && (
                          <span className="px-2 py-1 text-xs font-semibold bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200 rounded">
                            ACTIVE
                          </span>
                        )}
                      </div>
                      <div className="mt-2 text-sm text-gray-600 dark:text-gray-400 space-y-1">
                        <p>Created: {formatDate(invitation.createdAt)}</p>
                        <p>Expires: {formatDate(invitation.expiresAt)}</p>
                        {invitation.used && (
                          <p>Used: {formatDate(invitation.usedAt)}</p>
                        )}
                      </div>
                    </div>
                    {!invitation.used && !isExpired(invitation) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleCopyCode(invitation.code)}
                      >
                        {copiedCode === invitation.code ? (
                          <Check className="h-4 w-4 text-green-600" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    )}
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
