'use client'

import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Calendar, MapPin, Trophy, Clock, Filter } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import Image from 'next/image'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface Bidder {
  id: string
  teamName: string | null
  username: string
  logoUrl: string | null
  user: {
    name: string
    email: string
    profilePhoto: string | null
  }
}

interface Fixture {
  id: string
  matchName: string
  team1Id: string
  team2Id: string
  matchDate: string | null
  venue: string | null
  status: string
  result: string | null
  team1: Bidder
  team2: Bidder
}

interface FixturesBracketProps {
  fixtures: Fixture[]
}

export function FixturesBracket({ fixtures }: FixturesBracketProps) {
  const [selectedTeam, setSelectedTeam] = useState<string>('all')

  // Get all unique teams
  const allTeams = useMemo(() => {
    const teamsMap = new Map<string, { id: string; teamName: string | null; bidderName: string }>()
    fixtures.forEach(fixture => {
      if (!teamsMap.has(fixture.team1.id)) {
        teamsMap.set(fixture.team1.id, {
          id: fixture.team1.id,
          teamName: fixture.team1.teamName,
          bidderName: fixture.team1.user.name
        })
      }
      if (!teamsMap.has(fixture.team2.id)) {
        teamsMap.set(fixture.team2.id, {
          id: fixture.team2.id,
          teamName: fixture.team2.teamName,
          bidderName: fixture.team2.user.name
        })
      }
    })
    return Array.from(teamsMap.values()).sort((a, b) => {
      const aName = a.teamName || a.bidderName
      const bName = b.teamName || b.bidderName
      return aName.localeCompare(bName)
    })
  }, [fixtures])

  // Check if a fixture involves the selected team
  const isTeamInFixture = (fixture: Fixture) => {
    if (selectedTeam === 'all') return true
    return fixture.team1.id === selectedTeam || fixture.team2.id === selectedTeam
  }

  // Group fixtures by date
  const fixturesByDate = useMemo(() => {
    const grouped: { [key: string]: Fixture[] } = {}
    
    fixtures.forEach((fixture) => {
      const dateKey = fixture.matchDate 
        ? format(parseISO(fixture.matchDate), 'yyyy-MM-dd')
        : 'No Date'
      
      if (!grouped[dateKey]) {
        grouped[dateKey] = []
      }
      grouped[dateKey].push(fixture)
    })

    // Sort dates
    const sortedDates = Object.keys(grouped).sort((a, b) => {
      if (a === 'No Date') return 1
      if (b === 'No Date') return -1
      return a.localeCompare(b)
    })

    return sortedDates.map(date => ({
      date,
      fixtures: grouped[date]
    }))
  }, [fixtures])

  if (fixtures.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Trophy className="h-16 w-16 text-gray-400 mb-4" />
        <h3 className="text-xl font-semibold text-gray-600 dark:text-gray-400 mb-2">
          No Fixtures Scheduled
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-500">
          Fixtures will appear here once they are created
        </p>
      </div>
    )
  }

  return (
    <div className="relative">
      {/* Team Filter */}
      <div className="mb-6 flex items-center gap-3">
        <Filter className="h-4 w-4 text-white/60" />
        <Select value={selectedTeam} onValueChange={setSelectedTeam}>
          <SelectTrigger className="w-full sm:w-64 bg-white/10 border-white/20 text-white">
            <SelectValue placeholder="Filter by team" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Teams</SelectItem>
            {allTeams.map(team => (
              <SelectItem key={team.id} value={team.id}>
                {team.teamName ? `${team.teamName} (${team.bidderName})` : team.bidderName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedTeam !== 'all' && (
          <span className="text-xs text-white/60">
            {fixtures.filter(f => isTeamInFixture(f)).length} match{fixtures.filter(f => isTeamInFixture(f)).length !== 1 ? 'es' : ''}
          </span>
        )}
      </div>
      {/* Mobile View - Vertical Stack */}
      <div className="block md:hidden space-y-6">
        {fixturesByDate.map((dateGroup, groupIndex) => (
          <motion.div
            key={dateGroup.date}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: groupIndex * 0.1 }}
            className="space-y-4"
          >
            {/* Date Header */}
            <div className="flex items-center gap-2 mb-4">
              <Calendar className="h-5 w-5 text-blue-400" />
              <h3 className="text-lg font-bold text-white">
                {dateGroup.date === 'No Date' 
                  ? 'Unscheduled'
                  : format(parseISO(dateGroup.date), 'MMMM d, yyyy')}
              </h3>
            </div>

            {/* Fixtures for this date */}
            {dateGroup.fixtures
              .filter(f => isTeamInFixture(f))
              .map((fixture, index) => (
                <FixtureCard 
                  key={fixture.id} 
                  fixture={fixture} 
                  index={index}
                  isHighlighted={selectedTeam !== 'all' && isTeamInFixture(fixture)}
                  selectedTeamId={selectedTeam}
                />
              ))}
          </motion.div>
        ))}
      </div>

      {/* Desktop View - Bracket Style / Tree View */}
      <div className="hidden md:block">
        <div className="flex gap-4 overflow-x-auto pb-6">
          {fixturesByDate.map((dateGroup, groupIndex) => (
            <motion.div
              key={dateGroup.date}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: groupIndex * 0.15 }}
              className="flex-shrink-0"
              style={{ minWidth: '280px' }}
            >
              {/* Date Column Header */}
              <div className="sticky top-0 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg p-4 mb-6 z-10">
                <div className="flex items-center gap-2 text-white">
                  <Calendar className="h-5 w-5" />
                  <div>
                    <h3 className="font-bold text-lg">
                      {dateGroup.date === 'No Date' 
                        ? 'Unscheduled'
                        : format(parseISO(dateGroup.date), 'MMM d, yyyy')}
                    </h3>
                    {dateGroup.date !== 'No Date' && (
                      <p className="text-xs text-blue-100">
                        {format(parseISO(dateGroup.date), 'EEEE')}
                      </p>
                    )}
                  </div>
                </div>
                <div className="text-xs text-white/80 mt-2">
                  {dateGroup.fixtures.length} {dateGroup.fixtures.length === 1 ? 'match' : 'matches'}
                </div>
              </div>

              {/* Fixtures */}
              <div className="space-y-3 relative">
                {dateGroup.fixtures
                  .filter(f => isTeamInFixture(f))
                  .map((fixture, index) => (
                    <div key={fixture.id} className="relative">
                      <FixtureCard 
                        fixture={fixture} 
                        index={index}
                        isHighlighted={selectedTeam !== 'all' && isTeamInFixture(fixture)}
                        selectedTeamId={selectedTeam}
                      />
                    
                    {/* Connecting Line to Next Column */}
                    {groupIndex < fixturesByDate.length - 1 && (
                      <svg
                        className="absolute left-full top-1/2 -translate-y-1/2 pointer-events-none"
                        width="32"
                        height="2"
                        style={{ zIndex: -1 }}
                      >
                        <motion.line
                          x1="0"
                          y1="1"
                          x2="32"
                          y2="1"
                          stroke="rgba(59, 130, 246, 0.5)"
                          strokeWidth="2"
                          strokeDasharray="5,5"
                          initial={{ pathLength: 0 }}
                          animate={{ pathLength: 1 }}
                          transition={{ duration: 0.8, delay: groupIndex * 0.2 + index * 0.1 }}
                        />
                      </svg>
                    )}
                  </div>
                ))}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  )
}

function FixtureCard({ 
  fixture, 
  index, 
  isHighlighted = false,
  selectedTeamId
}: { 
  fixture: Fixture; 
  index: number;
  isHighlighted?: boolean;
  selectedTeamId?: string;
}) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'SCHEDULED':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 border-blue-300'
      case 'COMPLETED':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border-green-300'
      case 'CANCELLED':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 border-red-300'
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200 border-gray-300'
    }
  }

  const opacity = selectedTeamId !== 'all' && !isHighlighted ? 'opacity-40' : 'opacity-100'

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.1 }}
      className={`bg-white/10 backdrop-blur-md rounded-lg border border-white/20 overflow-hidden hover:shadow-xl transition-all duration-300 hover:border-white/40 ${opacity}`}
    >
      {/* Match Header - COMPACT */}
      <div className="bg-gradient-to-r from-purple-600/30 to-blue-600/30 p-2 border-b border-white/20">
        <div className="flex items-center justify-between gap-2">
          <h4 className="font-bold text-white text-xs truncate">{fixture.matchName}</h4>
          <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-semibold border flex-shrink-0 ${getStatusColor(fixture.status)}`}>
            {fixture.status}
          </span>
        </div>
        {fixture.matchDate && (
          <div className="flex items-center gap-1 text-[10px] text-white/70 mt-0.5">
            <Clock className="h-2.5 w-2.5" />
            {format(parseISO(fixture.matchDate), 'h:mm a')}
          </div>
        )}
      </div>

      {/* Teams - COMPACT */}
      <div className="p-2 space-y-2">
        {/* Team 1 */}
        <TeamCard team={fixture.team1} isHighlighted={selectedTeamId === fixture.team1.id} />

        {/* VS Divider - COMPACT */}
        <div className="relative py-1">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-white/20"></div>
          </div>
          <div className="relative flex justify-center">
            <span className="bg-gradient-to-r from-red-500 to-orange-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
              VS
            </span>
          </div>
        </div>

        {/* Team 2 */}
        <TeamCard team={fixture.team2} isHighlighted={selectedTeamId === fixture.team2.id} />
      </div>

      {/* Match Details - COMPACT */}
      {(fixture.venue || fixture.result) && (
        <div className="px-2 pb-2 space-y-1">
          {fixture.venue && (
            <div className="flex items-center gap-1.5 text-[10px] text-white/60">
              <MapPin className="h-2.5 w-2.5 flex-shrink-0" />
              <span className="truncate">{fixture.venue}</span>
            </div>
          )}
          {fixture.result && (
            <div className="flex items-center gap-1.5 text-[10px]">
              <Trophy className="h-2.5 w-2.5 text-yellow-400 flex-shrink-0" />
              <span className="text-white font-semibold truncate">{fixture.result}</span>
            </div>
          )}
        </div>
      )}
    </motion.div>
  )
}

function TeamCard({ team, isHighlighted = false }: { team: Bidder; isHighlighted?: boolean }) {
  const teamName = team.teamName
  const bidderName = team.user.name
  const displayName = teamName || bidderName
  const initials = displayName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
  const profilePhoto = team.logoUrl || team.user.profilePhoto

  return (
    <div className={`flex items-center gap-2 p-1.5 rounded-md bg-white/5 hover:bg-white/10 transition-all ${
      isHighlighted ? 'ring-2 ring-yellow-400/60 bg-yellow-500/10' : ''
    }`}>
      {/* Team Logo - COMPACT */}
      <div className="flex-shrink-0">
        {profilePhoto ? (
          <div className="w-7 h-7 rounded-full overflow-hidden border border-white/30">
            <Image
              src={profilePhoto}
              alt={displayName}
              width={28}
              height={28}
              className="w-full h-full object-contain"
            />
          </div>
        ) : (
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center border border-white/30">
            <span className="text-white font-bold text-[10px]">{initials}</span>
          </div>
        )}
      </div>

      {/* Team Name + Bidder Name - COMPACT */}
      <div className="flex-1 min-w-0">
        {teamName ? (
          <>
            <h5 className="font-bold text-white text-xs truncate leading-tight">{teamName}</h5>
            <p className="text-[10px] text-white/60 truncate leading-tight">{bidderName}</p>
          </>
        ) : (
          <h5 className="font-semibold text-white text-xs truncate">{bidderName}</h5>
        )}
      </div>
    </div>
  )
}

