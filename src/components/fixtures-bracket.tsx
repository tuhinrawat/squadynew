'use client'

import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Calendar, MapPin, Trophy, Clock } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import Image from 'next/image'

interface Bidder {
  id: string
  teamName: string | null
  username: string
  logoUrl: string | null
  user: {
    name: string
    email: string
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
            {dateGroup.fixtures.map((fixture, index) => (
              <FixtureCard key={fixture.id} fixture={fixture} index={index} />
            ))}
          </motion.div>
        ))}
      </div>

      {/* Desktop View - Bracket Style */}
      <div className="hidden md:block">
        <div className="flex gap-8 overflow-x-auto pb-6">
          {fixturesByDate.map((dateGroup, groupIndex) => (
            <motion.div
              key={dateGroup.date}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: groupIndex * 0.15 }}
              className="flex-shrink-0"
              style={{ minWidth: '380px' }}
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
              <div className="space-y-6 relative">
                {dateGroup.fixtures.map((fixture, index) => (
                  <div key={fixture.id} className="relative">
                    <FixtureCard fixture={fixture} index={index} />
                    
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

function FixtureCard({ fixture, index }: { fixture: Fixture; index: number }) {
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

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.1 }}
      className="bg-white/10 backdrop-blur-md rounded-xl border border-white/20 overflow-hidden hover:shadow-xl transition-all duration-300 hover:border-white/40"
    >
      {/* Match Header */}
      <div className="bg-gradient-to-r from-purple-600/30 to-blue-600/30 p-3 border-b border-white/20">
        <div className="flex items-center justify-between">
          <h4 className="font-bold text-white text-sm">{fixture.matchName}</h4>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${getStatusColor(fixture.status)}`}>
            {fixture.status}
          </span>
        </div>
        {fixture.matchDate && (
          <div className="flex items-center gap-1 text-xs text-white/70 mt-1">
            <Clock className="h-3 w-3" />
            {format(parseISO(fixture.matchDate), 'h:mm a')}
          </div>
        )}
      </div>

      {/* Teams */}
      <div className="p-4 space-y-3">
        {/* Team 1 */}
        <TeamCard team={fixture.team1} />

        {/* VS Divider */}
        <div className="relative py-2">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-white/20"></div>
          </div>
          <div className="relative flex justify-center">
            <span className="bg-gradient-to-r from-red-500 to-orange-500 text-white text-xs font-bold px-3 py-1 rounded-full">
              VS
            </span>
          </div>
        </div>

        {/* Team 2 */}
        <TeamCard team={fixture.team2} />
      </div>

      {/* Match Details */}
      {(fixture.venue || fixture.result) && (
        <div className="px-4 pb-4 space-y-2">
          {fixture.venue && (
            <div className="flex items-center gap-2 text-xs text-white/60">
              <MapPin className="h-3 w-3" />
              <span>{fixture.venue}</span>
            </div>
          )}
          {fixture.result && (
            <div className="flex items-center gap-2 text-xs">
              <Trophy className="h-3 w-3 text-yellow-400" />
              <span className="text-white font-semibold">{fixture.result}</span>
            </div>
          )}
        </div>
      )}
    </motion.div>
  )
}

function TeamCard({ team }: { team: Bidder }) {
  const teamName = team.teamName || team.user.name
  const initials = teamName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)

  return (
    <div className="flex items-center gap-3 p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
      {/* Team Logo */}
      <div className="flex-shrink-0">
        {team.logoUrl ? (
          <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-white/30">
            <Image
              src={team.logoUrl}
              alt={teamName}
              width={40}
              height={40}
              className="w-full h-full object-contain"
            />
          </div>
        ) : (
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center border-2 border-white/30">
            <span className="text-white font-bold text-sm">{initials}</span>
          </div>
        )}
      </div>

      {/* Team Info */}
      <div className="flex-1 min-w-0">
        <h5 className="font-bold text-white text-sm truncate">{teamName}</h5>
        <p className="text-xs text-white/60 truncate">{team.username}</p>
      </div>
    </div>
  )
}

