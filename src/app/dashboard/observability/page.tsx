'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, RefreshCw, AlertTriangle, Activity, Zap, ShieldAlert } from 'lucide-react'

interface BreakdownRow {
  category: string
  eventName: string
  success: boolean
  count: number
  avgLatencyMs: number | null
}

interface FailureRow {
  id: string
  category: string
  eventName: string
  auctionId: string | null
  message: string | null
  latencyMs: number | null
  createdAt: string
  metadata: unknown
}

interface Summary {
  range: string
  since: string
  totalCount: number
  failureCount: number
  successRate: number
  breakdown: BreakdownRow[]
  recentFailures: FailureRow[]
  bidsPerMinute: Array<{ minute: string; count: number }>
  auctions: Array<{ id: string; name: string }>
}

const RANGE_OPTIONS = [
  { value: '1h', label: 'Last hour' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
]

function formatPct(n: number) {
  return `${(n * 100).toFixed(1)}%`
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export default function ObservabilityPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [range, setRange] = useState('24h')
  const [auctionId, setAuctionId] = useState<string>('all')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (status === 'authenticated' && session?.user?.role !== 'SUPER_ADMIN') {
      router.push('/dashboard')
    }
  }, [session, status, router])

  const fetchSummary = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ range })
      if (auctionId !== 'all') params.set('auctionId', auctionId)
      const response = await fetch(`/api/observability/summary?${params.toString()}`)
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to load observability data')
      }
      const data = await response.json()
      setSummary(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load observability data')
    } finally {
      setIsLoading(false)
    }
  }, [range, auctionId])

  useEffect(() => {
    fetchSummary()
  }, [fetchSummary])

  // Light auto-refresh - this is the kind of page someone leaves open during
  // a live auction, not a one-time report.
  useEffect(() => {
    const interval = setInterval(fetchSummary, 30000)
    return () => clearInterval(interval)
  }, [fetchSummary])

  if (status !== 'authenticated' || session?.user?.role !== 'SUPER_ADMIN') {
    return null
  }

  const pusherRows = summary?.breakdown.filter(r => r.category === 'pusher') ?? []
  const rateLimitRows = summary?.breakdown.filter(r => r.category === 'rate_limit') ?? []
  const maxBidsPerMinute = Math.max(1, ...(summary?.bidsPerMinute.map(b => b.count) ?? [1]))

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Observability</h1>
          <p className="text-gray-600 dark:text-gray-400">Pusher health, rate limits, and live auction signal - platform-wide</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={auctionId} onValueChange={setAuctionId}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="All auctions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All auctions</SelectItem>
              {summary?.auctions.map(a => (
                <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={range} onValueChange={setRange}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGE_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            onClick={fetchSummary}
            className="p-2 rounded-md border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
            title="Refresh now"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <Card className="border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
          <CardContent className="pt-6 text-sm text-red-700 dark:text-red-300">{error}</CardContent>
        </Card>
      )}

      {isLoading && !summary ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : summary && summary.totalCount === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center py-10 text-gray-500 dark:text-gray-400 text-sm">
            No events recorded in this window yet. This fills in as Pusher triggers, rate-limit checks, and bids happen -
            try a live or recently-active auction, or widen the time range.
          </CardContent>
        </Card>
      ) : summary && (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">Total Events</CardTitle>
                <Activity className="h-4 w-4 text-gray-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{summary.totalCount.toLocaleString('en-IN')}</div>
                <p className="text-xs text-gray-500 mt-1">Pusher triggers + rate-limit checks</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">Success Rate</CardTitle>
                <Zap className="h-4 w-4 text-gray-400" />
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${summary.successRate < 0.95 ? 'text-red-600' : 'text-green-600'}`}>
                  {formatPct(summary.successRate)}
                </div>
                <p className="text-xs text-gray-500 mt-1">Below 95% needs a look</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">Failures</CardTitle>
                <ShieldAlert className="h-4 w-4 text-gray-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{summary.failureCount.toLocaleString('en-IN')}</div>
                <p className="text-xs text-gray-500 mt-1">Pusher trigger failures + rate-limit rejections</p>
              </CardContent>
            </Card>
          </div>

          {/* Bids per minute */}
          {summary.bidsPerMinute.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Bids per Minute</CardTitle>
                <CardDescription>A flatline mid-auction is the earliest sign something broke</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-end gap-0.5 h-24 overflow-x-auto pb-1">
                  {summary.bidsPerMinute.map((b, i) => (
                    <div
                      key={i}
                      className="bg-blue-500 dark:bg-blue-400 rounded-t-sm flex-shrink-0"
                      style={{ height: `${Math.max(4, (b.count / maxBidsPerMinute) * 96)}px`, width: '6px' }}
                      title={`${new Date(b.minute).toLocaleTimeString('en-IN')}: ${b.count} bid${b.count !== 1 ? 's' : ''}`}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Pusher breakdown */}
            <Card>
              <CardHeader>
                <CardTitle>Pusher Events by Type</CardTitle>
                <CardDescription>Trigger success/failure and average latency, per event</CardDescription>
              </CardHeader>
              <CardContent>
                {pusherRows.length === 0 ? (
                  <p className="text-sm text-gray-500 py-4">No Pusher events in this window.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-gray-500 uppercase border-b border-gray-200 dark:border-gray-700">
                          <th className="pb-2 pr-2">Event</th>
                          <th className="pb-2 pr-2">Status</th>
                          <th className="pb-2 pr-2 text-right">Count</th>
                          <th className="pb-2 text-right">Avg latency</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pusherRows.map((row, i) => (
                          <tr key={i} className="border-b border-gray-100 dark:border-gray-800 last:border-0">
                            <td className="py-2 pr-2 font-mono text-xs">{row.eventName}</td>
                            <td className="py-2 pr-2">
                              <Badge className={row.success ? 'bg-green-100 text-green-700 border-0' : 'bg-red-100 text-red-700 border-0'}>
                                {row.success ? 'OK' : 'FAILED'}
                              </Badge>
                            </td>
                            <td className="py-2 pr-2 text-right">{row.count}</td>
                            <td className="py-2 text-right text-gray-500">{row.avgLatencyMs !== null ? `${row.avgLatencyMs}ms` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Rate limit breakdown */}
            <Card>
              <CardHeader>
                <CardTitle>Rate Limit Rejections</CardTitle>
                <CardDescription>Previously invisible outside a single console.log line</CardDescription>
              </CardHeader>
              <CardContent>
                {rateLimitRows.length === 0 ? (
                  <p className="text-sm text-gray-500 py-4">No rejections in this window - either nobody hit the limit, or nobody&apos;s bidding right now.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-gray-500 uppercase border-b border-gray-200 dark:border-gray-700">
                          <th className="pb-2 pr-2">Route</th>
                          <th className="pb-2 text-right">Rejections</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rateLimitRows.map((row, i) => (
                          <tr key={i} className="border-b border-gray-100 dark:border-gray-800 last:border-0">
                            <td className="py-2 pr-2 font-mono text-xs">{row.eventName}</td>
                            <td className="py-2 text-right text-red-600 font-semibold">{row.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Recent failures feed */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Recent Failures
              </CardTitle>
              <CardDescription>Latest 25 failed Pusher triggers or rejected requests, newest first</CardDescription>
            </CardHeader>
            <CardContent>
              {summary.recentFailures.length === 0 ? (
                <p className="text-sm text-gray-500 py-4">Nothing failed in this window.</p>
              ) : (
                <div className="space-y-2">
                  {summary.recentFailures.map(f => (
                    <div key={f.id} className="flex items-start justify-between gap-3 p-3 rounded-md bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs font-semibold text-gray-900 dark:text-gray-100">{f.category}/{f.eventName}</span>
                          <span className="text-xs text-gray-400">{formatTime(f.createdAt)}</span>
                          {f.latencyMs !== null && <span className="text-xs text-gray-400">{f.latencyMs}ms</span>}
                        </div>
                        {f.message && <p className="text-xs text-red-700 dark:text-red-300 mt-1 break-words">{f.message}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
