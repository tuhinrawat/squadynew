import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { TeamStatsClient } from '@/components/team-stats-client'

export default async function TeamStatsPage({ params }: { params: { id: string } }) {
  // Fetch auction with players and bidders - publicly accessible
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
    redirect('/')
  }

  return <TeamStatsClient auction={auction} />
}

