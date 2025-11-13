'use client'

import { useRef } from 'react'
import { Badge } from '@/components/ui/badge'
import Image from 'next/image'

interface PlayerData {
  [key: string]: unknown
  name?: string
  Name?: string
  player_name?: string
  Speciality?: string
  speciality?: string
  specialty?: string
  'Profile Photo'?: string
  'profile photo'?: string
  'Profile photo'?: string
  'PROFILE PHOTO'?: string
  profile_photo?: string
  ProfilePhoto?: string
}

interface TeamSquadPosterProps {
  team: {
    bidderId: string
    teamName: string
    bidderName: string
    logoUrl: string | null // Team logo (from form upload)
    bidderPhotoUrl?: string | null // Bidder photo (for retired players)
    username?: string // Bidder username to check if it's a retired player
    players: Array<{
      id: string
      soldPrice: number
      data: PlayerData
    }>
  }
  auctionName: string
  auctionDescription?: string | null
  auctionImage?: string | null
  auction?: {
    players?: Array<{
      id: string
      status: string
      data: PlayerData
    }>
  }
}

/**
 * Get player profile photo URL
 */
function getProfilePhotoUrl(playerData: PlayerData): string | undefined {
  const possibleKeys = [
    'Profile Photo',
    'profile photo',
    'Profile photo',
    'PROFILE PHOTO',
    'profile_photo',
    'ProfilePhoto'
  ]

  const rawValue = possibleKeys
    .map(key => playerData?.[key])
    .find(value => value !== undefined && value !== null && String(value).trim() !== '')

  if (!rawValue) {
    return undefined
  }

  const photoStr = String(rawValue).trim()

  let match = photoStr.match(/\/d\/([a-zA-Z0-9_-]+)/)
  if (match && match[1]) {
    return `/api/proxy-image?id=${match[1]}`
  }

  match = photoStr.match(/[?&]id=([a-zA-Z0-9_-]+)/)
  if (match && match[1]) {
    return `/api/proxy-image?id=${match[1]}`
  }

  if (photoStr.startsWith('http://') || photoStr.startsWith('https://')) {
    return photoStr
  }

  return undefined
}

/**
 * Get player name from data
 */
function getPlayerName(playerData: PlayerData): string {
  return playerData?.name || playerData?.Name || playerData?.player_name || 'Unknown Player'
}

/**
 * Get player specialty/role
 */
function getPlayerSpecialty(playerData: PlayerData): string {
  return playerData?.Speciality || playerData?.speciality || playerData?.specialty || 'Allrounder'
}

export function TeamSquadPoster({ team, auctionName, auctionDescription, auctionImage, auction }: TeamSquadPosterProps) {
  const posterRef = useRef<HTMLDivElement>(null)

  // Check if bidder was created from a retired player
  // Retired players have username starting with "retired_"
  const isRetiredPlayerBidder = team.username?.startsWith('retired_') || false
  
  // Get bidder photo URL - for retired players, use bidderPhotoUrl (from player profile photo)
  // For regular bidders, bidderPhotoUrl will be null
  let bidderPhotoUrl: string | null = team.bidderPhotoUrl || null
  
  // If bidderPhotoUrl is not set but this is a retired player, try to get it from player data
  if (!bidderPhotoUrl && auction?.players && isRetiredPlayerBidder) {
    const retiredPlayer = auction.players.find(p => {
      if (p.status !== 'RETIRED') return false
      // Match by checking if username contains player id
      const playerIdMatch = team.username?.match(/retired_(.+)/)
      if (playerIdMatch && playerIdMatch[1] === p.id) return true
      return false
    })
    
    if (retiredPlayer) {
      bidderPhotoUrl = getProfilePhotoUrl(retiredPlayer.data) || null
    }
  }
  
  // Team logo is always from logoUrl (from form upload)
  const teamLogoUrl = team.logoUrl

  // Generate hashtag from auction name
  const auctionHashtag = auctionName
    ? `#${auctionName.replace(/[^a-zA-Z0-9]/g, '').replace(/\s+/g, '')}`
    : '#Auction'

  const teamDisplayName = team.teamName || team.bidderName || 'Team'

  return (
    <div className="space-y-4">
      <div className="relative w-full rounded-lg bg-gray-100 dark:bg-gray-900 overflow-hidden">
        {/* Poster Container - Fully Responsive */}
        <div
          ref={posterRef}
          className="relative w-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 overflow-hidden"
          style={{
            minHeight: '100vh',
            background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)'
          }}
        >
              {/* Cricket Background Image - 20% opacity */}
              <div 
                className="absolute inset-0"
                style={{
                  backgroundImage: 'url(/posterbg.png)',
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  backgroundRepeat: 'no-repeat',
                  opacity: 0.2
                }}
              />

          {/* Content Container - Responsive Padding */}
          <div className="relative z-10 h-full flex flex-col p-4 sm:p-6 md:p-8 lg:p-12 xl:p-16">
            {/* Top Header - Logos and Auction Info */}
            <div className="flex flex-row justify-between items-start gap-2 sm:gap-0 mb-4 sm:mb-6 md:mb-8 lg:mb-12">
              {/* Squady Logo - Top Left */}
              <div className="flex items-center flex-shrink-0">
                <Image 
                  src="/squady-logo.svg" 
                  alt="Squady" 
                  width={150} 
                  height={50} 
                  className="h-6 sm:h-8 md:h-10 lg:h-12 w-auto"
                  style={{
                    filter: 'brightness(0) invert(1) drop-shadow(2px 2px 4px rgba(0, 0, 0, 0.8))',
                  }}
                />
              </div>

              {/* Auction Info - Top Right */}
              <div className="flex flex-col items-end gap-1 sm:gap-2 md:gap-3 flex-shrink-0">
                {/* Auction Logo */}
                {auctionImage && (
                  <div 
                    className="w-12 h-12 sm:w-20 sm:h-20 md:w-24 md:h-24 lg:w-32 lg:h-32 rounded-lg sm:rounded-xl md:rounded-2xl overflow-hidden shadow-2xl border-2 sm:border-3 md:border-4 border-white/20 bg-white/5"
                  >
                    <img
                      src={auctionImage}
                      alt={auctionName}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                {/* Auction Title and Description */}
                {auctionDescription && (
                  <div className="text-right max-w-[120px] sm:max-w-xs md:max-w-sm lg:max-w-md hidden sm:block">
                    <p className="text-xs sm:text-sm text-white/80 font-medium" style={{ textShadow: '1px 1px 4px rgba(0, 0, 0, 0.8)' }}>
                      {auctionDescription}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Center Section - Responsive Typography */}
            <div className="flex flex-col items-center justify-center mb-4 sm:mb-6 md:mb-8 lg:mb-12 xl:mb-16 flex-1">
              <div className="flex flex-col items-center gap-2 sm:gap-3 md:gap-4 mb-3 sm:mb-4 md:mb-6">
                {/* Auction Name - Center */}
                <div className="text-center mb-2 sm:mb-3 md:mb-4">
                  <h2 
                    className="text-lg sm:text-xl md:text-2xl lg:text-3xl xl:text-4xl font-black text-white mb-1 sm:mb-2"
                    style={{
                      textShadow: '3px 3px 10px rgba(0, 0, 0, 0.8)',
                      letterSpacing: '1px sm:2px'
                    }}
                  >
                    {auctionName}
                  </h2>
                </div>

                {/* Bidder Name and Team Name - Responsive Layout */}
                <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-8 md:gap-12 mb-2 sm:mb-3 md:mb-4 w-full">
                  {/* Bidder Name Column */}
                  <div className="text-center px-4 sm:px-6 md:px-8">
                    <p 
                      className="text-xs sm:text-sm md:text-base lg:text-lg xl:text-xl font-semibold text-white/70 mb-1"
                      style={{
                        textShadow: '2px 2px 6px rgba(0, 0, 0, 0.8)'
                      }}
                    >
                      Bidder:
                    </p>
                    <p 
                      className="text-sm sm:text-base md:text-lg lg:text-xl xl:text-2xl font-bold text-white/90"
                      style={{
                        textShadow: '2px 2px 8px rgba(0, 0, 0, 0.8)'
                      }}
                    >
                      {team.bidderName}
                    </p>
                  </div>

                  {/* Team Name Column */}
                  <div className="text-center px-4 sm:px-6 md:px-8">
                    <div className="flex items-center justify-center gap-2 sm:gap-3">
                      <p 
                        className="text-sm sm:text-base md:text-lg lg:text-xl xl:text-2xl font-bold text-white/90"
                        style={{
                          textShadow: '2px 2px 8px rgba(0, 0, 0, 0.8)'
                        }}
                      >
                        {team.teamName || team.bidderName || 'Team'}
                      </p>
                      {/* Team Logo - Next to Team Name - Always show team logo from logoUrl */}
                      <div className="w-12 h-12 sm:w-[60px] sm:h-[60px] md:w-[72px] md:h-[72px] lg:w-24 lg:h-24 rounded-full overflow-hidden shadow-lg border-0 bg-white/10 backdrop-blur-sm flex items-center justify-center flex-shrink-0">
                        {teamLogoUrl ? (
                          <img
                            src={teamLogoUrl}
                            alt={team.teamName || 'Team Logo'}
                            className="w-full h-full object-contain p-1 sm:p-1.5 md:p-2"
                          />
                        ) : (
                          // Dummy team logo placeholder
                          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-500 to-purple-600">
                            <span className="text-white font-black text-[8px] sm:text-[10px] md:text-xs lg:text-sm">
                              {team.teamName?.charAt(0) || team.bidderName?.charAt(0) || 'T'}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* SQUAD Text */}
                <div className="text-center mb-2 sm:mb-3 md:mb-4">
                  <div 
                    className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-black text-yellow-400"
                    style={{
                      textShadow: '3px 3px 8px rgba(0, 0, 0, 0.8)',
                      letterSpacing: '2px sm:3px'
                    }}
                  >
                    SQUAD
                  </div>
                </div>
              </div>
            </div>

            {/* Players Grid - Fully Responsive */}
            <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 md:gap-6 lg:gap-8">
              {/* Regular Players */}
              {team.players.map((player) => {
                const playerData = player.data
                const playerName = getPlayerName(playerData)
                const photoUrl = getProfilePhotoUrl(playerData)
                const specialty = getPlayerSpecialty(playerData)

                return (
                  <div
                    key={player.id}
                    className="group relative rounded-lg sm:rounded-xl md:rounded-2xl overflow-hidden border-0 shadow-2xl bg-gradient-to-br from-slate-800/90 via-slate-900/90 to-slate-950/90 backdrop-blur-sm opacity-80 transition-all duration-300 hover:opacity-100 hover:scale-[1.02]"
                    style={{
                      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)'
                    }}
                  >
                    {/* Player Photo - Bigger on mobile */}
                    <div 
                      className="relative h-48 sm:h-32 md:h-36 lg:h-40 bg-gradient-to-b from-slate-700/80 to-slate-900/80 flex items-center justify-center"
                    >
                      {/* Status Badge - Top Right - Smaller on mobile */}
                      <div className="absolute top-1 right-1 sm:top-2 sm:right-2 md:top-3 md:right-3 z-20">
                        <Badge
                          variant="secondary"
                          className="bg-green-600 text-white border-0 backdrop-blur px-1 py-0.5 sm:px-2 sm:py-1 md:px-3 md:py-1 text-[10px] sm:text-xs md:text-sm font-bold"
                        >
                          SOLD
                        </Badge>
                      </div>
                      {photoUrl ? (
                        <img
                          src={photoUrl}
                          alt={playerName}
                          className="w-full h-full object-contain p-2 sm:p-1 md:p-2"
                          loading="lazy"
                          decoding="async"
                          onError={(e) => {
                            const target = e.currentTarget as HTMLImageElement
                            target.style.display = 'none'
                          }}
                        />
                      ) : (
                        <div className="w-20 h-20 sm:w-16 sm:h-16 md:w-20 md:h-20 lg:w-24 lg:h-24 rounded-full bg-white/20 flex items-center justify-center">
                          <span className="text-2xl sm:text-xl md:text-2xl lg:text-3xl font-bold text-white">
                            {playerName.charAt(0).toUpperCase()}
                          </span>
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-transparent to-transparent" />
                    </div>

                    {/* Player Info - Smaller on mobile */}
                    <div className="p-1.5 sm:p-3 md:p-4 space-y-1 sm:space-y-2 md:space-y-3 bg-gradient-to-t from-slate-900/80 via-slate-900/60 to-transparent backdrop-blur-sm">
                      {/* Name */}
                      <div>
                        <h4 className="text-white font-black text-[11px] sm:text-sm md:text-base lg:text-lg line-clamp-2 mb-0.5 sm:mb-2">
                          {playerName}
                        </h4>
                        {specialty && (
                          <p className="text-yellow-400 text-[10px] sm:text-xs md:text-sm font-bold uppercase tracking-wide">
                            {specialty}
                          </p>
                        )}
                        {/* Signed Label - Below role */}
                        <p className="text-green-100/70 text-[3px] sm:text-[4px] md:text-[5px] font-normal leading-tight mt-0.5 whitespace-nowrap">
                          Signed ₹{(player.soldPrice || 0).toLocaleString('en-IN')}
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })}

            {/* Bidder Card - Responsive - Always show with dummy placeholder */}
            <div 
              className="group relative rounded-lg sm:rounded-xl md:rounded-2xl overflow-hidden border-0 shadow-2xl bg-gradient-to-br from-violet-900/90 via-purple-900/90 to-slate-950/90 backdrop-blur-sm opacity-80 transition-all duration-300 hover:opacity-100 hover:scale-[1.02]"
              style={{
                boxShadow: '0 8px 32px rgba(168, 85, 247, 0.4), 0 0 30px rgba(168, 85, 247, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1)'
              }}
            >
              {/* Status Badge - Top Right - Smaller on mobile */}
              <div className="absolute top-1 right-1 sm:top-2 sm:right-2 md:top-3 md:right-3 z-20">
                <Badge
                  variant="secondary"
                  className="bg-violet-200 text-violet-950 border border-violet-300 backdrop-blur px-1 py-0.5 sm:px-2 sm:py-1 md:px-3 md:py-1 text-[10px] sm:text-xs md:text-sm font-bold"
                >
                  BIDDER
                </Badge>
              </div>

              {/* Bidder Photo - Bigger on mobile */}
              <div 
                className="relative h-48 sm:h-32 md:h-36 lg:h-40 bg-gradient-to-b from-slate-700 to-slate-900 flex items-center justify-center"
              >
                {bidderPhotoUrl ? (
                  <img
                    src={bidderPhotoUrl}
                    alt={team.bidderName}
                    className="w-full h-full object-contain p-2 sm:p-1 md:p-2"
                    loading="lazy"
                    decoding="async"
                    onError={(e) => {
                      const target = e.currentTarget as HTMLImageElement
                      target.style.display = 'none'
                    }}
                  />
                ) : (
                  // Dummy bidder placeholder
                  <div className="w-20 h-20 sm:w-16 sm:h-16 md:w-20 md:h-20 lg:w-24 lg:h-24 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                    <span className="text-2xl sm:text-xl md:text-2xl lg:text-3xl font-bold text-white">
                      {team.bidderName?.charAt(0).toUpperCase() || 'B'}
                    </span>
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-purple-900 via-transparent to-transparent" />
              </div>

                {/* Bidder Info - Smaller on mobile */}
                <div className="p-1.5 sm:p-3 md:p-4 space-y-1 sm:space-y-2 md:space-y-3 bg-gradient-to-t from-purple-900/80 via-purple-900/60 to-transparent backdrop-blur-sm">
                  {/* Name */}
                  <div>
                    <h4 className="text-white font-black text-[11px] sm:text-sm md:text-base line-clamp-2 mb-0.5 sm:mb-2">
                      {team.bidderName}
                    </h4>
                    {team.teamName && (
                      <p className="text-violet-300 text-[10px] sm:text-xs font-bold tracking-wide">
                        {team.teamName}
                      </p>
                    )}
                  </div>

                  {/* Bidder Status */}
                  <div 
                    className="bg-violet-500/20 border border-violet-400/30 rounded-md sm:rounded-lg p-1 sm:p-2 md:p-3 text-center"
                    style={{
                      boxShadow: '0 4px 12px rgba(168, 85, 247, 0.3)'
                    }}
                  >
                    <p className="text-violet-200/80 text-[8px] sm:text-[9px] md:text-[10px] font-normal mb-0.5 sm:mb-1 uppercase tracking-wide">Participating</p>
                    <p className="text-white text-xs sm:text-sm md:text-base font-bold">As Bidder</p>
                  </div>
                </div>
            </div>
          </div>

          {/* Bottom Text Section */}
          <div className="text-center mt-4 sm:mt-6 md:mt-8 lg:mt-12 space-y-2 sm:space-y-3">
            <p 
              className="text-white font-black text-sm sm:text-base md:text-lg lg:text-xl xl:text-2xl"
              style={{
                textShadow: '2px 2px 8px rgba(0, 0, 0, 0.8)'
              }}
            >
              {teamDisplayName} SQUAD FINALIZED!
            </p>
            <p 
              className="text-white/80 font-semibold text-xs sm:text-sm md:text-base lg:text-lg"
              style={{
                textShadow: '1px 1px 4px rgba(0, 0, 0, 0.8)'
              }}
            >
              The Hunt for the Trophy Starts NOW #Squady {auctionHashtag}
            </p>
          </div>
        </div>

      </div>
      </div>
    </div>
  )
}
