'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Menu, LayoutDashboard, Hammer, Settings, LogOut, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

interface User {
  id: string
  name: string
  role: string
}

interface MobileNavigationProps {
  user: User
  auctionCount: number
}

export function MobileNavigation({ user, auctionCount }: MobileNavigationProps) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  const isActive = (path: string) => pathname === path

  const navigation = [
    {
      name: 'Dashboard',
      href: '/dashboard',
      icon: LayoutDashboard,
      show: true
    },
    {
      name: 'Auctions',
      href: '/dashboard/auctions',
      icon: Hammer,
      show: true
    },
    {
      name: 'Settings',
      href: '/dashboard/settings',
      icon: Settings,
      show: user.role === 'SUPER_ADMIN'
    }
  ]

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="lg:hidden text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 -ml-2"
        >
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-64 p-0 bg-white dark:bg-gray-900">
        <SheetHeader className="p-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          <SheetTitle className="text-left text-gray-900 dark:text-white">Menu</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col h-[calc(100vh-64px)] bg-white dark:bg-gray-900">
          {/* User Info */}
          <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">{user.name}</p>
                <p className="text-xs text-gray-600 dark:text-gray-300">
                  {auctionCount} auction{auctionCount !== 1 ? 's' : ''}
                </p>
              </div>
              {user.role === 'SUPER_ADMIN' && (
                <Badge className="text-xs bg-purple-600 text-white border-0">
                  Super Admin
                </Badge>
              )}
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-4 bg-white dark:bg-gray-900">
            <ul className="space-y-1">
              {navigation.map((item) => {
                if (!item.show) return null
                const Icon = item.icon
                const active = isActive(item.href)
                
                return (
                  <li key={item.name}>
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className={`flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                        active
                          ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                      {item.name}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </nav>

          {/* Footer Actions */}
          <div className="p-4 border-t border-gray-200 dark:border-gray-700 space-y-2 bg-white dark:bg-gray-900">
            <Link href="/tutorial" onClick={() => setOpen(false)}>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start text-gray-700 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                Tutorial
              </Button>
            </Link>
            <form action="/api/auth/signout" method="post">
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                className="w-full justify-start text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950"
              >
                <LogOut className="h-4 w-4 mr-2" />
                Logout
              </Button>
            </form>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
