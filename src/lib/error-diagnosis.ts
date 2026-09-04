// Turns a raw observability_events row into a plain-language explanation:
// what happened, the most likely cause, and what to actually do about it -
// instead of making a reader parse a stack trace or a Prisma error code by
// hand. Pattern-matched against real, verifiable signals only:
//  - Pusher's REST client throws a RequestError with .status/.body on any
//    HTTP error response (verified in node_modules/pusher/lib/requests.js) -
//    NOT a guess about what status code means what.
//  - Prisma's known-request errors carry a documented .code
//    (prisma.io/docs/orm/reference/error-reference) - also not a guess.
// Anything that doesn't match a known signal returns 'low' confidence and
// says so plainly, rather than inventing a plausible-sounding cause.

export type DiagnosisConfidence = 'high' | 'medium' | 'low'
export type DiagnosisSeverity = 'failure' | 'slow'

export interface ErrorDiagnosis {
  severity: DiagnosisSeverity
  summary: string
  likelyCause: string
  likelyFix: string
  confidence: DiagnosisConfidence
}

interface DiagnosableEvent {
  category: string
  eventName: string
  success: boolean
  message?: string | null
  metadata?: Record<string, unknown> | null
  latencyMs?: number | null
}

// Above these, a SUCCESSFUL event is still worth flagging as "slow" - the
// literal "clogging" signal from the original incident: not yet a failure,
// but heading there.
const SLOW_THRESHOLD_MS: Record<string, number> = {
  pusher: 3000,
  sync_lag: 5000,
  api_error: 5000,
}

function prismaCodeDiagnosis(code: string): { summary: string; likelyCause: string; likelyFix: string; confidence: DiagnosisConfidence } | null {
  switch (code) {
    case 'P1001':
      return {
        summary: 'Could not reach the database',
        likelyCause: 'The database is down, unreachable from Vercel, or DATABASE_URL is misconfigured.',
        likelyFix: "Check your database provider's status page, then confirm DATABASE_URL in Vercel's environment variables.",
        confidence: 'high',
      }
    case 'P2024':
      return {
        summary: 'Database connection pool timed out',
        likelyCause: 'Too many concurrent requests were holding connections at once - a real capacity signal, not a fluke, usually meaning more simultaneous DB activity than the pool was sized for.',
        likelyFix: 'If this clusters around one auction, that auction had more concurrent load than the connection pool could serve. Consider a larger pool size or Prisma Accelerate connection limits.',
        confidence: 'high',
      }
    case 'P2002':
      return {
        summary: 'Tried to create a duplicate record',
        likelyCause: 'A unique constraint was violated - most likely a duplicate bidder or player entry.',
        likelyFix: 'Check the field named in the raw message for what duplicated, and whether the request was accidentally sent twice.',
        confidence: 'high',
      }
    case 'P2025':
      return {
        summary: 'Tried to update or delete a record that no longer exists',
        likelyCause: 'The record was deleted, or the reference was stale - often a race condition between two near-simultaneous admin actions.',
        likelyFix: 'Check whether the referenced player/bidder/auction still exists; if this recurs, look for two actions being triggered on the same entity at once.',
        confidence: 'medium',
      }
    default:
      return {
        summary: `Database error (Prisma code ${code})`,
        likelyCause: `See Prisma's error reference for what ${code} means.`,
        likelyFix: `Look up ${code} at prisma.io/docs/orm/reference/error-reference`,
        confidence: 'medium',
      }
  }
}

function pusherFailureDiagnosis(message: string | null | undefined, metadata: Record<string, unknown> | null | undefined): { summary: string; likelyCause: string; likelyFix: string; confidence: DiagnosisConfidence } {
  const status = metadata?.status as number | undefined
  const body = (metadata?.body as string | undefined) || ''

  if (status === 401 || status === 403) {
    return {
      summary: `Pusher rejected the request as unauthorized (HTTP ${status})`,
      likelyCause: 'PUSHER_KEY, PUSHER_SECRET, or PUSHER_APP_ID is wrong, or the credentials were rotated in the Pusher dashboard without updating Vercel.',
      likelyFix: "Compare Vercel's environment variables against the current app credentials in your Pusher dashboard.",
      confidence: 'high',
    }
  }
  if (status === 413) {
    return {
      summary: 'Pusher rejected the message as too large (HTTP 413)',
      likelyCause: 'The event payload exceeded Pusher\'s per-message size limit (10KB on most plans) - likely an event embedding a full player list or large object.',
      likelyFix: 'Send IDs in the payload and let clients fetch full detail, instead of embedding large objects directly in the broadcast.',
      confidence: 'high',
    }
  }
  if (typeof status === 'number' && status >= 400) {
    return {
      summary: `Pusher rejected the request (HTTP ${status})`,
      likelyCause: `Most commonly an account-level restriction - an exceeded daily message quota or concurrent connection limit for your plan - though it can also mean a malformed channel or event name.${body ? ` Response body: ${body}` : ''}`,
      likelyFix: "Check your Pusher dashboard's Overview/Plans tab for a limit-exceeded notice, and your email for Pusher's quota warning. If it's quota, wait for the daily UTC reset or upgrade the plan.",
      confidence: 'medium',
    }
  }
  return {
    summary: "Could not reach Pusher's servers",
    likelyCause: 'A network failure between your server and Pusher, or a Pusher outage - not a rejection, a failure to connect at all.',
    likelyFix: 'Check status.pusher.com for an ongoing incident. A single isolated occurrence is usually transient and needs no action.',
    confidence: 'medium',
  }
}

export function diagnose(event: DiagnosableEvent): ErrorDiagnosis | null {
  const { category, eventName, success, message, metadata, latencyMs } = event

  if (!success) {
    if (category === 'rate_limit') {
      return {
        severity: 'failure',
        summary: `Rate limit rejected a ${eventName} request`,
        likelyCause: 'A single bidder or client sent requests faster than the configured limit - could be genuine rapid activity (a real bidding war), a client stuck retrying, or a bot.',
        likelyFix: 'If it\'s one bidder repeatedly, check their client for a retry loop. If it\'s spread across many bidders during a hot moment, this is the limiter working as designed - no action needed.',
        confidence: 'high',
      }
    }

    if (category === 'pusher' || category === 'pusher_client') {
      if (eventName === 'connection_error') {
        return {
          severity: 'failure',
          summary: "A bidder's browser lost its real-time connection",
          likelyCause: 'Usually a normal network blip or a backgrounded tab. If many of these cluster together during one auction, it more likely means the Pusher connection ceiling was reached.',
          likelyFix: 'A single occurrence needs no action - Pusher auto-reconnects. If several cluster together, check Live Connections against your plan\'s concurrent-connection limit.',
          confidence: 'medium',
        }
      }
      return { severity: 'failure', ...pusherFailureDiagnosis(message, metadata) }
    }

    if (category === 'api_error') {
      if (metadata?.guard === 'recycle_sold_players') {
        return {
          severity: 'failure',
          summary: 'A data-integrity safety check blocked recycling a SOLD player back into the pool',
          likelyCause: 'This should structurally never happen - a player\'s status changed between two reads within the same request, most likely two admin actions racing on the same auction at once.',
          likelyFix: 'Check that player\'s current status in the dashboard. If genuinely stuck, correct it manually. Report this if it recurs - it points to a real race condition worth fixing at the root.',
          confidence: 'high',
        }
      }
      const code = metadata?.errorCode as string | undefined
      if (code) {
        const d = prismaCodeDiagnosis(code)
        if (d) return { severity: 'failure', ...d }
      }
      if (message && /timeout|timed out/i.test(message)) {
        return {
          severity: 'failure',
          summary: `Request timed out (${eventName})`,
          likelyCause: 'An upstream call (database or Pusher) took too long to respond.',
          likelyFix: 'Check whether this clusters around a specific auction or time - if isolated, it\'s likely transient.',
          confidence: 'low',
        }
      }
    }

    if (category === 'canary') {
      const pusherOk = metadata?.pusherOk
      const dbOk = metadata?.dbOk
      const failedPart = pusherOk === false ? 'Pusher' : dbOk === false ? 'the database' : 'an unknown part of the pipeline'
      return {
        severity: 'failure',
        summary: 'The scheduled heartbeat check failed',
        likelyCause: `The synthetic check couldn't reach ${failedPart} - a real signal independent of live traffic.`,
        likelyFix: failedPart === 'Pusher' ? 'Check Pusher credentials and status.pusher.com.' : failedPart === 'the database' ? "Check your database provider's status and DATABASE_URL." : 'Check the raw message for detail.',
        confidence: 'high',
      }
    }

    return {
      severity: 'failure',
      summary: `Unclassified ${category}/${eventName} failure`,
      likelyCause: 'This doesn\'t match a known error signature yet - not enough structure to pattern-match automatically.',
      likelyFix: 'Read the raw message above for detail.',
      confidence: 'low',
    }
  }

  // Successful but slow - the "clogging" signal: not a failure yet, but
  // getting there. Only flag categories with a known meaningful threshold.
  const threshold = SLOW_THRESHOLD_MS[category]
  if (threshold && typeof latencyMs === 'number' && latencyMs > threshold) {
    if (category === 'pusher') {
      return {
        severity: 'slow',
        summary: `Pusher trigger for ${eventName} took ${latencyMs}ms (normally well under ${threshold}ms)`,
        likelyCause: 'Pusher\'s API is responding slowly - could be regional network congestion, a Pusher-side slowdown, or your account approaching a plan limit that throttles rather than rejects.',
        likelyFix: 'A single slow call is usually transient. If many cluster together, check status.pusher.com and your plan\'s usage graphs.',
        confidence: 'medium',
      }
    }
    if (category === 'sync_lag') {
      return {
        severity: 'slow',
        summary: `A bidder's browser took ${latencyMs}ms to receive a bid update (normally well under ${threshold}ms)`,
        likelyCause: 'That specific viewer had a slow network path, or the server was slow to broadcast in the first place.',
        likelyFix: 'One slow sample is normal variance. If avg sync lag on the dashboard is elevated broadly, it points to a server-side or Pusher-side slowdown, not one bidder\'s connection.',
        confidence: 'low',
      }
    }
    return {
      severity: 'slow',
      summary: `${eventName} succeeded but took ${latencyMs}ms (normally well under ${threshold}ms)`,
      likelyCause: 'An upstream dependency (database or Pusher) responded slowly without failing outright.',
      likelyFix: 'Watch whether this recurs; a cluster of slow-but-successful calls often precedes outright failures under sustained load.',
      confidence: 'low',
    }
  }

  return null
}
