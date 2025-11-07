import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Lazy load OpenAI to avoid build-time errors
function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) {
    return null
  }
  try {
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
    let bidHistory: any[] = []
    if (auction.bidHistory && typeof auction.bidHistory === 'object') {
      const bidHistoryData = auction.bidHistory as any
      if (Array.isArray(bidHistoryData)) {
        bidHistory = bidHistoryData.filter((bid: any) => bid.playerId === playerId)
      }
    }

    // Get player data
    const playerData = currentPlayer.data as any
    
    // Extract custom columns data if provided
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
      const data = p.data as any
      const name = data?.Name || data?.name || 'Unknown'
      
      // Calculate a "brilliance score" based on multiple factors
      let brillianceScore = 0
      let factors: string[] = []
      
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
    const rules = auction.rules as any
    const minBidIncrement = rules?.minBidIncrement || 1000
    const maxBidIncrement = rules?.maxBidIncrement
    const countdownSeconds = rules?.countdownSeconds || 30
    const iconPlayerCount = rules?.iconPlayerCount || 10
    const totalPurse = rules?.totalPurse || 100000
    
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

    // Prepare prompt for OpenAI
    const prompt = `You are an expert auction analyst for cricket player auctions. Analyze the following data and provide intelligent predictions.

AUCTION RULES:
- Minimum Bid Increment: ₹${minBidIncrement.toLocaleString('en-IN')}
- Maximum Bid Increment: ${maxBidIncrement ? `₹${maxBidIncrement.toLocaleString('en-IN')}` : 'No limit'}
- Countdown Timer: ${countdownSeconds} seconds
- Icon Players Count: ${iconPlayerCount}
- Total Purse per Bidder: ₹${totalPurse.toLocaleString('en-IN')}
- Dynamic Increment Rule: When current bid >= ₹10,000, minimum increment becomes ₹2,000

CURRENT PLAYER:
- Name: ${playerData?.Name || 'Unknown'}
- Speciality: ${playerData?.Speciality || 'N/A'}
- Batting: ${playerData?.['Batting Type'] || 'N/A'}
- Bowling: ${playerData?.['Bowling Type'] || 'N/A'}
- Is Icon Player: ${currentPlayer.isIcon ? 'Yes' : 'No'}
- Base Price: ₹${(playerData?.['Base Price'] || playerData?.['base price'] || 1000).toLocaleString('en-IN')}
${Object.keys(customColumnsData).length > 0 ? `- Custom Analytics Columns:\n${Object.entries(customColumnsData).map(([key, value]) => `  * ${key}: ${value || 'N/A'}`).join('\n')}` : ''}
- Full Player Data: ${JSON.stringify(playerData, null, 2)}

BIDDERS (Detailed Analysis):
IMPORTANT: Each bidder has a unique ID that MUST be used in your response. Use the exact bidderId provided below.
${biddersContext.map(b => {
  const composition = teamCompositions.find(t => t.bidderId === b.id)
  const players = composition?.players || []
  const specialities = players.map(p => p.speciality)
  const battingTypes = players.map(p => p.batting).filter(Boolean)
  const bowlingTypes = players.map(p => p.bowling).filter(Boolean)
  
  return `
- Bidder ID: ${b.id}
  Team Name: ${b.teamName || b.name || 'Unknown'}
  Bidder Name: ${b.name || b.teamName || 'Unknown'}
  * Remaining Purse: ₹${b.remainingPurse.toLocaleString('en-IN')} (${(100 - b.purseUtilization).toFixed(1)}% remaining)
  * Total Spent: ₹${b.spent.toLocaleString('en-IN')} (${b.purseUtilization.toFixed(1)}% utilized)
  * Players Purchased: ${b.playersPurchased}
  * Average Spent per Player: ₹${b.avgSpentPerPlayer.toLocaleString('en-IN')}
  * Can Afford Next Bid: ${b.canAfford ? 'Yes' : 'No'}
  * Team Composition:
    - Specialities: ${[...new Set(specialities)].join(', ') || 'None'}
    - Batting Types: ${[...new Set(battingTypes)].join(', ') || 'None'}
    - Bowling Types: ${[...new Set(bowlingTypes)].join(', ') || 'None'}
  * Team Needs Analysis:
    - Needs more batters: ${battingTypes.length < 3 ? 'Yes' : 'No'}
    - Needs more bowlers: ${bowlingTypes.length < 3 ? 'Yes' : 'No'}
    - Needs allrounders: ${!specialities.includes('Allrounder') ? 'Yes' : 'No'}
`
}).join('')}

TEAM COMPOSITIONS:
${teamCompositions.map(t => `
- ${t.teamName}:
  ${t.players.map(p => `  * ${p.name} (${p.speciality}) - ₹${p.price.toLocaleString('en-IN')}`).join('\n')}
`).join('')}

BID HISTORY FOR THIS PLAYER:
${bidHistory.map(b => `- ${b.bidderName} (${b.teamName}): ₹${b.amount?.toLocaleString('en-IN') || 'N/A'}`).join('\n')}

TUSHAR'S BIDDER INFO:
- Team: ${tusharBidder.teamName || tusharBidder.username}
- Remaining Purse: ₹${tusharBidder.remainingPurse.toLocaleString('en-IN')}
- Purchased: ${teamCompositions.find(t => t.bidderId === tusharBidder.id)?.players.length || 0} players

CRITICAL RULES - DO NOT VIOLATE:
1. DO NOT create, modify, or invent any player, bidder, team, or bid data. All data is CONSTANT and provided above.
2. DO NOT generate duplicate entries. Each bidder should appear ONLY ONCE in any array.
3. Use ONLY the exact bidderId, teamName, and bidderName from the BIDDERS list provided above.
4. DO NOT create new team names or bidder names. Use only what is provided.
5. Your analysis should be based ONLY on:
   - Player stats from the CURRENT PLAYER section and custom analytics columns
   - Bidder purse balances and utilization (from BIDDERS section)
   - Team compositions (from TEAM COMPOSITIONS section)
   - Bid history (from BID HISTORY section)
   - Auction rules (from AUCTION RULES section)
6. DO NOT alter or invent any of these values. They are FACTS, not suggestions.

Provide a JSON response with:
1. likelyBidders: Array of bidders likely to bid. CRITICAL: 
   - Each entry MUST include the exact "bidderId" from the BIDDERS list above
   - Use ONLY the exact teamName and bidderName from the BIDDERS list
   - Include probability (0-1), maxBid estimate, and reasoning
   - maxBid MUST be realistic and reasonable:
     * Should NOT exceed 40% of bidder's remaining purse
     * Should NOT exceed 3x the current bid (if bids exist)
     * Should NOT exceed 10x the base price (if no bids)
     * Typical range: ₹1,000 to ₹50,000 (rarely above ₹50k)
     * Example: If remaining purse is ₹80,000, maxBid should be around ₹20,000-₹32,000, NOT ₹3,000,000
   - NO DUPLICATES - each bidderId should appear only once
2. recommendedAction: Action for Tushar (bid/pass/wait), recommended bid amount if bidding, reasoning, and confidence (0-1)
3. marketAnalysis: 
   - averageBid: If BID HISTORY FOR THIS PLAYER has bids, calculate average of all bid amounts. If NO BIDS exist, return 0 (NOT a mock value).
   - highestBid: If BID HISTORY FOR THIS PLAYER has bids, use the highest bid amount. If NO BIDS exist, return 0 (NOT a mock value).
   - competitionLevel: low/medium/high based on number of likely bidders
   - teamNeeds: Array with ONE entry per bidder. CRITICAL:
     * Each entry MUST include the exact "bidderId" from the BIDDERS list
     * Use ONLY the exact teamName from the BIDDERS list
     * Include needs (array of strings) and urgency (0-10)
     * NO DUPLICATES - each bidderId should appear only once

Consider ALL factors:
- Auction rules (min/max increments, dynamic increment at ₹10k+)
- Remaining purse balances and utilization percentages
- Team composition needs (batting, bowling, allrounder balance)
- Bidding patterns from history (aggressive vs conservative bidders)
- Player's speciality and how it fits each team's gaps
- Competition level based on team needs and available purse
- Average spending patterns (some bidders spend more per player)
- Icon player status (if current player is icon, higher competition expected)
- Base price vs expected final price
- Time pressure (countdown timer creates urgency)
- Strategic considerations (saving purse for better players vs filling team gaps)
- **UPCOMING BRILLIANT PLAYERS (CRITICAL)**: 
  * If there are brilliant players coming up (see UPCOMING PLAYERS ANALYSIS above), bidders with high remaining purse are MORE LIKELY to SAVE their purse
  * This means they will bid LESS aggressively on the current player
  * Competition for current player may be LOWER if brilliant players are coming
  * Factor this into probability calculations - bidders with >60% purse remaining and brilliant players coming = LOWER probability to bid now
  * Factor this into recommended action - if brilliant players are coming and Tushar has high purse, consider waiting
- **CUSTOM ANALYTICS COLUMNS**: Pay special attention to any custom columns provided above. These may contain critical data like player ratings, performance metrics, experience levels, or other factors that significantly impact bidding decisions. Use these custom columns to refine probability calculations and max bid estimates.

Return ONLY valid JSON, no markdown formatting.`

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
        const basePriceForValidation = (currentPlayer.data as any)?.['Base Price'] || (currentPlayer.data as any)?.['base price'] || 1000
        const minIncrementForValidation = currentBidForValidation >= 10000 ? 2000 : 1000
        
        predictions = {
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
            
            // Validate maxBid - ensure it's realistic and not mock data
            // If AI returns 0 or invalid, calculate from actual bidder data
            let finalMaxBid = typeof b.maxBid === 'number' && b.maxBid > 0 ? b.maxBid : 0
            
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
            
            return {
              bidderId: finalBidderId,
              bidderName: actualBidderName || actualTeamName || 'Unknown Bidder',
              teamName: actualTeamName || actualBidderName || 'Unknown Team',
              probability: typeof b.probability === 'number' ? b.probability : 0,
              maxBid: finalMaxBid,
              reasoning: b.reasoning || 'No reasoning provided'
            }
          }),
          recommendedAction: {
            action: parsed.recommendedAction?.action || 'wait',
            recommendedBid: typeof parsed.recommendedAction?.recommendedBid === 'number' 
              ? parsed.recommendedAction.recommendedBid 
              : undefined,
            reasoning: parsed.recommendedAction?.reasoning || 'No recommendation available',
            confidence: typeof parsed.recommendedAction?.confidence === 'number' 
              ? parsed.recommendedAction.confidence 
              : 0.5
          },
          marketAnalysis: {
            // Only use AI's averageBid if bidHistory exists, otherwise use calculated value
            averageBid: bidHistory.length > 0 
              ? (typeof parsed.marketAnalysis?.averageBid === 'number' 
                  ? parsed.marketAnalysis.averageBid 
                  : (bidHistory.reduce((sum: number, b: any) => sum + (b.amount || 0), 0) / bidHistory.length))
              : 0,
            // Only use AI's highestBid if bidHistory exists, otherwise use calculated value
            highestBid: bidHistory.length > 0
              ? (typeof parsed.marketAnalysis?.highestBid === 'number' 
                  ? parsed.marketAnalysis.highestBid 
                  : Math.max(...bidHistory.map((b: any) => b.amount || 0)))
              : 0,
            competitionLevel: parsed.marketAnalysis?.competitionLevel || 'low',
            teamNeeds: (() => {
              // Deduplicate by bidderId - keep only the first occurrence
              const seen = new Set<string>()
              return (parsed.marketAnalysis?.teamNeeds || [])
                .filter((t: any) => {
                  const bidderId = t.bidderId || ''
                  if (!bidderId || seen.has(bidderId)) {
                    return false // Skip duplicates
                  }
                  seen.add(bidderId)
                  return true
                })
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
        predictions = generateFallbackPredictions(biddersContext, currentPlayer, bidHistory, tusharBidder, teamCompositions, auction.bidders, upcomingPlayersAnalysis, brilliantUpcomingPlayers)
      }
    } else {
      // No OpenAI requested or not available, use fallback
      console.log('[Analytics] Using fallback predictions (OpenAI not requested or not available)')
      predictions = generateFallbackPredictions(biddersContext, currentPlayer, bidHistory, tusharBidder, teamCompositions, auction.bidders, upcomingPlayersAnalysis, brilliantUpcomingPlayers)
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
  bidders: any[],
  player: any,
  bidHistory: any[],
  tusharBidder: any,
  teamCompositions: any[],
  auctionBidders: any[],
  upcomingPlayersAnalysis?: any[],
  brilliantUpcomingPlayers?: any[]
) {
  // Enhanced fallback logic considering all factors
  // Calculate metrics from bid history for THIS player only
  const currentBid = bidHistory.length > 0 ? bidHistory[0]?.amount || 0 : 0
  const highestBid = bidHistory.length > 0
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

  // Include Tushar's bidder in the list (but mark them separately)
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
      
      // Factor 3: Team Needs Match (0-0.2 weight)
      const composition = teamCompositions.find((t: any) => t.bidderId === b.id)
      const players = composition?.players || []
      const specialities = players.map((p: any) => p.speciality)
      const battingTypes = players.map((p: any) => p.batting).filter(Boolean)
      const bowlingTypes = players.map((p: any) => p.bowling).filter(Boolean)
      const playerSpeciality = (player?.data as any)?.Speciality || ''
      
      let needFactor = 0
      if (playerSpeciality.includes('Batter') && battingTypes.length < 3) {
        needFactor = 0.2
      } else if (playerSpeciality.includes('Bowler') && bowlingTypes.length < 3) {
        needFactor = 0.2
      } else if (playerSpeciality.includes('Allrounder') && !specialities.includes('Allrounder')) {
        needFactor = 0.2
      } else if (battingTypes.length < 2 || bowlingTypes.length < 2) {
        needFactor = 0.1 // General team building need
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
      
      // Calculate final probability with normalization
      const rawProbability = purseFactor + utilizationFactor + needFactor + avgSpentFactor + earlyAuctionFactor + brilliantPlayerFactor
      const probability = Math.max(0, Math.min(0.95, rawProbability))
      
      // Estimate max bid (conservative and realistic)
      // Cap at reasonable limits to avoid unrealistic values
      const basePrice = (player?.data as any)?.['Base Price'] || (player?.data as any)?.['base price'] || 1000
      const maxBid = Math.min(
        b.remainingPurse * 0.4, // Max 40% of remaining purse (was 30%)
        currentBid > 0 
          ? currentBid * 3 // Max 3x current bid (was 2.5x)
          : basePrice * 10, // Max 10x base price if no bids (instead of 20% of purse)
        b.remainingPurse - minIncrement, // Leave room for at least one more bid
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
      
      return {
        bidderId: b.id,
        bidderName: actualBidderName,
        teamName: actualTeamName,
        probability: probability,
        maxBid: finalMaxBidCapped, // Use capped value
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
    const brilliantNames = brilliantUpcomingPlayers?.slice(0, 3).map((p: any) => p.name).join(', ') || ''
    action = 'wait'
    reasoning = `STRATEGIC CONSIDERATION: ${brilliantCount} brilliant player(s) coming up (${brilliantNames}${brilliantCount > 3 ? '...' : ''}). You have ${tusharPurseRemainingPercent.toFixed(0)}% purse remaining (₹${tusharBidder.remainingPurse.toLocaleString('en-IN')}). Consider saving for brilliant players unless this player fills a critical team gap. Competition is ${competitionLevel}.`
    confidence = 0.75
  } else if (canAfford && competitionLevel !== 'high') {
    action = 'bid'
    // Recommended bid is always based on actual current bid or base price, never mock data
    recommendedBid = currentBid > 0 ? currentBid + minIncrement : basePrice
    let strategicNote = ''
    if (hasBrilliantUpcoming && brilliantCount > 0) {
      strategicNote = ` Note: ${brilliantCount} brilliant player(s) coming up - balance your spending.`
    }
    reasoning = `Good opportunity. Competition is ${competitionLevel}. Recommended bid: ₹${(recommendedBid || basePrice).toLocaleString('en-IN')}. You have ${(100 - tusharUtilization).toFixed(0)}% of purse remaining.${strategicNote}`
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
      averageBid, // Average of all bids for this current player
      highestBid, // Highest bid amount for this current player
      competitionLevel: likelyBidders.length > 2 ? 'high' : likelyBidders.length > 0 ? 'medium' : 'low',
      teamNeeds: (() => {
        // Deduplicate by bidderId - use a Map to ensure uniqueness
        const teamNeedsMap = new Map<string, any>()
        
        bidders.forEach(b => {
          // Skip if we've already processed this bidder
          if (teamNeedsMap.has(b.id)) return
          
          const composition = teamCompositions.find((t: any) => t.bidderId === b.id)
          const players = composition?.players || []
          const specialities = players.map((p: any) => p.speciality)
          const battingTypes = players.map((p: any) => p.batting).filter(Boolean)
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

