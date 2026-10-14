'use client'

import Link from 'next/link'
import Image from 'next/image'
import { Button } from '@/components/ui/button'

// The nav used to be copy-pasted verbatim across page.tsx, register/page.tsx,
// register/[id]/page.tsx and fairness/page.tsx - four independent places to
// keep in sync, which had already drifted (the footer next to one of these
// copies said "© 2024" while another said "© 2025"). One shared component
// instead of four copies.
export function SiteNav({ active }: { active?: 'auctions' | 'fairness' }) {
  return (
    <nav className="sticky top-0 z-40 bg-[#05070a]/85 backdrop-blur-md border-b border-white/[0.07]">
      <div className="max-w-6xl mx-auto px-5 sm:px-8">
        <div className="flex items-center justify-between h-[76px] gap-3 flex-wrap">
          <Link href="/" className="flex items-center flex-shrink-0">
            <Image src="/squady-logo.svg" alt="Squady" width={120} height={22} className="h-7 w-auto" priority />
          </Link>

          <div className="flex items-center gap-4 sm:gap-7 order-last sm:order-none w-full sm:w-auto justify-center sm:justify-start">
            <Link
              href="/register"
              className={`text-xs sm:text-sm font-semibold transition-colors ${active === 'auctions' ? 'text-amber-400' : 'text-white/70 hover:text-white'}`}
            >
              Live Auctions
            </Link>
            <Link
              href="/fairness"
              className={`text-xs sm:text-sm font-semibold transition-colors ${active === 'fairness' ? 'text-amber-400' : 'text-white/70 hover:text-white'}`}
            >
              How Fairness Works
            </Link>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <Link href="/signin">
              <Button variant="ghost" size="sm" className="h-9 px-3 sm:px-5 text-white/80 hover:text-white hover:bg-white/10">
                Sign In
              </Button>
            </Link>
            <Link href="/signup">
              <Button
                size="sm"
                className="h-9 px-4 sm:px-5 bg-gradient-to-b from-amber-300 to-amber-400 text-amber-950 font-bold hover:brightness-105"
              >
                Get Started
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </nav>
  )
}
