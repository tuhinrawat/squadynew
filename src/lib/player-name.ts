// Sheets vary in how they record a player's name: most have one combined
// column ('name'/'Name'/'player_name'), but some (Google Forms registration
// exports, notably) only ever collect 'First Name' and 'Last Name' as
// separate questions - there is no combined column at all. Every player-name
// display in this app used to check only the combined-column variants, so a
// First/Last-only sheet silently produced nothing everywhere a name is
// shown - including a retired player's bidder record, whose backfilled name
// AND team name (which itself falls back to the player's name) both come
// from this exact extraction.
export function extractPlayerName(data: Record<string, unknown> | null | undefined): string | undefined {
  const direct = data?.name ?? data?.Name ?? data?.player_name
  if (direct !== undefined && direct !== null && String(direct).trim() !== '') {
    return String(direct).trim()
  }

  const first = data?.['First Name'] ?? data?.['first name'] ?? data?.['firstName']
  const last = data?.['Last Name'] ?? data?.['last name'] ?? data?.['lastName']
  const combined = [first, last]
    .filter((v) => v !== undefined && v !== null && String(v).trim() !== '')
    .map((v) => String(v).trim())
    .join(' ')

  return combined || undefined
}

// Lowercases, trims, and collapses internal whitespace so the same person's
// name compares equal across two sheets that differ only in casing or extra
// spaces (e.g. from copy-pasting into a spreadsheet cell).
export function normalizeName(name: string | null | undefined): string {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ')
}
