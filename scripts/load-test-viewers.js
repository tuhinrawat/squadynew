/**
 * k6 load test: simulates N concurrent public viewers watching a live
 * auction, the same way they actually behave in production.
 *
 * IMPORTANT - what this does and doesn't test:
 * Only the presenter link holds a live Pusher connection (see
 * src/components/public-auction-view.tsx - `usePusher` is only enabled
 * for isPresenter). Every regular public viewer polls
 * GET /api/auction/[id]/snapshot every 6 seconds instead - Pusher
 * connection/message volume in this app does NOT scale with audience
 * size by design. So "load testing Pusher for 1000 viewers" isn't a
 * meaningful test here: what actually scales with viewer count is HTTP
 * load on this one endpoint, and specifically whether Vercel's edge
 * cache (Cache-Control: s-maxage=2 on that route) actually absorbs a
 * crowd polling it, instead of every poll reaching the database.
 *
 * Run:
 *   brew install k6
 *   k6 run \
 *     -e BASE_URL=https://your-domain.com \
 *     -e AUCTION_ID=your-auction-id-or-slug \
 *     -e MAX_VUS=1000 \
 *     scripts/load-test-viewers.js
 *
 * Ramp up in steps (50 -> 200 -> 500 -> 1000), watching your
 * /dashboard/observability page and Vercel's own function/bandwidth
 * graphs after each step, rather than jumping straight to MAX_VUS=1000.
 *
 * Test against a duplicate/staging auction, not a real live one with
 * real bidder data - a bug in this script should never be able to touch
 * an actual event.
 */

import http from 'k6/http'
import { check, sleep } from 'k6'
import { Trend, Rate, Counter } from 'k6/metrics'

const BASE_URL = __ENV.BASE_URL
const AUCTION_ID = __ENV.AUCTION_ID
const MAX_VUS = Number(__ENV.MAX_VUS || 100)
const RAMP_UP = __ENV.RAMP_UP || '30s'
const HOLD = __ENV.HOLD || '2m'
const RAMP_DOWN = __ENV.RAMP_DOWN || '15s'
// Real clients poll every 6s (setInterval(fetchSnapshot, 6000) in
// public-auction-view.tsx) - matched here so request volume reflects a
// real audience, not an artificially aggressive hammering loop.
const POLL_INTERVAL_S = 6

if (!BASE_URL || !AUCTION_ID) {
  throw new Error('Set BASE_URL and AUCTION_ID env vars, e.g. -e BASE_URL=https://your-domain.com -e AUCTION_ID=abc123')
}

const responseBytes = new Trend('snapshot_response_bytes')
const cacheHitRate = new Rate('vercel_cache_hit_rate')

// A status-0 response is a connection that never completed (dial/timeout/
// reset) - the request never reached Vercel, so nothing about it shows up
// in Vercel's own dashboards. These counters exist to tell that apart from
// a real app/edge problem, and to show WHEN in the test it happens -
// steady failures throughout the hold phase point at something sustaining
// ~this many simultaneous connections (e.g. a router's NAT/session-table
// ceiling), while a spike only at ramp-up points at connection-churn
// instead. Reported as separate named counters (rather than one tagged
// metric) so they show up individually in k6's default end-of-run summary
// with no extra handleSummary() code needed.
function parseDurationToSeconds(value) {
  const match = String(value).match(/^(\d+(?:\.\d+)?)(ms|s|m|h)$/)
  if (!match) return 0
  const amount = parseFloat(match[1])
  const unit = match[2]
  if (unit === 'ms') return amount / 1000
  if (unit === 's') return amount
  if (unit === 'm') return amount * 60
  return amount * 3600
}
const rampUpSeconds = parseDurationToSeconds(RAMP_UP)
const holdSeconds = parseDurationToSeconds(HOLD)

const failuresDialTcp = new Counter('failures_dial_tcp')
const failuresTimeout = new Counter('failures_timeout')
const failuresReset = new Counter('failures_reset')
const failuresOther = new Counter('failures_other')
const failuresDuringRampUp = new Counter('failures_during_ramp_up')
const failuresDuringHold = new Counter('failures_during_hold')
const failuresDuringRampDown = new Counter('failures_during_ramp_down')

// Where in the hold phase each failure landed, as a 0-1 fraction (0 = right
// as the hold phase started, 1 = right at the end). Reported as a Trend so
// k6's own summary gives us the distribution (avg/median/percentiles) for
// free - a flat spread across 0-1 means a steady ceiling throughout a long
// run; a distribution skewed toward 1 would mean something gets WORSE the
// longer the connections stay open (a slow leak somewhere), which a short
// test has no way to reveal but a multi-hour one would.
const failurePositionInHold = new Trend('failure_position_in_hold_fraction')

// The categorization below is a best-effort guess at what's in res.error -
// last run, every single failure landed in "other" despite the raw WARN
// logs clearly showing "dial tcp ... connectex", meaning res.error isn't
// populated the way assumed here for this k6/OS combination. Rather than
// guess again blindly on a 3-hour run, this also prints the actual raw
// res.error/res.error_code for the first few failures so there's real
// ground truth to check the categorization against, not just another guess.
let sampleFailuresLogged = 0

export const options = {
  scenarios: {
    viewers: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: RAMP_UP, target: MAX_VUS },
        { duration: HOLD, target: MAX_VUS },
        { duration: RAMP_DOWN, target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    // p95 under a couple seconds even at MAX_VUS is the actual pass/fail
    // signal - if the edge cache is doing its job, this stays flat as
    // MAX_VUS climbs; if it climbs with MAX_VUS, the cache isn't holding.
    http_req_duration: ['p(95)<2000'],
  },
}

// Real viewers don't all load the page in the same millisecond - stagger
// each VU's first request so the ramp looks like an audience arriving
// over time, not a synchronized burst on every single interval tick.
export function setup() {
  return { startedAt: Date.now() }
}

export default function viewerPollLoop(data) {
  sleep(Math.random() * POLL_INTERVAL_S)

  const res = http.get(`${BASE_URL}/api/auction/${AUCTION_ID}/snapshot`, {
    tags: { name: 'snapshot_poll' },
  })

  check(res, {
    'status is 200': (r) => r.status === 200,
    'has currentPlayer field': (r) => {
      try {
        return 'currentPlayer' in r.json()
      } catch {
        return false
      }
    },
  })

  // status 0 = the connection itself never completed (dial/timeout/reset) -
  // there is no HTTP response to grade, so this is handled separately from
  // the checks above.
  if (res.status === 0) {
    if (sampleFailuresLogged < 5) {
      sampleFailuresLogged++
      console.log(`[sample failure ${sampleFailuresLogged}/5] error_code=${res.error_code} error=${JSON.stringify(res.error)}`)
    }

    const errorText = `${res.error || ''} ${res.error_code || ''}`.toLowerCase()
    if (errorText.includes('timeout')) {
      failuresTimeout.add(1)
    } else if (errorText.includes('reset')) {
      failuresReset.add(1)
    } else if (errorText.includes('dial tcp') || errorText.includes('connectex') || errorText.includes('connection refused')) {
      failuresDialTcp.add(1)
    } else {
      failuresOther.add(1)
    }

    const elapsedSeconds = (Date.now() - data.startedAt) / 1000
    if (elapsedSeconds < rampUpSeconds) {
      failuresDuringRampUp.add(1)
    } else if (elapsedSeconds < rampUpSeconds + holdSeconds) {
      failuresDuringHold.add(1)
      failurePositionInHold.add((elapsedSeconds - rampUpSeconds) / holdSeconds)
    } else {
      failuresDuringRampDown.add(1)
    }
  }

  responseBytes.add(res.body ? res.body.length : 0)

  // Vercel's edge exposes this header on a cache hit; absent/MISS means
  // the request reached your Next.js function (and the database) instead
  // of being served from the edge - the exact thing this test exists to
  // watch as concurrency climbs.
  const cacheStatus = res.headers['X-Vercel-Cache'] || res.headers['x-vercel-cache']
  cacheHitRate.add(cacheStatus === 'HIT' || cacheStatus === 'STALE')

  sleep(POLL_INTERVAL_S)
}
