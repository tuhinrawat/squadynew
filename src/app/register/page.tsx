'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { SiteNav } from '@/components/site-nav'
import { SiteFooter } from '@/components/site-footer'
import { Calendar, Users, Clock, Link2, Check, Copy } from 'lucide-react'

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
  const [completedAuctions, setCompletedAuctions] = useState<PublishedAuction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

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
        setCompletedAuctions(data.completedAuctions || [])
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
    if (status === 'COMPLETED') {
      return <Badge className="bg-white/10 text-white/60 border-0">Completed</Badge>
    }
    if (!registrationOpen) {
      return <Badge className="bg-white/10 text-white/60 border-0">Registration Closed</Badge>
    }
    const styles: Record<string, string> = {
      DRAFT: 'bg-white/10 text-white/60',
      LIVE: 'bg-teal-400/20 text-teal-300',
      MOCK_RUN: 'bg-purple-400/20 text-purple-300',
      PAUSED: 'bg-amber-400/20 text-amber-300',
    }
    return <Badge className={`${styles[status] || styles.DRAFT} border-0`}>{status === 'LIVE' ? '● LIVE' : status}</Badge>
  }

  const formatStartDateTime = (isoDate: string | null) => {
    if (!isoDate) return 'Start time TBD'
    const date = new Date(isoDate)
    if (Number.isNaN(date.getTime())) return 'Start time TBD'
    const datePart = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    const timePart = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    return `${datePart} • ${timePart}`
  }

  const getAuctionUrl = (auction: PublishedAuction) => {
    const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || ''
    const path = `/auction/${auction.slug || auction.id}`
    return base ? `${base}${path}` : path
  }

  const copyLink = async (auction: PublishedAuction) => {
    try {
      await navigator.clipboard.writeText(getAuctionUrl(auction))
      setCopiedId(auction.id)
      setTimeout(() => setCopiedId((current) => (current === auction.id ? null : current)), 1800)
    } catch {
      // Clipboard access can be denied (permissions, non-secure context) -
      // the link text is already visible and selectable either way.
    }
  }

  return (
    <div className="dark min-h-screen flex flex-col bg-[#05070a] text-white">
      <SiteNav active="auctions" />

      <div className="flex-1">
        <section className="max-w-6xl mx-auto px-5 sm:px-8 py-16 text-center">
          <div className="text-xs font-bold uppercase tracking-[0.14em] text-teal-400 mb-4">Right now, across Squady</div>
          <h1 className="text-4xl sm:text-5xl font-black uppercase mb-4">Live Auctions</h1>
          <p className="text-base sm:text-lg text-white/60 max-w-[560px] mx-auto">
            Every published auction in one place. Open the room, check who&apos;s playing, and copy the link to share with your bidders.
          </p>
        </section>

        <section className="max-w-6xl mx-auto px-5 sm:px-8 pb-16">
          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-400 mx-auto"></div>
              <p className="mt-4 text-white/50">Loading auctions...</p>
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <div className="text-red-400 mb-4">{error}</div>
              <Button onClick={fetchPublishedAuctions}>Try Again</Button>
            </div>
          ) : (
            <>
              <h2 className="text-xs font-bold uppercase tracking-wider text-white/45 mb-5">Live &amp; Upcoming</h2>
              {auctions.length === 0 ? (
                <div className="text-center py-12 rounded-2xl border border-white/[0.07] bg-[#0c1116] mb-16">
                  <h3 className="text-xl font-bold mb-3">No Published Auctions</h3>
                  <p className="text-white/50 mb-6">There are currently no published auctions available for registration.</p>
                  <Link href="/"><Button>Back to Home</Button></Link>
                </div>
              ) : (
                <div className="grid gap-6 mb-16" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
                  {auctions.map((auction) => {
                    const auctionUrl = getAuctionUrl(auction)
                    return (
                      <div key={auction.id} className="rounded-2xl border border-white/[0.07] bg-[#0c1116] overflow-hidden flex flex-col">
                        <div className="relative aspect-video bg-gradient-to-br from-[#1c2b2a] to-[#05070a]">
                          {auction.image ? (
                            <Image src={auction.image} alt={auction.name} fill className="object-contain p-4" sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw" />
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center text-white/30 text-sm">No cover image</div>
                          )}
                          <div className="absolute top-3 left-3">{getStatusBadge(auction.status, auction.registrationOpen)}</div>
                        </div>
                        <div className="p-6 flex flex-col gap-4 flex-1">
                          <h3 className="text-lg font-bold leading-tight line-clamp-2">{auction.name}</h3>
                          <p className="text-sm text-white/50 line-clamp-3">{auction.description || 'No description available'}</p>
                          <div className="flex flex-col gap-2 text-sm text-white/60">
                            <div className="flex items-center gap-2"><Calendar className="h-4 w-4" /><span>{formatStartDateTime(auction.scheduledStartDate)}</span></div>
                            <div className="flex items-center gap-2"><Users className="h-4 w-4" /><span>{auction._count.bidders} teams • {auction._count.players} players loaded</span></div>
                            <div className="flex items-center gap-2"><Clock className="h-4 w-4" /><span>Min bid ₹{auction.rules?.minBidIncrement?.toLocaleString('en-IN') || '—'} · {auction.rules?.countdownSeconds || 0}s countdown</span></div>
                            <div className="flex items-center gap-2 min-w-0">
                              <Link2 className="h-4 w-4 flex-shrink-0" />
                              <Link href={auctionUrl} target="_blank" rel="noopener noreferrer" className="text-teal-400 underline truncate">{auction.name}</Link>
                            </div>
                          </div>
                          <div className="pt-2 mt-auto">
                            <Button disabled className="w-full bg-white/10 text-white/40 cursor-not-allowed">Registration Disabled</Button>
                            <p className="text-xs text-center text-white/40 mt-2">Admins will keep the registration controls to themselves</p>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Completed auctions stay public - the point is that anyone
                  with the link can still reach the final rosters and sale
                  prices after the auction itself has ended. */}
              {completedAuctions.length > 0 && (
                <>
                  <h2 className="text-xs font-bold uppercase tracking-wider text-white/45 mb-1.5">Completed Auctions</h2>
                  <p className="text-sm text-white/40 mb-5">Still public — anyone with the link can view the final rosters and results.</p>
                  <div className="grid gap-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
                    {completedAuctions.map((auction) => {
                      const auctionUrl = getAuctionUrl(auction)
                      const copied = copiedId === auction.id
                      return (
                        <div key={auction.id} className="rounded-2xl border border-white/[0.07] bg-[#0c1116] overflow-hidden flex flex-col">
                          <div className="relative aspect-video bg-gradient-to-br from-[#101820] to-[#05070a]">
                            {auction.image ? (
                              <Image src={auction.image} alt={auction.name} fill className="object-contain p-4" sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw" />
                            ) : (
                              <div className="absolute inset-0 flex items-center justify-center text-white/30 text-sm">No cover image</div>
                            )}
                            <div className="absolute top-3 left-3">{getStatusBadge(auction.status, auction.registrationOpen)}</div>
                          </div>
                          <div className="p-6 flex flex-col gap-4 flex-1">
                            <h3 className="text-lg font-bold leading-tight line-clamp-2">{auction.name}</h3>
                            <p className="text-sm text-white/50 line-clamp-3">{auction.description || 'No description available'}</p>
                            <div className="flex flex-col gap-2 text-sm text-white/60">
                              <div className="flex items-center gap-2"><Calendar className="h-4 w-4" /><span>{formatStartDateTime(auction.scheduledStartDate)}</span></div>
                              <div className="flex items-center gap-2"><Users className="h-4 w-4" /><span>{auction._count.bidders} teams • {auction._count.players} players loaded</span></div>
                            </div>
                            <div className="flex items-center gap-2 mt-auto px-3 py-2.5 rounded-lg bg-white/[0.04] border border-white/[0.07]">
                              <Link2 className="h-3.5 w-3.5 text-teal-400 flex-shrink-0" />
                              <Link href={auctionUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-teal-400 truncate flex-1 min-w-0">
                                {auctionUrl.replace(/^https?:\/\//, '')}
                              </Link>
                              <button
                                type="button"
                                onClick={() => copyLink(auction)}
                                className="flex-shrink-0 inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-teal-400/15 text-teal-300 text-[11px] font-bold hover:bg-teal-400/25 transition-colors"
                              >
                                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                {copied ? 'Copied' : 'Copy'}
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </>
          )}
        </section>
      </div>

      <SiteFooter />
    </div>
  )
}
