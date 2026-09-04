// Pusher Channels' published plan limits (Channels dashboard -> Plans tab).
// Hardcoded from the actual plan table, not guessed - concurrent connections
// and messages/day both vary by tier, and Pusher's REST API (the one this
// app authenticates to with PUSHER_KEY/SECRET) has no endpoint that reports
// which plan an app is on or how much of its quota is used - that only
// exists in Pusher's own dashboard. Since the app can't ask Pusher, it has
// to be told: set PUSHER_PLAN to one of the keys below to match your real
// plan. Defaults to 'sandbox' (the free tier) when unset, since assuming
// the smallest plan is the safer wrong guess than assuming a large one.

export interface PusherPlanLimits {
  label: string
  maxConnections: number
  messagesPerDay: number
}

export const PUSHER_PLANS: Record<string, PusherPlanLimits> = {
  sandbox: { label: 'Sandbox (Free)', maxConnections: 100, messagesPerDay: 200_000 },
  startup: { label: 'Startup', maxConnections: 500, messagesPerDay: 1_000_000 },
  pro: { label: 'Pro', maxConnections: 2_000, messagesPerDay: 4_000_000 },
  business: { label: 'Business', maxConnections: 5_000, messagesPerDay: 10_000_000 },
  premium: { label: 'Premium', maxConnections: 10_000, messagesPerDay: 20_000_000 },
  growth: { label: 'Growth', maxConnections: 15_000, messagesPerDay: 40_000_000 },
  plus: { label: 'Plus', maxConnections: 20_000, messagesPerDay: 60_000_000 },
  growth_plus: { label: 'Growth Plus', maxConnections: 30_000, messagesPerDay: 90_000_000 },
}

const DEFAULT_PLAN_KEY = 'sandbox'

// PUSHER_MAX_CONNECTIONS / PUSHER_MESSAGES_PER_DAY, if set, override the
// named plan's numbers - for a custom/enterprise plan not in the table
// above, without needing a code change.
export function getPusherPlan(): { key: string; label: string; maxConnections: number; messagesPerDay: number } {
  const key = (process.env.PUSHER_PLAN || DEFAULT_PLAN_KEY).toLowerCase()
  const plan = PUSHER_PLANS[key]
  const recognized = !!plan
  const base = plan ?? PUSHER_PLANS[DEFAULT_PLAN_KEY]

  const maxConnections = Number(process.env.PUSHER_MAX_CONNECTIONS) || base.maxConnections
  const messagesPerDay = Number(process.env.PUSHER_MESSAGES_PER_DAY) || base.messagesPerDay

  return {
    key: recognized ? key : DEFAULT_PLAN_KEY,
    label: recognized ? base.label : `Unrecognized plan "${key}" - falling back to ${base.label} limits`,
    maxConnections,
    messagesPerDay,
  }
}
