'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Calendar, Users, Clock, Link2 } from 'lucide-react'

interface PublishedAuction {
  id: string
  slug: string | null
  name: string
  description: string | null
  image: string | null
  rules: any
  status: string
  isPublished: boolean
  registrationOpen: boolean
  createdAt: string
  scheduledStartDate: string | null
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

  const formatStartDateTime = (isoDate: string | null) => {
    if (!isoDate) {
      return 'Start time TBD'
    }
    const date = new Date(isoDate)
    if (Number.isNaN(date.getTime())) {
      return 'Start time TBD'
    }
    const datePart = date.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    })
    const timePart = date.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit'
    })
    return `${datePart} • ${timePart}`
  }

  const getAuctionUrl = (auction: PublishedAuction) => {
    const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || ''
    const path = `/auction/${auction.slug || auction.id}`
    return base ? `${base}${path}` : path
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
              <a href="https://professio.ai/?utm_source=squady&utm_medium=referral&utm_campaign=powered_by_badge" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800 shadow-sm hover:from-purple-100 hover:to-pink-100 dark:hover:from-purple-900/30 dark:hover:to-pink-900/30 animate-pulse">
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
            Live Auctions
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-300 mb-8 max-w-3xl mx-auto">
            Discover every active auction in one place. Review the details, preview the auction room, and copy the live link before sharing with your bidders.
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
              {auctions.map((auction) => {
                const auctionUrl = getAuctionUrl(auction)
                return (
                  <Card key={auction.id} className="hover:shadow-xl transition-shadow flex flex-col overflow-hidden">
                    <div className="relative aspect-video bg-gray-200 dark:bg-gray-800">
                      {auction.image ? (
                        <Image
                          src={auction.image}
                          alt={auction.name}
                          fill
                          className="object-contain p-4"
                          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                          priority={false}
                        />
                      ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 dark:text-gray-400">
                          <span className="text-sm">No cover image</span>
                        </div>
                      )}
                      <div className="absolute top-3 left-3">
                        {getStatusBadge(auction.status, auction.registrationOpen)}
                      </div>
                    </div>

                    <CardHeader>
                      <div className="flex justify-between items-start mb-2">
                        <CardTitle className="text-xl leading-tight line-clamp-2">
                          {auction.name}
                        </CardTitle>
                      </div>
                      <CardDescription className="text-sm line-clamp-3">
                        {auction.description || 'No description available'}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4 flex-1 flex flex-col">
                      <div className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4" />
                          <span>{formatStartDateTime(auction.scheduledStartDate)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Users className="h-4 w-4" />
                          <span>{auction._count.bidders} teams • {auction._count.players} players loaded</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4" />
                          <span>Min bid ₹{auction.rules?.minBidIncrement?.toLocaleString('en-IN') || '—'} · {auction.rules?.countdownSeconds || 0}s countdown</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Link2 className="h-4 w-4" />
                          <Link
                            href={auctionUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 dark:text-blue-400 underline truncate"
                          >
                            {auction.name}
                          </Link>
                        </div>
                      </div>

                      <div className="pt-4 mt-auto">
                        <Button disabled className="w-full bg-gray-400 dark:bg-gray-700 cursor-not-allowed">
                          Registration Disabled
                        </Button>
                        <p className="text-xs text-center text-gray-600 dark:text-gray-400 mt-2">
                          Admins will keep the registration controls to themselves
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
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
