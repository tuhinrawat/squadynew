import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { calculatePlayerScoreFromData, ScoreResult } from '@/lib/playerStats'
import { calculateAuctionState, analyzeTeamNeeds, calculateRemainingPoolImpact, getRemainingPoolSummary, AuctionState } from '@/lib/auctionState'

// Lazy load OpenAI to avoid build-time errors
function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) {
    return null
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const OpenAI = require('openai')
    if (!OpenAI) {
      console.error('OpenAI module not found')
      return null
    }
    return new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    })
  } catch (error) {
    console.error('Error loading OpenAI module:', error)
    return null
  }
}

// Helper function to round bid amounts to nearest 1000 (minimum bid increment)
function roundToNearestThousand(amount: number): number {
  if (amount <= 0) return 1000 // Minimum bid is 1000
  return Math.max(1000, Math.round(amount / 1000) * 1000)
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    let body
    try {
      body = await request.json()
    } catch (jsonError) {
      console.error('Error parsing request body:', jsonError)
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    
    const { playerId, tusharBidderId, customColumns, useOpenAI = true } = body || {}

    if (!playerId || !tusharBidderId) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 })
    }
    
    // If useOpenAI is false, skip OpenAI and use fallback only
    const shouldUseOpenAI = useOpenAI !== false && process.env.OPENAI_API_KEY

    // Fetch auction data
    const auction = await prisma.auction.findUnique({
      where: { id: params.id },
      include: {
        players: true,
        bidders: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true
              }
            }
          }
        }
      }
    })

    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }

    const currentPlayer = auction.players.find(p => p.id === playerId)
    if (!currentPlayer) {
      return NextResponse.json({ error: 'Player not found' }, { status: 404 })
    }

    const tusharBidder = auction.bidders.find(b => b.id === tusharBidderId)
    if (!tusharBidder) {
      return NextResponse.json({ error: 'Bidder not found' }, { status: 404 })
    }

    // Parse bid history
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let bidHistory: any[] = []
    if (auction.bidHistory && typeof auction.bidHistory === 'object') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bidHistoryData = auction.bidHistory as any
      if (Array.isArray(bidHistoryData)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        bidHistory = bidHistoryData.filter((bid: any) => bid.playerId === playerId)
      }
    }

    // Get player data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const playerData = currentPlayer.data as any
    
    // Calculate player score using stats-based scoring
    const playerScore: ScoreResult = calculatePlayerScoreFromData(currentPlayer)
    
    // Calculate auction state (sold vs available, progress, etc.)
    const auctionState: AuctionState = calculateAuctionState(auction.players)
    
    // Get remaining pool summary
    const poolSummary = getRemainingPoolSummary(auctionState)
    
    // Calculate remaining pool impact for current player
    const playerSpeciality = playerData?.Speciality || playerData?.speciality || ''
    const poolImpact = calculateRemainingPoolImpact(playerSpeciality, auctionState)
    
    // Extract custom columns data if provided
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const customColumnsData: Record<string, any> = {}
    if (customColumns && Array.isArray(customColumns)) {
      customColumns.forEach((col: string) => {
        if (col && typeof col === 'string' && col !== 'name' && col !== 'status' && 
            col !== 'speciality' && col !== 'batting' && col !== 'bowling' && 
            col !== 'soldPrice' && col !== 'soldTo') {
          customColumnsData[col] = playerData?.[col]
        }
      })
    }

    // Get upcoming players (not sold, not retired, not current player)
    const upcomingPlayers = auction.players.filter(p => 
      p.id !== playerId && 
      p.status === 'AVAILABLE'
    )

    // Analyze upcoming players to identify brilliant ones
    // This considers: icon status, custom analytics columns (ratings, stats), base price
    const upcomingPlayersAnalysis = upcomingPlayers.map(p => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = p.data as any
      const name = data?.Name || data?.name || 'Unknown'
      
      // Calculate a "brilliance score" based on multiple factors
      let brillianceScore = 0
      const factors: string[] = []
      
      // Factor 1: Icon status (high weight)
      if (p.isIcon) {
        brillianceScore += 50
        factors.push('Icon Player')
      }
      
      // Factor 2: Base price (higher base price = more valuable)
      const basePrice = data?.['Base Price'] || data?.['base price'] || 1000
      if (basePrice > 50000) {
        brillianceScore += 30
        factors.push('Very High Base Price')
      } else if (basePrice > 25000) {
        brillianceScore += 20
        factors.push('High Base Price')
      } else if (basePrice > 10000) {
        brillianceScore += 10
        factors.push('Moderate Base Price')
      }
      
      // Factor 3: Custom analytics columns (ratings, performance metrics)
      // Look for numeric fields that might indicate quality
      if (customColumns && Array.isArray(customColumns)) {
        customColumns.forEach((col: string) => {
          const value = data?.[col]
          if (typeof value === 'number') {
            // If it's a rating (0-100 scale), add to score
            if (value >= 80) {
              brillianceScore += 25
              factors.push(`High ${col} (${value})`)
            } else if (value >= 60) {
              brillianceScore += 15
              factors.push(`Good ${col} (${value})`)
            }
          } else if (typeof value === 'string') {
            // Check for high-value keywords
            const lowerValue = value.toLowerCase()
            if (lowerValue.includes('excellent') || lowerValue.includes('outstanding') || 
                lowerValue.includes('elite') || lowerValue.includes('top')) {
              brillianceScore += 20
              factors.push(`Excellent ${col}`)
            }
          }
        })
      }
      
      // Factor 4: Speciality (allrounders often more valuable)
      const speciality = data?.Speciality || data?.speciality || ''
      if (speciality.toLowerCase().includes('allrounder')) {
        brillianceScore += 10
        factors.push('Allrounder')
      }
      
      return {
        id: p.id,
        name,
        data,
        isIcon: p.isIcon,
        basePrice,
        brillianceScore,
        factors,
        speciality: data?.Speciality || data?.speciality || 'N/A',
        batting: data?.['Batting Type'] || 'N/A',
        bowling: data?.['Bowling Type'] || 'N/A'
      }
    }).sort((a, b) => b.brillianceScore - a.brillianceScore) // Sort by brilliance score

    // Identify "brilliant" players (top 20% or score > 50)
    const brilliantThreshold = Math.max(50, upcomingPlayersAnalysis.length > 0 
      ? upcomingPlayersAnalysis[Math.floor(upcomingPlayersAnalysis.length * 0.2)]?.brillianceScore || 50
      : 50)
    const brilliantUpcomingPlayers = upcomingPlayersAnalysis.filter(p => p.brillianceScore >= brilliantThreshold)

    // Get auction rules
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rules = auction.rules as any
    const minBidIncrement = rules?.minBidIncrement || 1000
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const maxBidIncrement = rules?.maxBidIncrement
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const countdownSeconds = rules?.countdownSeconds || 30
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const iconPlayerCount = rules?.iconPlayerCount || 10
    const totalPurse = rules?.totalPurse || 100000
    
    // Calculate auction stage and competition level
    const totalPlayers = auction.players.length
    const soldPlayers = auction.players.filter(p => p.status === 'SOLD').length
    const auctionProgress = totalPlayers > 0 ? (soldPlayers / totalPlayers) * 100 : 0
    const auctionStage = auctionProgress < 33 ? 'Early' : auctionProgress < 67 ? 'Mid' : 'Late'
    const competitionLevel = bidHistory.length > 2 ? 'high' : bidHistory.length > 0 ? 'medium' : 'low'
    
    // Get bidders choice pool (if available in auction data)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const biddersChoicePool = (auction as any).biddersChoicePool || null
    
    // Prepare comprehensive context for AI
    const biddersContext = auction.bidders.map(bidder => {
      const purchased = auction.players.filter(p => p.status === 'SOLD' && p.soldTo === bidder.id)
      const totalSpent = purchased.reduce((sum, p) => sum + (p.soldPrice || 0), 0)
      const avgSpentPerPlayer = purchased.length > 0 ? totalSpent / purchased.length : 0
      
      return {
        id: bidder.id,
        name: bidder.user?.name || bidder.username,
        teamName: bidder.teamName,
        remainingPurse: bidder.remainingPurse,
        initialPurse: bidder.purseAmount || bidder.remainingPurse,
        spent: totalSpent,
        playersPurchased: purchased.length,
        avgSpentPerPlayer: avgSpentPerPlayer,
        purseUtilization: ((bidder.purseAmount || bidder.remainingPurse) - bidder.remainingPurse) / (bidder.purseAmount || bidder.remainingPurse) * 100,
        canAfford: bidder.remainingPurse >= minBidIncrement
      }
    })

    // Get players purchased by each bidder
    const purchasedPlayers = auction.players.filter(p => p.status === 'SOLD' && p.soldTo)
    const teamCompositions = biddersContext.map(bidder => {
      const purchased = purchasedPlayers.filter(p => p.soldTo === bidder.id)
      return {
        bidderId: bidder.id,
        teamName: bidder.teamName,
        players: purchased.map(p => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const data = p.data as any
          return {
            name: data?.Name || data?.name || 'Unknown',
            speciality: data?.Speciality || 'N/A',
            batting: data?.['Batting Type'] || 'N/A',
            bowling: data?.['Bowling Type'] || 'N/A',
            price: p.soldPrice || 0
          }
        })
      }
    })
    
    // Analyze team needs for each bidder (dynamic based on sold players)
    const teamNeedsAnalysis = biddersContext.map(bidder => {
      const purchased = purchasedPlayers.filter(p => p.soldTo === bidder.id)
      return analyzeTeamNeeds(bidder.id, bidder.teamName || 'Unknown', purchased, auctionState)
    })
    
    // Get nominated priorities for each bidder (if available)
    const biddersWithPriorities = biddersContext.map(b => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nominatedPriorities = (b as any).nominatedPriorities || null
      return {
        ...b,
        nominatedPriorities
      }
    })

    // Prepare prompt for OpenAI using the comprehensive APL 2026 format
    const prompt = `You are an expert auction analyst for the Assetz Premier League (APL) 2026 cricket auction. Analyze the provided data strictly based on the auction rules from the rulebook, without inventing, modifying, or using mock data. All predictions must derive solely from the input data: player details, bidders' information, team compositions, bid history, and auction context. Use the mind map of factors to evaluate matches between the player and each bidder for intent, aggressiveness, and price predictions.

AUCTION RULES FROM RULEBOOK (STRICTLY ADHERE):

- Budget: Each bidder starts with ${totalPurse.toLocaleString('en-IN')} points (${(totalPurse / 1000).toFixed(0)}k points).

- Base Price: ${(playerData?.['Base Price'] || playerData?.['base price'] || 1000)} points (${((playerData?.['Base Price'] || playerData?.['base price'] || 1000) / 1000).toFixed(0)}k) per player.

- Bid Increments: ${minBidIncrement} points (${(minBidIncrement / 1000).toFixed(0)}k) gap until 10,000 points, then ${minBidIncrement >= 2000 ? minBidIncrement : 2000} points (${((minBidIncrement >= 2000 ? minBidIncrement : 2000) / 1000).toFixed(0)}k) each. Bidders can start from higher amounts.

- Team Size: 12 players per team, including the bidder.

- Minimum Spend: At least ${minBidIncrement} points per player; no freebies.

- Pre-Auction: Bidders nominate top 3 priorities to form 'Bidders Choice' pool of 15 players (based on votes, ties resolved by second vote or MVP rankings).

- Auction Process: Starts with 'Bidders Choice', then rest of roster. Each player auctioned once; unsold to reserve pool. If teams not full, random allocation from reserve at ${minBidIncrement} points each.

- Bidding: Clear paddle raise; auctioneer judges simultaneous raises.

- Replacements: Like-for-like by Grievance Committee (GC) post-auction; no backfill for partial availability.

- Other: No overseas restrictions; focus on men's category.

MIND MAP OF FACTORS (Use to Score Matches; Weights Based on Bidder Strategy and Data):

- Player-Related Factors (Intrinsic value; score 0-10 for match to bidder needs):

  - Performance Metrics: Runs scored, wickets taken, batting average/strike rate, bowling average/economy, recent form, match-winning contributions.

  - Role and Skills: Batsman, bowler, all-rounder, wicket-keeper; secondary skills (fielding, versatility); play style (aggressive for T20).

  - Experience and Demographics: Age (youth for potential, older for reliability); IPL/international/domestic experience (capped/uncapped); injury history/fitness.

  - Intangibles: Stardom, marketability, leadership/captaincy potential, availability, reputation.

- Bidder/Team-Related Factors (Constraints; score how player fills gaps):

  - Squad Composition: Current balance (e.g., need for batsmen/bowlers); depth; retention impact.

  - Budget: Remaining points; allocation strategy (e.g., save for marquee players).

  - Strategic Priorities: Focus on youth/long-term vs. short-term wins; risk tolerance; team goals.

- Auction/Market-Related Factors (External; adjust for competition):

  - Dynamics: Base price, auction order, competition level (number of interested bidders).

  - Market: Supply/demand for similar players; economic factors; winner's curse risk.

CURRENT PLAYER:

- Name: ${playerData?.Name || 'Unknown'}

- Speciality: ${playerData?.Speciality || 'N/A'}

- Batting: ${playerData?.['Batting Type'] || 'N/A'}

- Bowling: ${playerData?.['Bowling Type'] || 'N/A'}

- Base Price: ${(playerData?.['Base Price'] || playerData?.['base price'] || 1000)} points

${Object.keys(customColumnsData).length > 0 ? `- Custom Analytics Columns:\n${Object.entries(customColumnsData).map(([key, value]) => `  * ${key}: ${value || 'N/A'}`).join('\n')}` : ''}

- Full Player Data: ${JSON.stringify(playerData, null, 2)}

- Availability: ${playerData?.Availability || 'Full'} (both weekends or one)

${brilliantUpcomingPlayers && brilliantUpcomingPlayers.length > 0 ? `\nUPCOMING PLAYERS ANALYSIS:\n${brilliantUpcomingPlayers.slice(0, 10).map(p => `- ${p.name} (${p.speciality}) - Brilliance Score: ${p.brillianceScore} - Factors: ${p.factors.join(', ')}`).join('\n')}\n` : ''}

BIDDERS (Detailed Analysis):

IMPORTANT: Each bidder has a unique ID that MUST be used. Use exact bidderId, teamName, and bidderName provided.

${biddersWithPriorities.map(b => {
  const composition = teamCompositions.find(t => t.bidderId === b.id)
  const players = composition?.players || []
  const specialities = players.map(p => p.speciality)
  const battingTypes = players.map(p => p.batting).filter(Boolean)
  const bowlingTypes = players.map(p => p.bowling).filter(Boolean)
  
  return `
- Bidder ID: ${b.id}
  Team Name: ${b.teamName || b.name || 'Unknown'}
  Bidder Name: ${b.name || b.teamName || 'Unknown'}
  * Remaining Points: ${b.remainingPurse} (${(100 - b.purseUtilization).toFixed(1)}% remaining)
  * Total Spent: ${b.spent} (${b.purseUtilization.toFixed(1)}% utilized)
  * Players Purchased: ${b.playersPurchased}
  * Average Spent per Player: ${b.avgSpentPerPlayer}
  * Can Afford Next Bid: ${b.canAfford ? 'Yes' : 'No'}
  * Team Composition:
    - Specialities: ${[...new Set(specialities)].join(', ') || 'None'}
    - Batting Types: ${[...new Set(battingTypes)].join(', ') || 'None'}
    - Bowling Types: ${[...new Set(bowlingTypes)].join(', ') || 'None'}
  * Team Needs Analysis (Dynamic - based on sold players):
    - Needs more batters: ${battingTypes.length < 3 ? 'Yes' : 'No'}
    - Needs more bowlers: ${bowlingTypes.length < 3 ? 'Yes' : 'No'}
    - Needs allrounders: ${!specialities.includes('Allrounder') ? 'Yes' : 'No'}
  * Nominated Priorities: ${b.nominatedPriorities?.join(', ') || 'None'} (if available)
  * **DYNAMIC TEAM NEEDS**: ${(() => {
      const teamNeeds = teamNeedsAnalysis.find(t => t.bidderId === b.id)
      if (teamNeeds) {
        return `Needs: ${teamNeeds.needs.join(', ') || 'Balanced'}, Urgency: ${teamNeeds.urgency}/10 - ${teamNeeds.reasoning}`
      }
      return 'Not calculated'
    })()}
`
}).join('')}

TEAM COMPOSITIONS:

${teamCompositions.map(t => `
- ${t.teamName}:
  ${t.players.map(p => `  * ${p.name} (${p.speciality}) - ${p.price} points`).join('\n')}
`).join('')}

BID HISTORY FOR THIS PLAYER:

${bidHistory.length > 0 ? bidHistory.map(b => `- ${b.bidderName || 'Unknown'} (${b.teamName || 'Unknown'}): ${b.amount || 'N/A'} points`).join('\n') : 'No bids yet'}

TUSHAR'S BIDDER INFO:

- Team: ${tusharBidder.teamName || tusharBidder.username}

- Remaining Points: ${tusharBidder.remainingPurse}

- Purchased: ${teamCompositions.find(t => t.bidderId === tusharBidder.id)?.players.length || 0} players

AUCTION CONTEXT:

- Total Bidders: ${auction.bidders.length} (or as provided)

- 'Bidders Choice' Pool: ${biddersChoicePool ? biddersChoicePool.join(', ') : 'Not specified'}

- Auction Stage: ${auctionState.auctionStage} (Progress: ${auctionState.progressPercent.toFixed(1)}% - ${auctionState.soldCount} sold, ${auctionState.availableCount} available)

- Competition Level: ${competitionLevel}

- **REMAINING PLAYER POOL ANALYSIS**:
  * Total Available Players: ${auctionState.availableCount}
  * Available by Speciality:
    - Bowlers: ${poolSummary.bowlersLeft} available
    - Batters: ${poolSummary.battersLeft} available
    - Allrounders: ${poolSummary.allroundersLeft} available
    - Wicket Keepers: ${poolSummary.keepersLeft} available
  * Current Player Pool Impact: ${poolImpact.toUpperCase()} supply (${poolImpact === 'high' ? 'many similar players left - may reduce aggression' : poolImpact === 'medium' ? 'moderate supply - standard bidding' : 'low supply - high demand, expect higher prices'})
  * **CRITICAL**: If many ${playerSpeciality} players remain unsold (${auctionState.playersBySpeciality[playerSpeciality]?.available || 0} available), bidders may be LESS aggressive on current player to save purse for better options. Factor this into probability and maxBid calculations.

CRITICAL RULES - DO NOT VIOLATE:

1. DO NOT create, modify, invent, or use mock data for players, bidders, teams, bids, or any values. All data is CONSTANT and provided above.

2. DO NOT generate duplicates. Each bidderId appears ONLY ONCE in arrays.

3. Use ONLY exact bidderId, teamName, bidderName from BIDDERS list.

4. Base analysis ONLY on provided data: player details/custom columns, bidder points/utilization, compositions, bid history, rules.

5. For predictions, use mind map factors to compute match scores (0-100): 40% Player-Related, 30% Bidder-Related, 30% Auction-Related.

6. Intent Probability: Sigmoid of match score (1 / (1 + exp(-0.1 * (score - 50))) * 100).

7. Aggressiveness: Low (<40 match), Medium (40-70), High (>70); adjust for purse and needs.

8. Price Predictions: Probable = base + (match / 100) * (performance premium from custom columns + intangibles); Min = probable - 20% variability; Max = probable + 30%; Avg = mean. Cap by remaining points; adhere to increments.

9. Account for interactions: High intent across bidders inflates max prices.

10. If upcoming strong players (from context), high-purse bidders less aggressive now.

11. Custom columns critical for refining (e.g., ratings impact premiums).

Provide a JSON response with:

1. likelyBidders: Array of objects, one per bidder:

   - bidderId: Exact from data

   - teamName: Exact from data

   - intentProbability: 0-100

   - aggressiveness: Low/Medium/High

   - probablePrice: Number (points)

   - minPrice: Number

   - maxPrice: Number

   - averagePrice: Number

   - reasoning: Brief, data-based explanation

2. recommendedAction: { action: 'bid/pass/wait', recommendedAmount: Number (if bid), reasoning: String, confidence: 0-1 }

3. marketAnalysis: 

   - averageBid: Calculate from bid history (0 if none)

   - highestBid: From history (0 if none)

   - competitionLevel: low/medium/high

   - teamNeeds: Array of { bidderId, teamName, needs: [strings], urgency: 0-10 }

   - overallSummary: { topBidderId: String, expectedFinalPrice: Number, biddingWarLikelihood: Low/Medium/High }

Return ONLY valid JSON, no other text.`

    // Call OpenAI (only if requested and available)
    let predictions
    const openai = shouldUseOpenAI ? getOpenAI() : null
    if (openai && shouldUseOpenAI) {
      try {
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'You are an expert auction analyst. Always respond with valid JSON only, no markdown or code blocks.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.7,
          response_format: { type: 'json_object' }
        })

        const responseText = completion.choices[0]?.message?.content || '{}'
        
        // Clean the response text - remove markdown code blocks if present
        let cleanedText = responseText.trim()
        if (cleanedText.startsWith('```json')) {
          cleanedText = cleanedText.replace(/^```json\s*/, '').replace(/\s*```$/, '')
        } else if (cleanedText.startsWith('```')) {
          cleanedText = cleanedText.replace(/^```\s*/, '').replace(/\s*```$/, '')
        }
        
        // Parse JSON with error handling
        let parsed
        try {
          parsed = JSON.parse(cleanedText)
        } catch (parseError) {
          console.error('JSON parse error:', parseError)
          console.error('Response text:', cleanedText.substring(0, 500)) // Log first 500 chars
          // If parsing fails, use fallback
          throw new Error('Failed to parse OpenAI response as JSON')
        }
        
        // Validate parsed object
        if (!parsed || typeof parsed !== 'object') {
          console.error('Invalid parsed object:', parsed)
          throw new Error('OpenAI response is not a valid object')
        }
        
        // Validate and ensure all required fields exist
        // Deduplicate likelyBidders by bidderId
        const seenBidderIds = new Set<string>()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const uniqueLikelyBidders = (parsed.likelyBidders || []).filter((b: any) => {
          const bidderId = b.bidderId || ''
          if (!bidderId || seenBidderIds.has(bidderId)) {
            return false // Skip duplicates
          }
          seenBidderIds.add(bidderId)
          return true
        })
        
        // Get current bid and base price for calculations (no mock data)
        const currentBidForValidation = bidHistory.length > 0 ? bidHistory[0]?.amount || 0 : 0
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const basePriceForValidation = (currentPlayer.data as any)?.['Base Price'] || (currentPlayer.data as any)?.['base price'] || 1000
        const minIncrementForValidation = currentBidForValidation >= 10000 ? 2000 : 1000
        
        predictions = {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          likelyBidders: uniqueLikelyBidders.map((b: any) => {
            // Find the actual bidder from auction to get real names
            // Try multiple lookup strategies
            let actualBidder = auction.bidders.find(bid => bid.id === b.bidderId)
            
            // If not found by ID, try to match by team name or bidder name
            if (!actualBidder && b.teamName) {
              actualBidder = auction.bidders.find(bid => 
                bid.teamName?.toLowerCase() === b.teamName?.toLowerCase() ||
                bid.user?.name?.toLowerCase() === b.teamName?.toLowerCase() ||
                bid.username?.toLowerCase() === b.teamName?.toLowerCase()
              )
            }
            
            if (!actualBidder && b.bidderName) {
              actualBidder = auction.bidders.find(bid => 
                bid.user?.name?.toLowerCase() === b.bidderName?.toLowerCase() ||
                bid.username?.toLowerCase() === b.bidderName?.toLowerCase() ||
                bid.teamName?.toLowerCase() === b.bidderName?.toLowerCase()
              )
            }
            
            // Debug logging
            if (!actualBidder) {
              console.log(`[Analytics] Bidder not found for ID: ${b.bidderId}, teamName: ${b.teamName}, bidderName: ${b.bidderName}`)
              console.log(`[Analytics] Available bidders:`, auction.bidders.map(bid => ({
                id: bid.id,
                teamName: bid.teamName,
                username: bid.username,
                userName: bid.user?.name
              })))
            }
            
            // Always use actual bidder data if found, otherwise use AI response
            const actualTeamName = actualBidder?.teamName || b.teamName || ''
            const actualBidderName = actualBidder?.user?.name || actualBidder?.username || b.bidderName || ''
            
            // Use the actual bidder ID if we found a match
            const finalBidderId = actualBidder?.id || b.bidderId || ''
            
            // Handle both old format (probability 0-1, maxBid) and new format (intentProbability 0-100, maxPrice/probablePrice)
            // Convert intentProbability (0-100) to probability (0-1) if present
            let probability = 0
            if (typeof b.intentProbability === 'number') {
              probability = b.intentProbability / 100 // Convert 0-100 to 0-1
            } else if (typeof b.probability === 'number') {
              probability = b.probability
            }
            
            // Get maxBid from new format (maxPrice) or old format (maxBid)
            let finalMaxBid = 0
            if (typeof b.maxPrice === 'number' && b.maxPrice > 0) {
              finalMaxBid = b.maxPrice
            } else if (typeof b.probablePrice === 'number' && b.probablePrice > 0) {
              finalMaxBid = b.probablePrice
            } else if (typeof b.maxBid === 'number' && b.maxBid > 0) {
              finalMaxBid = b.maxBid
            }
            
            // Calculate reasonable max bid from actual data
            const basePrice = basePriceForValidation
            const reasonableMaxBid = actualBidder ? Math.min(
              actualBidder.remainingPurse * 0.4, // Max 40% of remaining purse
              currentBidForValidation > 0 
                ? currentBidForValidation * 3 // Max 3x current bid
                : basePrice * 10, // Max 10x base price if no bids
              actualBidder.remainingPurse - minIncrementForValidation // Leave room for at least one more bid
            ) : basePrice + minIncrementForValidation
            
            // If maxBid is 0 or invalid, use calculated value
            if (finalMaxBid === 0) {
              finalMaxBid = Math.max(
                basePrice + minIncrementForValidation,
                reasonableMaxBid
              )
            } else {
              // Validate AI's maxBid - cap it at reasonable limits
              finalMaxBid = Math.min(
                finalMaxBid,
                reasonableMaxBid,
                actualBidder ? actualBidder.remainingPurse * 0.5 : 100000 // Never exceed 50% of purse or 100k
              )
            }
            
            // Final validation: ensure it's at least base price + increment
            finalMaxBid = Math.max(finalMaxBid, basePrice + minIncrementForValidation)
            
            // Round all price values to nearest 1000 (bids must be in multiples of 1000)
            const roundedMaxBid = roundToNearestThousand(finalMaxBid)
            const roundedProbablePrice = b.probablePrice ? roundToNearestThousand(b.probablePrice) : undefined
            const roundedMinPrice = b.minPrice ? roundToNearestThousand(b.minPrice) : undefined
            const roundedMaxPrice = b.maxPrice ? roundToNearestThousand(b.maxPrice) : undefined
            const roundedAveragePrice = b.averagePrice ? roundToNearestThousand(b.averagePrice) : undefined
            
            // Adjust maxBid based on pool supply impact (if poolImpact is available)
            let poolAdjustedMaxBid = roundedMaxBid
            const availableSimilarPlayersForBidder = auctionState?.playersBySpeciality[playerSpeciality]?.available || 0
            if (poolImpact && poolImpact === 'high' && availableSimilarPlayersForBidder >= 15) {
              // Reduce maxBid by 15% if high supply
              poolAdjustedMaxBid = roundToNearestThousand(roundedMaxBid * 0.85)
            } else if (poolImpact && poolImpact === 'low' && availableSimilarPlayersForBidder < 5) {
              // Increase maxBid by 12% if low supply
              poolAdjustedMaxBid = roundToNearestThousand(roundedMaxBid * 1.12)
            }
            
            return {
              bidderId: finalBidderId,
              bidderName: actualBidderName || actualTeamName || 'Unknown Bidder',
              teamName: actualTeamName || actualBidderName || 'Unknown Team',
              probability: probability,
              maxBid: poolAdjustedMaxBid, // Use pool-adjusted maxBid
              reasoning: b.reasoning || 'No reasoning provided',
              // Include new format fields if present (rounded)
              ...(b.aggressiveness && { aggressiveness: b.aggressiveness }),
              ...(roundedProbablePrice && { probablePrice: roundedProbablePrice }),
              ...(roundedMinPrice && { minPrice: roundedMinPrice }),
              ...(roundedMaxPrice && { maxPrice: roundedMaxPrice }),
              ...(roundedAveragePrice && { averagePrice: roundedAveragePrice }),
              // Include pool impact info
              poolAdjustedMax: poolAdjustedMaxBid !== roundedMaxBid ? poolAdjustedMaxBid : undefined,
              poolImpact: poolImpact
            }
          }),
          recommendedAction: {
            action: parsed.recommendedAction?.action || 'wait',
            // Handle both new format (recommendedAmount) and old format (recommendedBid)
            // Round to nearest 1000 (bids must be in multiples of 1000)
            recommendedBid: typeof parsed.recommendedAction?.recommendedAmount === 'number'
              ? roundToNearestThousand(parsed.recommendedAction.recommendedAmount)
              : (typeof parsed.recommendedAction?.recommendedBid === 'number' 
                ? roundToNearestThousand(parsed.recommendedAction.recommendedBid)
                : undefined),
            reasoning: parsed.recommendedAction?.reasoning || 'No recommendation available',
            confidence: typeof parsed.recommendedAction?.confidence === 'number' 
              ? parsed.recommendedAction.confidence 
              : 0.5
          },
          marketAnalysis: {
            // Only use AI's averageBid if bidHistory exists, otherwise use calculated value
            // Round to nearest 1000 (bids must be in multiples of 1000)
            averageBid: bidHistory.length > 0 
              ? (typeof parsed.marketAnalysis?.averageBid === 'number' 
                  ? roundToNearestThousand(parsed.marketAnalysis.averageBid)
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  : roundToNearestThousand(bidHistory.reduce((sum: number, b: any) => sum + (b.amount || 0), 0) / bidHistory.length))
              : 0,
            // Only use AI's highestBid if bidHistory exists, otherwise use calculated value
            // Round to nearest 1000 (bids must be in multiples of 1000)
            highestBid: bidHistory.length > 0
              ? (typeof parsed.marketAnalysis?.highestBid === 'number' 
                  ? roundToNearestThousand(parsed.marketAnalysis.highestBid)
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  : roundToNearestThousand(Math.max(...bidHistory.map((b: any) => b.amount || 0))))
              : 0,
            competitionLevel: parsed.marketAnalysis?.competitionLevel || 'low',
            // Include remaining pool impact in market analysis
            remainingPoolImpact: poolImpact,
            remainingPoolSummary: poolSummary,
            // Include overallSummary if present (new format)
            // Round expectedFinalPrice to nearest 1000 if present
            ...(parsed.marketAnalysis?.overallSummary && {
              overallSummary: {
                ...parsed.marketAnalysis.overallSummary,
                ...(typeof parsed.marketAnalysis.overallSummary.expectedFinalPrice === 'number' && {
                  expectedFinalPrice: roundToNearestThousand(parsed.marketAnalysis.overallSummary.expectedFinalPrice)
                })
              }
            }),
            teamNeeds: (() => {
              // Deduplicate by bidderId - keep only the first occurrence
              const seen = new Set<string>()
              return (parsed.marketAnalysis?.teamNeeds || [])
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .filter((t: any) => {
                  const bidderId = t.bidderId || ''
                  if (!bidderId || seen.has(bidderId)) {
                    return false // Skip duplicates
                  }
                  seen.add(bidderId)
                  return true
                })
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .map((t: any) => {
                  // Find the actual bidder from auction to get real team name
                  // Try multiple lookup strategies
                  let actualBidder = auction.bidders.find(bid => bid.id === t.bidderId)
                  
                  // If not found by ID, try to match by team name
                  if (!actualBidder && t.teamName) {
                    actualBidder = auction.bidders.find(bid => 
                      bid.teamName?.toLowerCase() === t.teamName?.toLowerCase() ||
                      bid.user?.name?.toLowerCase() === t.teamName?.toLowerCase() ||
                      bid.username?.toLowerCase() === t.teamName?.toLowerCase()
                    )
                  }
                  
                  // Always use actual bidder data if found
                  let actualTeamName = actualBidder?.teamName || t.teamName || ''
                  
                  // If still no name, try to get from bidder data
                  if (!actualTeamName && actualBidder) {
                    actualTeamName = actualBidder.user?.name || actualBidder.username || ''
                  }
                  
                  // Use the actual bidder ID if we found a match
                  const finalBidderId = actualBidder?.id || t.bidderId || ''
                  
                  return {
                    bidderId: finalBidderId,
                    teamName: actualTeamName || 'Unknown Team',
                    needs: Array.isArray(t.needs) ? t.needs : [],
                    urgency: typeof t.urgency === 'number' ? t.urgency : 5
                  }
                })
            })()
          }
        }
      } catch (error) {
        console.error('OpenAI error:', error)
        // Fallback to basic predictions
        predictions = generateFallbackPredictions(
          biddersContext, 
          currentPlayer, 
          bidHistory, 
          tusharBidder, 
          teamCompositions, 
          auction.bidders, 
          upcomingPlayersAnalysis, 
          brilliantUpcomingPlayers,
          playerScore,
          auctionState,
          teamNeedsAnalysis
        )
      }
    } else {
      // No OpenAI requested or not available, use fallback
      console.log('[Analytics] Using fallback predictions (OpenAI not requested or not available)')
      predictions = generateFallbackPredictions(
        biddersContext, 
        currentPlayer, 
        bidHistory, 
        tusharBidder, 
        teamCompositions, 
        auction.bidders, 
        upcomingPlayersAnalysis, 
        brilliantUpcomingPlayers,
        playerScore,
        auctionState,
        teamNeedsAnalysis
      )
    }

    return NextResponse.json({ predictions })
  } catch (error) {
    console.error('Analytics error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('Error details:', {
      message: errorMessage,
      stack: error instanceof Error ? error.stack : undefined
    })
    return NextResponse.json(
      { 
        error: 'Failed to generate predictions',
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined
      },
      { status: 500 }
    )
  }
}

function generateFallbackPredictions(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bidders: any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  player: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bidHistory: any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tusharBidder: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  teamCompositions: any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  auctionBidders: any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  upcomingPlayersAnalysis?: any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  brilliantUpcomingPlayers?: any[],
  playerScore?: ScoreResult,
  auctionState?: AuctionState,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  teamNeedsAnalysis?: any[]
) {
  // Enhanced fallback logic considering all factors
  // Calculate metrics from bid history for THIS player only
  const currentBid = bidHistory.length > 0 ? bidHistory[0]?.amount || 0 : 0
  const highestBid = bidHistory.length > 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? Math.max(...bidHistory.map((b: any) => b.amount || 0))
    : 0
  const averageBid = bidHistory.length > 0
    ? bidHistory.reduce((sum, b) => sum + (b.amount || 0), 0) / bidHistory.length
    : 0
  
  // Determine min increment based on dynamic rule
  const minIncrement = currentBid >= 10000 ? 2000 : 1000

  // Factor in upcoming brilliant players
  const hasBrilliantUpcoming = brilliantUpcomingPlayers && brilliantUpcomingPlayers.length > 0
  const brilliantCount = brilliantUpcomingPlayers?.length || 0
  
  // Get player speciality and calculate pool impact
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const playerData = player?.data as any
  const playerSpeciality = playerData?.Speciality || playerData?.speciality || ''
  const poolImpact = auctionState ? calculateRemainingPoolImpact(playerSpeciality, auctionState) : 'medium'
  const availableSimilarPlayers = auctionState?.playersBySpeciality[playerSpeciality]?.available || 0

  // Include Tushar's bidder in the list (but mark them separately)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const tusharBidderData = bidders.find(b => b.id === tusharBidder.id)
  
  const likelyBidders = bidders
    .filter(b => {
      // Don't filter out Tushar - include them in the list
      // Filter bidders who can afford and have need
      if (!b.canAfford) return false
      if (b.remainingPurse < currentBid + minIncrement) return false
      
      // Consider team needs
      const needsBatter = b.teamNeeds?.includes('batter') || b.teamNeeds?.includes('Batter')
      const needsBowler = b.teamNeeds?.includes('bowler') || b.teamNeeds?.includes('Bowler')
      const needsAllrounder = b.teamNeeds?.includes('allrounder') || b.teamNeeds?.includes('Allrounder')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const playerSpeciality = (player?.data as any)?.Speciality || ''
      
      // If team has specific needs and player matches, higher probability
      const matchesNeed = (needsBatter && playerSpeciality.includes('Batter')) ||
                         (needsBowler && playerSpeciality.includes('Bowler')) ||
                         (needsAllrounder && playerSpeciality.includes('Allrounder'))
      
      // STRATEGIC FACTOR: If brilliant players are coming and bidder has high purse, they might save
      // But if they have urgent team needs, they might still bid
      const purseRemainingPercent = b.initialPurse > 0 ? (b.remainingPurse / b.initialPurse) * 100 : 0
      const mightSaveForBrilliant = hasBrilliantUpcoming && purseRemainingPercent > 60 && !matchesNeed
      
      // If they might save for brilliant players, be more selective
      if (mightSaveForBrilliant && !matchesNeed && b.remainingPurse > currentBid * 2) {
        // Still include but with lower probability (handled in map)
        return true
      }
      
      return matchesNeed || b.remainingPurse > currentBid * 1.5
    })
    .map(b => {
      // Advanced probability calculation using weighted factors
      // Factor 1: Purse Balance (0-0.35 weight)
      // Use actual total purse from auction rules, not hardcoded value
      const totalPurse = b.initialPurse || 100000 // Use bidder's actual initial purse
      const normalizedPurse = totalPurse > 0 ? Math.min(1, b.remainingPurse / totalPurse) : 0
      const purseFactor = normalizedPurse * 0.35
      
      // Factor 2: Purse Utilization (inverse - lower utilization = higher probability)
      // Utilization < 30%: high probability boost (0.25)
      // Utilization 30-60%: medium boost (0.15)
      // Utilization 60-80%: low boost (0.05)
      // Utilization > 80%: negative impact (-0.1)
      let utilizationFactor = 0
      if (b.purseUtilization < 30) {
        utilizationFactor = 0.25
      } else if (b.purseUtilization < 60) {
        utilizationFactor = 0.15
      } else if (b.purseUtilization < 80) {
        utilizationFactor = 0.05
      } else {
        utilizationFactor = -0.1
      }
      
      // Factor 3: Team Needs Match (0-0.2 weight) - Use dynamic team needs analysis
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const teamNeeds = (teamNeedsAnalysis as any)?.find((t: any) => t.bidderId === b.id)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const playerSpeciality = (player?.data as any)?.Speciality || ''
      
      let needFactor = 0
      if (teamNeeds) {
        // Use dynamic team needs analysis
        if (playerSpeciality.includes('Batter') && teamNeeds.needsBatters) {
          needFactor = 0.2 * (teamNeeds.urgency / 10) // Scale by urgency
        } else if (playerSpeciality.includes('Bowler') && teamNeeds.needsBowlers) {
          needFactor = 0.2 * (teamNeeds.urgency / 10)
        } else if (playerSpeciality.includes('Allrounder') && teamNeeds.needsAllrounders) {
          needFactor = 0.2 * (teamNeeds.urgency / 10)
        }
      } else {
        // Fallback to old logic if team needs analysis not available
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const composition = teamCompositions.find((t: any) => t.bidderId === b.id)
        const players = composition?.players || []
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const specialities = players.map((p: any) => p.speciality)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const battingTypes = players.map((p: any) => p.batting).filter(Boolean)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const bowlingTypes = players.map((p: any) => p.bowling).filter(Boolean)
        
        if (playerSpeciality.includes('Batter') && battingTypes.length < 3) {
          needFactor = 0.2
        } else if (playerSpeciality.includes('Bowler') && bowlingTypes.length < 3) {
          needFactor = 0.2
        } else if (playerSpeciality.includes('Allrounder') && !specialities.includes('Allrounder')) {
          needFactor = 0.2
        } else if (battingTypes.length < 2 || bowlingTypes.length < 2) {
          needFactor = 0.1 // General team building need
        }
      }
      
      // Factor 4: Spending Pattern (0-0.15 weight)
      // If avg spent per player is reasonable compared to total purse, more likely to bid
      // Use actual total purse to determine reasonable spending threshold (50% of total purse per player is reasonable)
      const totalPurseForBidder = b.initialPurse || 100000
      const reasonableSpendingThreshold = totalPurseForBidder * 0.5 // 50% of total purse per player
      const avgSpentFactor = b.avgSpentPerPlayer > 0 && b.avgSpentPerPlayer < reasonableSpendingThreshold ? 0.15 : 0.05
      
      // Factor 5: Players Purchased Count (0-0.05 weight)
      // Early in auction (few players) = higher probability
      const earlyAuctionFactor = b.playersPurchased < 5 ? 0.05 : 0
      
      // Factor 6: Upcoming Brilliant Players (0 to -0.2 weight) - NEGATIVE impact
      // If brilliant players are coming and bidder has high purse remaining, they might save
      let brilliantPlayerFactor = 0
      const purseRemainingPercent = b.initialPurse > 0 ? (b.remainingPurse / b.initialPurse) * 100 : 0
      
      if (hasBrilliantUpcoming && brilliantCount > 0) {
        // More brilliant players = more incentive to save
        const brilliantImpact = Math.min(0.2, (brilliantCount / 10) * 0.1) // Max -0.2 reduction
        
        // Higher purse remaining = more likely to save
        if (purseRemainingPercent > 70) {
          brilliantPlayerFactor = -brilliantImpact * 1.5 // Strong negative if high purse
        } else if (purseRemainingPercent > 50) {
          brilliantPlayerFactor = -brilliantImpact // Moderate negative
        } else if (purseRemainingPercent > 30) {
          brilliantPlayerFactor = -brilliantImpact * 0.5 // Weak negative
        }
        // If purse < 30%, they need to bid now, so no negative impact
      }
      
      // Factor 7: Remaining Pool Supply Impact (NEW) - NEGATIVE if high supply
      let poolSupplyFactor = 0
      if (poolImpact === 'high' && availableSimilarPlayers >= 15) {
        // High supply of similar players - reduce probability by 15-25%
        poolSupplyFactor = -0.2 * (availableSimilarPlayers / 30) // More available = more reduction
      } else if (poolImpact === 'low' && availableSimilarPlayers < 5) {
        // Low supply - increase probability by 10-15%
        poolSupplyFactor = 0.15 * (1 - availableSimilarPlayers / 5) // Fewer available = more increase
      }
      
      // Calculate final probability with normalization (include pool supply factor)
      const rawProbability = purseFactor + utilizationFactor + needFactor + avgSpentFactor + earlyAuctionFactor + brilliantPlayerFactor + poolSupplyFactor
      const probability = Math.max(0, Math.min(0.95, rawProbability))
      
      // Estimate max bid using stats-based predicted price as baseline
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const basePrice = (player?.data as any)?.['Base Price'] || (player?.data as any)?.['base price'] || 1000
      
      // Use stats-based predicted price if available, otherwise calculate
      const statsPredictedPrice = playerScore?.predictedPrice || (basePrice * 5) // Fallback to 5x base
      
      // Adjust for pool supply impact
      let poolAdjustedPrice = statsPredictedPrice
      if (poolImpact === 'high') {
        poolAdjustedPrice = statsPredictedPrice * 0.85 // Reduce by 15% if high supply
      } else if (poolImpact === 'low') {
        poolAdjustedPrice = statsPredictedPrice * 1.12 // Increase by 12% if low supply
      }
      
      const maxBid = Math.min(
        b.remainingPurse * 0.38, // Max 38% of remaining purse (reduced from 40% for safety)
        currentBid > 0 
          ? currentBid * 3 // Max 3x current bid
          : poolAdjustedPrice, // Use pool-adjusted stats price if no bids
        b.remainingPurse - minIncrement, // Leave room for at least one more bid
        playerScore?.maxPrice || 32000, // Cap at stats maxPrice
        100000 // Hard cap at 100k to prevent unrealistic values
      )
      
      // Ensure maxBid is at least base price + increment
      const minReasonableBid = Math.max(basePrice + minIncrement, minIncrement)
      
      // Build detailed reasoning based on factors
      const factors = []
      if (normalizedPurse > 0.7) factors.push('strong purse balance')
      if (b.purseUtilization < 30) factors.push('low purse utilization')
      if (needFactor > 0.15) factors.push('matches team needs')
      if (avgSpentFactor > 0.1) factors.push('reasonable spending pattern')
      if (earlyAuctionFactor > 0) factors.push('early auction phase')
      
      // Add brilliant players factor to reasoning if applicable
      let brilliantReasoning = ''
      if (hasBrilliantUpcoming && brilliantPlayerFactor < 0) {
        brilliantReasoning = ` Note: ${brilliantCount} brilliant player(s) coming up - may save purse (${Math.round(Math.abs(brilliantPlayerFactor) * 100)}% probability reduction).`
      }
      
      const reasoning = `Probability calculated using advanced model: ${Math.round(purseFactor * 100)}% purse factor, ${Math.round(utilizationFactor * 100)}% utilization factor, ${Math.round(needFactor * 100)}% team needs factor, ${Math.round(avgSpentFactor * 100)}% spending pattern factor${brilliantPlayerFactor !== 0 ? `, ${Math.round(brilliantPlayerFactor * 100)}% upcoming brilliant players factor` : ''}. Has ₹${b.remainingPurse.toLocaleString('en-IN')} remaining (${(100 - b.purseUtilization).toFixed(0)}% of purse unused). ${b.playersPurchased} players purchased, avg ₹${b.avgSpentPerPlayer.toLocaleString('en-IN')} per player. Key factors: ${factors.join(', ') || 'standard bidding pattern'}.${brilliantReasoning}`
      
      // Get actual names from auction bidders
      const actualAuctionBidder = auctionBidders.find(ab => ab.id === b.id)
      const actualTeamName = actualAuctionBidder?.teamName || 
                            actualAuctionBidder?.user?.name || 
                            actualAuctionBidder?.username ||
                            b.teamName || 
                            b.name || 
                            'Unknown Team'
      const actualBidderName = actualAuctionBidder?.user?.name || 
                              actualAuctionBidder?.username ||
                              b.name || 
                              b.teamName || 
                              'Unknown Bidder'
      
      // Ensure maxBid is calculated from actual data only (no mock values)
      // maxBid should be at least the minimum increment, but calculated from real data
      const finalMaxBid = Math.max(
        minReasonableBid, // At least base price + increment
        maxBid // Calculated from actual bidder data (already capped)
      )
      
      // Final safety check: never exceed 50% of remaining purse
      const absoluteMax = b.remainingPurse * 0.5
      const finalMaxBidCapped = Math.min(finalMaxBid, absoluteMax)
      
      // Round to nearest 1000 (bids must be in multiples of 1000)
      const roundedMaxBid = roundToNearestThousand(finalMaxBidCapped)
      
      return {
        bidderId: b.id,
        bidderName: actualBidderName,
        teamName: actualTeamName,
        probability: probability,
        maxBid: roundedMaxBid, // Rounded to nearest 1000
        reasoning: reasoning
      }
    })
    .sort((a, b) => {
      // Sort Tushar's bidder to the top if present
      if (a.bidderId === tusharBidder.id) return -1
      if (b.bidderId === tusharBidder.id) return 1
      return b.probability - a.probability
    })
    .slice(0, 5)

  // Calculate Tushar's team needs
  const tusharPurchased = bidders.find(b => b.id === tusharBidder.id)?.playersPurchased || 0
  const tusharSpent = bidders.find(b => b.id === tusharBidder.id)?.spent || 0
  const tusharAvg = tusharPurchased > 0 ? tusharSpent / tusharPurchased : 0
  const tusharUtilization = bidders.find(b => b.id === tusharBidder.id)?.purseUtilization || 0
  const tusharPurseRemainingPercent = tusharBidder.purseAmount > 0 
    ? (tusharBidder.remainingPurse / tusharBidder.purseAmount) * 100 
    : 0
  
  // Determine recommended action
  const canAfford = tusharBidder.remainingPurse >= currentBid + minIncrement
  const competitionLevel = likelyBidders.length > 2 ? 'high' : likelyBidders.length > 0 ? 'medium' : 'low'
  
  // Factor in upcoming brilliant players for Tushar's decision
  const shouldConsiderSaving = hasBrilliantUpcoming && 
                                 brilliantCount > 0 && 
                                 tusharPurseRemainingPercent > 50 &&
                                 !(player?.isIcon && tusharPurseRemainingPercent > 70) // Still bid on icons if high purse
  
  // Calculate estimated final price ONLY from actual data - NO MOCK VALUES
  // If no bids exist and no average bid, we cannot estimate - return 0 or undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const basePrice = (player?.data as any)?.['Base Price'] || (player?.data as any)?.['base price'] || 1000
  let estimatedFinalPrice: number | null = null
  
  if (currentBid > 0) {
    // If there's a current bid, estimate based on likely bidders and increments
    estimatedFinalPrice = currentBid + (likelyBidders.length * minIncrement * 2)
  } else if (averageBid > 0) {
    // If we have average bid data, use it
    estimatedFinalPrice = averageBid * 1.2
  } else {
    // No bids exist - cannot estimate. Use base price only as minimum reference, not as estimate
    // We'll handle this in the reasoning logic
    estimatedFinalPrice = null
  }
  
  let action: 'bid' | 'pass' | 'wait' = 'wait'
  let recommendedBid: number | undefined = undefined
  let reasoning = ''
  let confidence = 0.5
  
  if (!canAfford) {
    action = 'pass'
    reasoning = `Insufficient balance. You have ₹${tusharBidder.remainingPurse.toLocaleString('en-IN')} but need at least ₹${(currentBid + minIncrement).toLocaleString('en-IN')} to bid.`
    confidence = 0.8
  } else if (competitionLevel === 'high' && estimatedFinalPrice !== null && estimatedFinalPrice > tusharBidder.remainingPurse * 0.4) {
    action = 'pass'
    reasoning = `High competition expected. Estimated final price (₹${estimatedFinalPrice.toLocaleString('en-IN')}) may exceed your budget comfort zone. Consider saving purse for other players.`
    confidence = 0.7
  } else if (tusharUtilization > 70 && estimatedFinalPrice !== null && tusharAvg > 0 && estimatedFinalPrice > tusharAvg * 1.5) {
    action = 'wait'
    reasoning = `You've already spent ${tusharUtilization.toFixed(0)}% of your purse. This player may go for ₹${estimatedFinalPrice.toLocaleString('en-IN')}, which is ${((estimatedFinalPrice / tusharAvg - 1) * 100).toFixed(0)}% above your average spend. Monitor closely.`
    confidence = 0.65
  } else if (shouldConsiderSaving && !(player?.isIcon)) {
    // If brilliant players are coming and Tushar has good purse, consider waiting
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const brilliantNames = brilliantUpcomingPlayers?.slice(0, 3).map((p: any) => p.name).join(', ') || ''
    action = 'wait'
    reasoning = `STRATEGIC CONSIDERATION: ${brilliantCount} brilliant player(s) coming up (${brilliantNames}${brilliantCount > 3 ? '...' : ''}). You have ${tusharPurseRemainingPercent.toFixed(0)}% purse remaining (₹${tusharBidder.remainingPurse.toLocaleString('en-IN')}). Consider saving for brilliant players unless this player fills a critical team gap. Competition is ${competitionLevel}.`
    confidence = 0.75
  } else if (canAfford && competitionLevel !== 'high') {
    action = 'bid'
    // Recommended bid is always based on actual current bid or base price, never mock data
    // Round to nearest 1000 (bids must be in multiples of 1000)
    const rawRecommendedBid = currentBid > 0 ? currentBid + minIncrement : basePrice
    recommendedBid = roundToNearestThousand(rawRecommendedBid)
    let strategicNote = ''
    if (hasBrilliantUpcoming && brilliantCount > 0) {
      strategicNote = ` Note: ${brilliantCount} brilliant player(s) coming up - balance your spending.`
    }
    reasoning = `Good opportunity. Competition is ${competitionLevel}. Recommended bid: ₹${recommendedBid.toLocaleString('en-IN')}. You have ${(100 - tusharUtilization).toFixed(0)}% of purse remaining.${strategicNote}`
    confidence = 0.7
  } else {
    action = 'wait'
    let strategicNote = ''
    if (hasBrilliantUpcoming && brilliantCount > 0) {
      strategicNote = ` ${brilliantCount} brilliant player(s) coming up - consider your strategy.`
    }
    if (estimatedFinalPrice === null) {
      reasoning = `Monitor the bidding. ${likelyBidders.length} potential bidders identified. No bids placed yet - wait to see initial bids before deciding. Base price is ₹${basePrice.toLocaleString('en-IN')}.${strategicNote}`
    } else {
      reasoning = `Monitor the bidding. ${likelyBidders.length} potential bidders identified. Wait to see initial bids before deciding.${strategicNote}`
    }
    confidence = 0.6
  }
  
  const recommendedAction = {
    action,
    recommendedBid,
    reasoning,
    confidence
  }

  return {
    likelyBidders,
    recommendedAction,
    marketAnalysis: {
      // Round to nearest 1000 (bids must be in multiples of 1000)
      averageBid: roundToNearestThousand(averageBid), // Average of all bids for this current player
      highestBid: roundToNearestThousand(highestBid), // Highest bid amount for this current player
      competitionLevel: likelyBidders.length > 2 ? 'high' : likelyBidders.length > 0 ? 'medium' : 'low',
      teamNeeds: (() => {
        // Deduplicate by bidderId - use a Map to ensure uniqueness
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const teamNeedsMap = new Map<string, any>()
        
        bidders.forEach(b => {
          // Skip if we've already processed this bidder
          if (teamNeedsMap.has(b.id)) return
          
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const composition = teamCompositions.find((t: any) => t.bidderId === b.id)
          const players = composition?.players || []
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const specialities = players.map((p: any) => p.speciality)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const battingTypes = players.map((p: any) => p.batting).filter(Boolean)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const bowlingTypes = players.map((p: any) => p.bowling).filter(Boolean)
          
          const needs: string[] = []
          let urgency = 5
          
          if (battingTypes.length < 3) {
            needs.push('More Batters')
            urgency += 2
          }
          if (bowlingTypes.length < 3) {
            needs.push('More Bowlers')
            urgency += 2
          }
          if (!specialities.includes('Allrounder')) {
            needs.push('Allrounder')
            urgency += 1
          }
          if (b.remainingPurse < 20000) {
            needs.push('Budget Constraint')
            urgency -= 1
          }
          
          // Get team name from actual auction bidders first, then fallback to biddersContext
          const actualAuctionBidder = auctionBidders.find(ab => ab.id === b.id)
          const teamName = actualAuctionBidder?.teamName || 
                          actualAuctionBidder?.user?.name || 
                          actualAuctionBidder?.username ||
                          b.teamName || 
                          b.name || 
                          'Unknown Team'
          
          teamNeedsMap.set(b.id, {
            bidderId: b.id,
            teamName: teamName,
            needs: needs.length > 0 ? needs : ['Balanced Team'],
            urgency: Math.max(1, Math.min(10, urgency))
          })
        })
        
        // Convert map to array and sort by urgency
        return Array.from(teamNeedsMap.values()).sort((a, b) => b.urgency - a.urgency)
      })()
    }
  }
}

