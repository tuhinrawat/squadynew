// Player data will soon carry extra spreadsheet columns per stat, prefixed
// by discipline (e.g. "Batting_matches", "batting_runs" - the exact casing
// isn't standardized any more than the rest of this codebase's uploaded
// columns are, see extractCricheroesLink for the same problem elsewhere).
// Rather than list every literal spelling, keys are normalized (lowercased,
// stripped of anything non-alphanumeric) before matching, so
// "Batting_Strike_Rate", "batting strike rate" and "BattingStrikeRate" all
// resolve to the same lookup.

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function buildNormalizedMap(data: Record<string, unknown>): Map<string, unknown> {
  return new Map(Object.entries(data).map(([key, value]) => [normalizeKey(key), value]))
}

function findRaw(map: Map<string, unknown>, prefix: string, aliases: string[]): unknown {
  for (const alias of aliases) {
    const value = map.get(normalizeKey(prefix + alias))
    if (value !== undefined && value !== null && String(value).trim() !== '') return value
  }
  return undefined
}

function toNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined
  const n = Number(String(value).trim())
  return Number.isFinite(n) ? n : undefined
}

function toText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  const s = String(value).trim()
  return s === '' ? undefined : s
}

export interface BattingStats {
  matches?: number
  innings?: number
  notOut?: number
  runs?: number
  highest?: string
  average?: number
  strikeRate?: number
  thirties?: number
  fifties?: number
  hundreds?: number
  fours?: number
  sixes?: number
  ducks?: number
  matchesWon?: number
  matchesLost?: number
}

export interface BowlingStats {
  matches?: number
  innings?: number
  overs?: number
  maidens?: number
  wickets?: number
  runsConceded?: number
  best?: string
  threeWickets?: number
  fiveWickets?: number
  economy?: number
  strikeRate?: number
  average?: number
  wides?: number
  noBalls?: number
  dotBalls?: number
  fours?: number
  sixes?: number
}

// Returns null when the player has no usable batting data at all (rather
// than an object of all-undefined fields), so callers can skip the whole
// panel with a single check.
export function extractBattingStats(data: Record<string, unknown> | null | undefined): BattingStats | null {
  if (!data) return null
  const map = buildNormalizedMap(data)
  const runs = toNumber(findRaw(map, 'batting', ['runs']))
  const matches = toNumber(findRaw(map, 'batting', ['matches']))
  if (runs === undefined && matches === undefined) return null

  return {
    matches,
    innings: toNumber(findRaw(map, 'batting', ['innings'])),
    notOut: toNumber(findRaw(map, 'batting', ['notout', 'not out'])),
    runs,
    highest: toText(findRaw(map, 'batting', ['highest', 'highestruns', 'highestscore'])),
    average: toNumber(findRaw(map, 'batting', ['average', 'avg'])),
    strikeRate: toNumber(findRaw(map, 'batting', ['strikerate', 'sr'])),
    thirties: toNumber(findRaw(map, 'batting', ['30s', 'thirties'])),
    fifties: toNumber(findRaw(map, 'batting', ['50s', 'fifties'])),
    hundreds: toNumber(findRaw(map, 'batting', ['100s', 'hundreds', 'centuries'])),
    fours: toNumber(findRaw(map, 'batting', ['4s', 'fours'])),
    sixes: toNumber(findRaw(map, 'batting', ['6s', 'sixes'])),
    ducks: toNumber(findRaw(map, 'batting', ['ducks'])),
    matchesWon: toNumber(findRaw(map, 'batting', ['won', 'matcheswon'])),
    matchesLost: toNumber(findRaw(map, 'batting', ['loss', 'lost', 'matcheslost'])),
  }
}

// Same null-when-empty contract as extractBattingStats.
export function extractBowlingStats(data: Record<string, unknown> | null | undefined): BowlingStats | null {
  if (!data) return null
  const map = buildNormalizedMap(data)
  const wickets = toNumber(findRaw(map, 'bowling', ['wickets']))
  const matches = toNumber(findRaw(map, 'bowling', ['matches']))
  if (wickets === undefined && matches === undefined) return null

  return {
    matches,
    innings: toNumber(findRaw(map, 'bowling', ['innings'])),
    overs: toNumber(findRaw(map, 'bowling', ['overs'])),
    maidens: toNumber(findRaw(map, 'bowling', ['maidens'])),
    wickets,
    runsConceded: toNumber(findRaw(map, 'bowling', ['runs'])),
    best: toText(findRaw(map, 'bowling', ['best', 'bestbowling'])),
    threeWickets: toNumber(findRaw(map, 'bowling', ['3wickets', '3w', 'threewickets'])),
    fiveWickets: toNumber(findRaw(map, 'bowling', ['5wickets', '5w', 'fivewickets'])),
    economy: toNumber(findRaw(map, 'bowling', ['economy', 'econ'])),
    strikeRate: toNumber(findRaw(map, 'bowling', ['strikerate', 'sr'])),
    average: toNumber(findRaw(map, 'bowling', ['average', 'avg'])),
    wides: toNumber(findRaw(map, 'bowling', ['wides'])),
    noBalls: toNumber(findRaw(map, 'bowling', ['noballs', 'nb'])),
    dotBalls: toNumber(findRaw(map, 'bowling', ['dotballs', 'dots'])),
    fours: toNumber(findRaw(map, 'bowling', ['4s', 'fours'])),
    sixes: toNumber(findRaw(map, 'bowling', ['6s', 'sixes'])),
  }
}

// Ranges used to turn a raw number into a 0-100 fill for the card's scale
// bars. These are a starting assumption for a local/box-cricket league (the
// reference data this was built from had a batting average under 10 and
// strike rates well over 90, consistent with T20-style club cricket) -
// tune them once real distributions are available rather than trusting
// them as ground truth.
export const BATTING_AVERAGE_RANGE: [number, number] = [0, 40]
export const BATTING_STRIKE_RATE_RANGE: [number, number] = [50, 160]
// Lower is better for both bowling ranges - scalePercent's invert flag
// handles that, the range itself stays expressed low-to-high.
export const BOWLING_ECONOMY_RANGE: [number, number] = [4, 14]
export const BOWLING_AVERAGE_RANGE: [number, number] = [10, 40]

export function scalePercent(value: number, range: [number, number], invert: boolean = false): number {
  const [min, max] = range
  const clamped = Math.min(Math.max(value, min), max)
  const pct = ((clamped - min) / (max - min)) * 100
  return invert ? 100 - pct : pct
}
