'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, RefreshCw, AlertTriangle, Activity, Zap, ShieldAlert, Radio, Timer, Wifi, HeartPulse, BellRing, History } from 'lucide-react'

interface BreakdownRow {
  category: string
  eventName: string
  success: boolean
  count: number
  avgLatencyMs: number | null
}

interface Diagnosis {
  severity: 'failure' | 'slow'
  summary: string
  likelyCause: string
  likelyFix: string
  confidence: 'high' | 'medium' | 'low'
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
  diagnosis: Diagnosis | null
}

interface Summary {
  range: string
  since: string
  totalCount: number
  failureCount: number
  successRate: number
  breakdown: BreakdownRow[]
  recentFailures: FailureRow[]
  slowEvents: FailureRow[]
  bidsPerMinute: Array<{ minute: string; count: number }>
  auctions: Array<{ id: string; name: string }>
  syncLag: { avgMs: number | null; maxMs: number | null; sampleCount: number }
  connectionHealth: { connected: number; connection_error: number; rebind: number }
  latestCanary: { success: boolean; latencyMs: number | null; createdAt: string; message: string | null } | null
  alertingConfigured: boolean
  recentAlerts: Array<{ eventName: string; message: string | null; createdAt: string }>
}

interface PusherChannelStatus {
  channel: string
  auctionId: string
  auctionName: string | null
  auctionStatus: string | null
  subscriptionCount: number
}

interface PusherStatus {
  totalChannels: number
  totalSubscribers: number
  channels: PusherChannelStatus[]
  connectionCeiling: { maxConnections: number; usedPercent: number | null }
  broadcastsToday: number
}

interface TimelineEvent {
  id: string
  category: string
  eventName: string
  success: boolean
  latencyMs: number | null
  message: string | null
  createdAt: string
  diagnosis: Diagnosis | null
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

  // Live Pusher connection panel - deliberately separate from the
  // range/auction-filtered summary above: this is "right now" headroom, not
  // a historical window, so it always reflects the full account regardless
  // of what's selected up top, and refreshes faster since that's the point.
  const [pusherStatus, setPusherStatus] = useState<PusherStatus | null>(null)
  const [pusherStatusError, setPusherStatusError] = useState<string | null>(null)

  const fetchPusherStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/observability/pusher-status')
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to reach Pusher')
      }
      setPusherStatus(await response.json())
      setPusherStatusError(null)
    } catch (err) {
      setPusherStatusError(err instanceof Error ? err.message : 'Failed to reach Pusher')
    }
  }, [])

  useEffect(() => {
    fetchPusherStatus()
    const interval = setInterval(fetchPusherStatus, 10000)
    return () => clearInterval(interval)
  }, [fetchPusherStatus])

  // Single-auction timeline - only meaningful once a specific auction is
  // selected, since a merged feed across every auction ever run isn't a
  // "what happened during this incident" view, it's noise.
  const [timeline, setTimeline] = useState<TimelineEvent[]>([])
  const [timelineTruncated, setTimelineTruncated] = useState(false)
  const [timelineLoading, setTimelineLoading] = useState(false)
  const [timelineError, setTimelineError] = useState<string | null>(null)

  const fetchTimeline = useCallback(async () => {
    if (auctionId === 'all') return
    setTimelineLoading(true)
    setTimelineError(null)
    try {
      const response = await fetch(`/api/observability/timeline?auctionId=${encodeURIComponent(auctionId)}`)
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to load timeline')
      }
      const data = await response.json()
      setTimeline(data.events)
      setTimelineTruncated(data.truncated)
    } catch (err) {
      setTimelineError(err instanceof Error ? err.message : 'Failed to load timeline')
    } finally {
      setTimelineLoading(false)
    }
  }, [auctionId])

  useEffect(() => {
    fetchTimeline()
  }, [fetchTimeline])

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

      {/* Live Pusher connections - "how close are we to the ceiling right
          now," independent of the range/auction filters above */}
      <Card className="border-blue-200 dark:border-blue-900">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-blue-500" />
            Live Connections
          </CardTitle>
          <CardDescription>
            Occupied auction channels and subscriber counts, straight from Pusher&apos;s API - right now, not a historical window.
            The connection ceiling below is a manually-configured plan limit, and &quot;broadcasts today&quot; is this app&apos;s own
            trigger count (a proxy for message volume, not Pusher&apos;s real quota) - check Pusher&apos;s own dashboard for the authoritative number.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {pusherStatusError ? (
            <p className="text-sm text-red-600 dark:text-red-400">{pusherStatusError}</p>
          ) : !pusherStatus ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking Pusher...
            </div>
          ) : (
            <div>
              <div className="flex flex-wrap gap-6 mb-3 text-sm">
                <div><span className="text-gray-500">Active auctions:</span> <span className="font-bold text-gray-900 dark:text-gray-100">{pusherStatus.totalChannels}</span></div>
                <div><span className="text-gray-500">Total subscribers:</span> <span className="font-bold text-gray-900 dark:text-gray-100">{pusherStatus.totalSubscribers}</span></div>
                <div>
                  <span className="text-gray-500">Connection ceiling:</span>{' '}
                  <span className={`font-bold ${(pusherStatus.connectionCeiling.usedPercent ?? 0) > 80 ? 'text-red-600' : 'text-gray-900 dark:text-gray-100'}`}>
                    {pusherStatus.totalSubscribers}/{pusherStatus.connectionCeiling.maxConnections}
                    {pusherStatus.connectionCeiling.usedPercent !== null && ` (${pusherStatus.connectionCeiling.usedPercent}%)`}
                  </span>
                </div>
                <div><span className="text-gray-500">Broadcasts today:</span> <span className="font-bold text-gray-900 dark:text-gray-100">{pusherStatus.broadcastsToday.toLocaleString('en-IN')}</span></div>
              </div>
              {pusherStatus.totalChannels === 0 ? (
                <p className="text-sm text-gray-500 py-2">No auction channels are occupied right now - nobody has an auction page open.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500 uppercase border-b border-gray-200 dark:border-gray-700">
                        <th className="pb-2 pr-2">Auction</th>
                        <th className="pb-2 pr-2">Status</th>
                        <th className="pb-2 text-right">Subscribers</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pusherStatus.channels.map(c => (
                        <tr key={c.channel} className="border-b border-gray-100 dark:border-gray-800 last:border-0">
                          <td className="py-2 pr-2">{c.auctionName ?? <span className="font-mono text-xs text-gray-400">{c.auctionId}</span>}</td>
                          <td className="py-2 pr-2">
                            {c.auctionStatus && <Badge className="bg-gray-100 text-gray-700 border-0">{c.auctionStatus}</Badge>}
                          </td>
                          <td className="py-2 text-right font-semibold">{c.subscriptionCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
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
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">Sync Lag</CardTitle>
                <Timer className="h-4 w-4 text-gray-400" />
              </CardHeader>
              <CardContent>
                {summary.syncLag.sampleCount > 0 ? (
                  <>
                    <div className={`text-2xl font-bold ${(summary.syncLag.avgMs ?? 0) > 2000 ? 'text-red-600' : 'text-gray-900 dark:text-gray-100'}`}>
                      {summary.syncLag.avgMs}ms
                    </div>
                    <p className="text-xs text-gray-500 mt-1">avg · {summary.syncLag.maxMs}ms max · {summary.syncLag.sampleCount} reports (~20% sampled)</p>
                  </>
                ) : (
                  <>
                    <div className="text-2xl font-bold text-gray-400">—</div>
                    <p className="text-xs text-gray-500 mt-1">No bidder browsers reporting yet</p>
                  </>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">Connection Health</CardTitle>
                <Wifi className="h-4 w-4 text-gray-400" />
              </CardHeader>
              <CardContent>
                <div className="flex gap-3 text-sm">
                  <span className="text-green-600 font-bold">{summary.connectionHealth.connected}</span>
                  <span className="text-red-600 font-bold">{summary.connectionHealth.connection_error}</span>
                  <span className="text-amber-600 font-bold">{summary.connectionHealth.rebind}</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">connected · errors · rebinds needed</p>
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

          {/* Synthetic heartbeat + alerting status - the "is anyone watching
              right now" panel. Independent of live traffic on purpose. */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <HeartPulse className="h-4 w-4 text-pink-500" />
                  System Heartbeat
                </CardTitle>
                <CardDescription>A scheduled Pusher + database round-trip, independent of real bidder traffic</CardDescription>
              </CardHeader>
              <CardContent>
                {!summary.latestCanary ? (
                  <p className="text-sm text-gray-500 py-2">No heartbeat recorded yet - the scheduled check hasn&apos;t run, or hasn&apos;t been set up. See setup notes.</p>
                ) : (
                  <div className="flex items-center gap-3">
                    <Badge className={summary.latestCanary.success ? 'bg-green-100 text-green-700 border-0' : 'bg-red-100 text-red-700 border-0'}>
                      {summary.latestCanary.success ? 'Healthy' : 'Failing'}
                    </Badge>
                    <span className="text-sm text-gray-500">
                      last checked {formatTime(summary.latestCanary.createdAt)}
                      {summary.latestCanary.latencyMs !== null && ` · ${summary.latestCanary.latencyMs}ms`}
                    </span>
                  </div>
                )}
                {summary.latestCanary && !summary.latestCanary.success && summary.latestCanary.message && (
                  <p className="text-xs text-red-600 dark:text-red-400 mt-2">{summary.latestCanary.message}</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BellRing className="h-4 w-4 text-amber-500" />
                  Alerting
                </CardTitle>
                <CardDescription>Pushes to a webhook when thresholds are breached, instead of waiting for someone to open this page</CardDescription>
              </CardHeader>
              <CardContent>
                <Badge className={summary.alertingConfigured ? 'bg-green-100 text-green-700 border-0' : 'bg-gray-100 text-gray-600 border-0'}>
                  {summary.alertingConfigured ? 'Webhook configured' : 'Not configured'}
                </Badge>
                {summary.recentAlerts.length === 0 ? (
                  <p className="text-sm text-gray-500 mt-2">No alerts fired recently.</p>
                ) : (
                  <div className="mt-2 space-y-1">
                    {summary.recentAlerts.map((a, i) => (
                      <p key={i} className="text-xs text-amber-700 dark:text-amber-400">
                        {formatTime(a.createdAt)} · {a.eventName}
                      </p>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

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
                    <div key={f.id} className="p-3 rounded-md bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-semibold text-gray-900 dark:text-gray-100">{f.category}/{f.eventName}</span>
                        <span className="text-xs text-gray-400">{formatTime(f.createdAt)}</span>
                        {f.latencyMs !== null && <span className="text-xs text-gray-400">{f.latencyMs}ms</span>}
                      </div>
                      {f.message && <p className="text-xs text-red-700 dark:text-red-300 mt-1 break-words">{f.message}</p>}
                      {f.diagnosis && (
                        <div className="mt-2 pt-2 border-t border-red-200 dark:border-red-900/40 text-xs space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-gray-800 dark:text-gray-200">{f.diagnosis.summary}</span>
                            <Badge className={`border-0 text-[10px] ${f.diagnosis.confidence === 'high' ? 'bg-emerald-100 text-emerald-700' : f.diagnosis.confidence === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                              {f.diagnosis.confidence} confidence
                            </Badge>
                          </div>
                          <p className="text-gray-600 dark:text-gray-400"><span className="font-medium">Likely cause:</span> {f.diagnosis.likelyCause}</p>
                          <p className="text-gray-600 dark:text-gray-400"><span className="font-medium">Likely fix:</span> {f.diagnosis.likelyFix}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Slow-but-successful calls - "clogging" before it becomes a
              failure: latency crossing a threshold without an outright error. */}
          <Card className="border-amber-200 dark:border-amber-900">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-amber-500" />
                Slow Calls
              </CardTitle>
              <CardDescription>Calls that succeeded but took unusually long - often the first sign of clogging before it turns into outright failures</CardDescription>
            </CardHeader>
            <CardContent>
              {summary.slowEvents.length === 0 ? (
                <p className="text-sm text-gray-500 py-4">Nothing unusually slow in this window.</p>
              ) : (
                <div className="space-y-2">
                  {summary.slowEvents.map(s => (
                    <div key={s.id} className="p-3 rounded-md bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/30">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-semibold text-gray-900 dark:text-gray-100">{s.category}/{s.eventName}</span>
                        <span className="text-xs text-gray-400">{formatTime(s.createdAt)}</span>
                        {s.latencyMs !== null && <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">{s.latencyMs}ms</span>}
                      </div>
                      {s.diagnosis && (
                        <div className="mt-2 pt-2 border-t border-amber-200 dark:border-amber-900/40 text-xs space-y-1">
                          <p className="text-gray-600 dark:text-gray-400"><span className="font-medium">Likely cause:</span> {s.diagnosis.likelyCause}</p>
                          <p className="text-gray-600 dark:text-gray-400"><span className="font-medium">Likely fix:</span> {s.diagnosis.likelyFix}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Single-auction timeline - only makes sense once one auction is
              picked; a merged feed across every auction ever run is noise,
              not an incident replay. */}
          {auctionId !== 'all' && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <History className="h-4 w-4 text-indigo-500" />
                  Auction Timeline
                </CardTitle>
                <CardDescription>
                  Every event for this auction, merged and in order - correlate a rate-limit rejection against the sync-lag
                  spike and connection errors that followed it. Shows the most recent {timelineTruncated ? '500 (older events cut off)' : `${timeline.length}`} events.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {timelineError ? (
                  <p className="text-sm text-red-600 dark:text-red-400">{timelineError}</p>
                ) : timelineLoading && timeline.length === 0 ? (
                  <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading timeline...
                  </div>
                ) : timeline.length === 0 ? (
                  <p className="text-sm text-gray-500 py-4">No events recorded for this auction yet.</p>
                ) : (
                  <div className="max-h-96 overflow-y-auto space-y-1">
                    {timeline.map(ev => (
                      <div key={ev.id} className="text-sm py-1.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
                        <div className="flex items-start gap-3">
                          <span className="text-xs text-gray-400 w-32 flex-shrink-0 pt-0.5">{formatTime(ev.createdAt)}</span>
                          <Badge className={`flex-shrink-0 ${ev.success ? 'bg-gray-100 text-gray-700' : 'bg-red-100 text-red-700'} border-0`}>
                            {ev.category}
                          </Badge>
                          <span className="font-mono text-xs text-gray-700 dark:text-gray-300 flex-shrink-0">{ev.eventName}</span>
                          {ev.latencyMs !== null && <span className="text-xs text-gray-400 flex-shrink-0">{ev.latencyMs}ms</span>}
                          {ev.message && <span className="text-xs text-red-600 dark:text-red-400 break-words min-w-0">{ev.message}</span>}
                        </div>
                        {ev.diagnosis && (
                          <div className="ml-[calc(8rem+1.5rem)] mt-1 text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                            <p><span className="font-medium">{ev.diagnosis.summary}</span> ({ev.diagnosis.confidence} confidence)</p>
                            <p>Cause: {ev.diagnosis.likelyCause}</p>
                            <p>Fix: {ev.diagnosis.likelyFix}</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
