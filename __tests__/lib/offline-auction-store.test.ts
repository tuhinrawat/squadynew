import { extractOfflineRules, validateOfflineSale, pickRandomPlayer } from '@/lib/offline-auction-store'

// These mirror the exact constraints mark-sold/route.ts enforces server-side
// (funds, team-size cap, mandatory-squad reserve) - a sale the offline
// console allows through must be one the live server would also have
// allowed, or a synced result could get flagged as a conflict/warning it
// should never have hit in the first place.

describe('extractOfflineRules', () => {
  it('falls back to sane defaults when rules are missing', () => {
    expect(extractOfflineRules(null)).toEqual({
      minBidIncrement: 1000,
      maxTeamSize: null,
      mandatoryTeamSize: null,
      minPerPlayerReserve: 1000
    })
  })

  it('derives maxTeamSize from mandatoryTeamSize when maxTeamSize is unset', () => {
    const rules = extractOfflineRules({ mandatoryTeamSize: 12 })
    expect(rules.maxTeamSize).toBe(12)
    expect(rules.mandatoryTeamSize).toBe(12)
  })

  it('prefers an explicit maxTeamSize over mandatoryTeamSize', () => {
    const rules = extractOfflineRules({ mandatoryTeamSize: 12, maxTeamSize: 15 })
    expect(rules.maxTeamSize).toBe(15)
  })

  it('falls back to minBidIncrement for the per-slot reserve when unset', () => {
    const rules = extractOfflineRules({ minBidIncrement: 2000 })
    expect(rules.minPerPlayerReserve).toBe(2000)
  })
})

describe('validateOfflineSale', () => {
  const baseRules = extractOfflineRules({ minBidIncrement: 1000 })

  it('rejects a non-positive amount', () => {
    expect(validateOfflineSale({ amount: 0, bidderRemainingPurse: 10000, playersBoughtByBidder: 0, rules: baseRules }))
      .toMatch(/valid sale amount/)
  })

  it('rejects an amount that is not a multiple of ₹1K', () => {
    expect(validateOfflineSale({ amount: 1500, bidderRemainingPurse: 10000, playersBoughtByBidder: 0, rules: baseRules }))
      .toMatch(/multiples of ₹1K/)
  })

  it('rejects a sale that exceeds the bidder\'s remaining purse', () => {
    const result = validateOfflineSale({ amount: 5000, bidderRemainingPurse: 4000, playersBoughtByBidder: 0, rules: baseRules })
    expect(result).toMatch(/Insufficient funds/)
    expect(result).toMatch(/₹4,000/)
    expect(result).toMatch(/₹5,000/)
  })

  it('allows a valid sale with no team-size or reserve constraints', () => {
    expect(validateOfflineSale({ amount: 5000, bidderRemainingPurse: 10000, playersBoughtByBidder: 0, rules: baseRules }))
      .toBeNull()
  })

  it('rejects a sale once the bidder\'s team is already full', () => {
    const rules = extractOfflineRules({ maxTeamSize: 3 })
    // maxTeamSize includes the bidder, so 2 players already bought means full
    const result = validateOfflineSale({ amount: 1000, bidderRemainingPurse: 100000, playersBoughtByBidder: 2, rules })
    expect(result).toMatch(/Team size limit reached/)
  })

  it('allows the last slot to be filled exactly at the team-size boundary', () => {
    const rules = extractOfflineRules({ maxTeamSize: 3 })
    const result = validateOfflineSale({ amount: 1000, bidderRemainingPurse: 100000, playersBoughtByBidder: 1, rules })
    expect(result).toBeNull()
  })

  it('rejects a sale that would leave insufficient reserve for the mandatory squad', () => {
    const rules = extractOfflineRules({ mandatoryTeamSize: 12, minPerPlayerReserve: 1000 })
    // 0 bought so far; buying this one leaves 10 slots needing 1000 each = 10000 reserve
    const result = validateOfflineSale({ amount: 91000, bidderRemainingPurse: 100000, playersBoughtByBidder: 0, rules })
    expect(result).toMatch(/mandatory squad of 12/)
    expect(result).toMatch(/Required reserve: ₹10,000/)
  })

  it('allows a sale that leaves exactly enough reserve for the mandatory squad', () => {
    const rules = extractOfflineRules({ mandatoryTeamSize: 12, minPerPlayerReserve: 1000 })
    const result = validateOfflineSale({ amount: 90000, bidderRemainingPurse: 100000, playersBoughtByBidder: 0, rules })
    expect(result).toBeNull()
  })

  it('allows spending all remaining purse on the final mandatory slot', () => {
    const rules = extractOfflineRules({ mandatoryTeamSize: 3, minPerPlayerReserve: 1000 })
    // 1 bought so far; buying this one fills the mandatory squad (0 slots remain), so no reserve needed
    const result = validateOfflineSale({ amount: 100000, bidderRemainingPurse: 100000, playersBoughtByBidder: 1, rules })
    expect(result).toBeNull()
  })
})

describe('pickRandomPlayer', () => {
  it('returns null when no players are available', () => {
    expect(pickRandomPlayer([])).toBeNull()
  })

  it('draws only from icon players while any remain', () => {
    const players = [
      { id: 'icon-1', isIcon: true },
      { id: 'icon-2', isIcon: true },
      { id: 'regular-1', isIcon: false }
    ]
    for (let i = 0; i < 20; i++) {
      const picked = pickRandomPlayer(players)
      expect(picked?.isIcon).toBe(true)
    }
  })

  it('falls back to regular players once no icon players remain', () => {
    const players = [{ id: 'regular-1', isIcon: false }, { id: 'regular-2', isIcon: false }]
    const picked = pickRandomPlayer(players)
    expect(picked?.isIcon).toBe(false)
  })
})
