'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Calendar, Users, Clock } from 'lucide-react'

interface PublishedAuction {
  id: string
  name: string
  description: string | null
  rules: any
  status: string
  isPublished: boolean
  registrationOpen: boolean
  createdAt: string
  _count: {
    players: number
    bidders: number
  }
}

export default function PlayerRegistration() {
  const [auctions, setAuctions] = useState<PublishedAuction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchPublishedAuctions()
  }, [])

  const fetchPublishedAuctions = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/auctions/published')
      const data = await response.json()
      
      if (response.ok) {
        setAuctions(data.auctions)
      } else {
        setError(data.error || 'Failed to fetch auctions')
      }
    } catch (error) {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const getStatusBadge = (status: string, registrationOpen: boolean) => {
    if (!registrationOpen) {
      return <Badge variant="secondary">Registration Closed</Badge>
    }
    
    const colors = {
      DRAFT: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
      LIVE: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      PAUSED: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
      COMPLETED: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
    }
    
    return (
      <Badge className={colors[status as keyof typeof colors] || colors.DRAFT}>
        {status}
      </Badge>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-teal-50 via-white to-blue-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      {/* Navigation */}
      <nav className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <Link href="/">
                <Image src="/squady-logo.svg" alt="Squady" width={120} height={40} className="h-10 w-auto" />
              </Link>
            </div>
            <div className="flex items-center space-x-2 sm:space-x-4">
              <a href="https://professio.ai/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800 shadow-sm hover:from-purple-100 hover:to-pink-100 dark:hover:from-purple-900/30 dark:hover:to-pink-900/30">
                <span className="hidden sm:inline">Powered by</span>
                <span className="font-semibold">Professio AI</span>
              </a>
              <Link href="/tutorial">
                <Button variant="ghost" className="text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800">
                  Tutorial
                </Button>
              </Link>
              <Link href="/signin" className="hidden md:block">
                <Button variant="ghost" className="text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800">
                  Sign In
                </Button>
              </Link>
              <Link href="/signup">
                <Button className="text-sm px-3 sm:px-4 bg-blue-600 hover:bg-blue-700 text-white">
                  <span className="hidden sm:inline">Get Started</span>
                  <span className="sm:hidden">Start</span>
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <div className="flex-1">
      {/* Hero Section */}
      <section className="relative py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto text-center">
          <h1 className="text-5xl md:text-6xl font-bold text-gray-900 dark:text-white mb-6">
            Player Registration
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-300 mb-8 max-w-3xl mx-auto">
            Register for upcoming sports auctions. Select an auction below and fill out the registration form to participate.
          </p>
        </div>
      </section>

      {/* Auctions Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600 mx-auto"></div>
              <p className="mt-4 text-gray-600 dark:text-gray-400">Loading auctions...</p>
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <div className="text-red-600 dark:text-red-400 mb-4">{error}</div>
              <Button onClick={fetchPublishedAuctions}>Try Again</Button>
            </div>
          ) : auctions.length === 0 ? (
            <div className="text-center py-12">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                No Published Auctions
              </h2>
              <p className="text-gray-600 dark:text-gray-400 mb-8">
                There are currently no published auctions available for registration.
              </p>
              <Link href="/">
                <Button>Back to Home</Button>
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {auctions.map((auction) => (
                <Card key={auction.id} className="hover:shadow-lg transition-shadow">
                  <CardHeader>
                    <div className="flex justify-between items-start mb-2">
                      <CardTitle className="text-xl">{auction.name}</CardTitle>
                      {getStatusBadge(auction.status, auction.registrationOpen)}
                    </div>
                    <CardDescription className="text-sm">
                      {auction.description || 'No description available'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center space-x-4 text-sm text-gray-600 dark:text-gray-400">
                      <div className="flex items-center">
                        <Users className="h-4 w-4 mr-1" />
                        {auction._count.players} players
                      </div>
                      <div className="flex items-center">
                        <Calendar className="h-4 w-4 mr-1" />
                        {new Date(auction.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    
                    {auction.rules && (
                      <div className="space-y-2">
                        {auction.rules.minBidIncrement && (
                          <div className="flex items-center text-sm text-gray-600 dark:text-gray-400">
                            Min bid: ₹{auction.rules.minBidIncrement.toLocaleString('en-IN')}
                          </div>
                        )}
                        {auction.rules.countdownSeconds && (
                          <div className="flex items-center text-sm text-gray-600 dark:text-gray-400">
                            <Clock className="h-4 w-4 mr-1" />
                            Countdown: {auction.rules.countdownSeconds}s
                          </div>
                        )}
                      </div>
                    )}

                    <div className="pt-4">
                      <Button disabled className="w-full bg-gray-400 dark:bg-gray-700 cursor-not-allowed">
                        Registration Disabled
                      </Button>
                      <p className="text-xs text-center text-gray-600 dark:text-gray-400 mt-2">
                        Admins will keep the registration controls to themselves
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </section>
      </div>

      {/* Footer */}
      <footer className="bg-gray-900 dark:bg-black text-white py-12 px-4 sm:px-6 lg:px-8 mt-auto">
        <div className="max-w-7xl mx-auto text-center">
          <h3 className="text-xl font-bold text-teal-400 mb-4">Squady</h3>
          <p className="text-gray-400 mb-4">
            Professional sports auction management platform
          </p>
          <div className="border-t border-gray-800 pt-8 text-gray-400">
            <p>&copy; 2024 Squady. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
