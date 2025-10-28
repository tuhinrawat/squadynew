import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { MobileNavigation } from '@/components/mobile-navigation'
import { DashboardSidebar } from '@/components/dashboard-sidebar'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect('/signin')
  }

  // Check if user has ADMIN or SUPER_ADMIN role
  if (session.user?.role !== 'ADMIN' && session.user?.role !== 'SUPER_ADMIN') {
    redirect('/bidder/auctions')
  }

  // Get auction count for the header
  // SUPER_ADMIN can see all auctions, regular admins see only their own
  const auctionCount = await prisma.auction.count({
    where: session.user?.role === 'SUPER_ADMIN' 
      ? undefined 
      : { createdById: session.user.id }
  })

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-3">
              {/* Mobile Menu Button */}
              <MobileNavigation user={session.user} auctionCount={auctionCount} />
              <Link href="/dashboard" className="flex items-center">
                <Image src="/squady-logo.svg" alt="Squady" width={120} height={40} className="h-8 w-auto" />
              </Link>
            </div>
            <div className="hidden sm:flex items-center space-x-4">
              <a href="https://professio.ai/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800 shadow-sm hover:from-purple-100 hover:to-pink-100 dark:hover:from-purple-900/30 dark:hover:to-pink-900/30">
                <span className="hidden sm:inline">Powered by</span>
                <span className="font-semibold">Professio AI</span>
              </a>
              <Link href="/tutorial">
                <Button variant="ghost" size="sm" className="text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100">
                  Tutorial
                </Button>
              </Link>
              <div className="hidden md:block text-sm text-gray-600 dark:text-gray-400">
                <span className="font-medium">{session.user.name}</span>
                <span className="mx-2">•</span>
                <span>{auctionCount} auction{auctionCount !== 1 ? 's' : ''}</span>
              </div>
              <form action="/api/auth/signout" method="post">
                <Button type="submit" variant="ghost" size="sm" className="text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800">
                  Logout
                </Button>
              </form>
            </div>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar - Desktop Only */}
        <div className="hidden lg:block">
          <DashboardSidebar userRole={session.user?.role || 'ADMIN'} />
        </div>

        {/* Main Content */}
        <main className="flex-1 p-2 sm:p-4 lg:p-6 max-w-full overflow-hidden">
          <div className="max-w-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
