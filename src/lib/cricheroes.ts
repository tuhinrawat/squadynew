// A player's raw uploaded data can spell this column a few different ways
// depending on how the source spreadsheet was authored - these are every
// variant already handled across the player card, the pre-live pool view,
// and the roster page before this file existed to share it.
const CRICHEROES_LINK_KEYS = [
  'Cricheroes Profile link',
  ' Cricheroes Profile link',
  'cricheroes profile link',
  'Cricheros Profile',
  'cricheros profile',
]

// Pulls the raw Cricheroes profile URL out of a player's uploaded data, or
// undefined if it's missing/blank. Same extraction every view already did
// ad hoc: find the first populated key, then pull the URL out of whatever
// surrounding text it's embedded in.
export function extractCricheroesLink(playerData: Record<string, unknown> | null | undefined): string | undefined {
  if (!playerData) return undefined
  const raw = CRICHEROES_LINK_KEYS
    .map(key => playerData[key])
    .find((value): value is string => typeof value === 'string' && value.trim() !== '')

  if (!raw) return undefined
  const urlMatch = raw.match(/(https?:\/\/[^\s]+)/i)
  return urlMatch?.[1]?.trim()
}

// Normalizes a Cricheroes URL into a stable key for matching the same
// player across two different auctions' data - trims a trailing slash and
// lowercases, since the numeric profile id in the path is what actually
// identifies the player and casing/trailing-slash differences are just
// copy-paste noise, not a different profile.
export function normalizeCricheroesLink(link: string | null | undefined): string | undefined {
  if (!link) return undefined
  const trimmed = link.trim().replace(/\/+$/, '').toLowerCase()
  return trimmed || undefined
}
