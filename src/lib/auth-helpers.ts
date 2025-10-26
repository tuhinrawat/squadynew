import { prisma } from '@/lib/prisma'

export async function getUserAuctionAccess(userId: string, auctionId: string) {
  const auction = await prisma.auction.findUnique({
    where: { id: auctionId },
    include: { createdBy: true }
  })

  if (!auction) {
    return { hasAccess: false, role: null as any }
  }

  // Check if user is the admin who created the auction
  if (auction.createdById === userId) {
    return { hasAccess: true, role: 'ADMIN' as const }
  }

  // Check if user is a bidder in this auction
  const bidder = await prisma.bidder.findFirst({
    where: {
      auctionId,
      userId
    }
  })

  if (bidder) {
    return { hasAccess: true, role: 'BIDDER' as const }
  }

  return { hasAccess: false, role: null as any }
}

export function isAuthenticated(session: any): boolean {
  return !!session?.user
}

export function isAdmin(session: any): boolean {
  return session?.user?.role === 'ADMIN' || session?.user?.role === 'SUPER_ADMIN'
}

export function isSuperAdmin(session: any): boolean {
  return session?.user?.role === 'SUPER_ADMIN'
}

export function isBidder(session: any): boolean {
  return session?.user?.role === 'BIDDER'
}

