// A player's raw uploaded data can spell this column a few different ways
// depending on how the source spreadsheet was authored - these are every
// variant already handled across the player card, the pre-live pool view,
// and the roster page before this file existed to share it.
export const CRICHEROES_LINK_KEYS = [
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

// Real uploaded sheets often have this column as free text a person pasted
// into ("Hey check this out https://cricheroes.com/xyz please review"), or
// with trailing junk after the link itself. Pulls out just the URL - from
// "https://"/"http://" up to the first whitespace - and leaves the value
// alone if it doesn't contain a recognizable link at all, rather than
// blanking a column we can't confidently parse.
export function cleanCricheroesLinkValue(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  const match = raw.match(/(https?:\/\/[^\s]+)/i)
  return match ? match[1].trim() : raw
}

// Runs cleanCricheroesLinkValue over every column name this codebase
// recognizes as a Cricheroes-link field (see CRICHEROES_LINK_KEYS above),
// for a single player's uploaded data. Used at import time so the stored
// value is clean, not just whatever extractCricheroesLink can salvage from
// it at display/match time.
export function cleanCricheroesLinksInPlayerData<T extends Record<string, unknown>>(data: T): T {
  const cleaned: Record<string, unknown> = { ...data }
  for (const key of CRICHEROES_LINK_KEYS) {
    if (key in cleaned) {
      cleaned[key] = cleanCricheroesLinkValue(cleaned[key])
    }
  }
  return cleaned as T
}
