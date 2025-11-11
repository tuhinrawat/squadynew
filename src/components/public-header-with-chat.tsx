'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { MessageCircle, Instagram } from 'lucide-react'
import dynamic from 'next/dynamic'
import { PROFESSIO_URL_HEADER } from '@/lib/constants'

const PublicChat = dynamic(
  () => import('@/components/public-chat').then(mod => ({ default: mod.PublicChat })),
  { ssr: false }
)

interface PublicHeaderWithChatProps {
  auctionId: string
}

export function PublicHeaderWithChat({ auctionId }: PublicHeaderWithChatProps) {
  const [isChatOpen, setIsChatOpen] = useState(false)

  return (
    <>
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 sticky top-0 z-40">
        <div className="max-w-full mx-auto px-3 sm:px-6">
          <div className="flex justify-between items-center h-14 sm:h-16">
            {/* Left: Logo + Powered by (Desktop and Mobile) */}
            <div className="flex items-center gap-1.5 sm:gap-2">
              <Link href="/" className="flex items-center flex-shrink-0">
                <Image src="/squady-logo.svg" alt="Squady" width={100} height={33} className="h-7 sm:h-8 w-auto" />
              </Link>
              <a href={PROFESSIO_URL_HEADER} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 sm:gap-1 px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-md border text-[9px] sm:text-xs bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800 shadow-sm hover:from-purple-100 hover:to-pink-100 dark:hover:from-purple-900/30 dark:hover:to-pink-900/30 animate-pulse whitespace-nowrap">
                <span className="hidden sm:inline">Powered by</span>
                <span className="sm:hidden">by</span>
                <span className="font-semibold">Professio</span>
              </a>
            </div>
            {/* Right: Instagram + Chat Icon + Register & Sign In (Desktop only) */}
            <div className="flex items-center gap-1.5 sm:gap-3">
              {/* Instagram Icon - Always visible */}
              <a
                href="https://www.instagram.com/squady.auction/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-pink-600 dark:text-pink-400 hover:text-pink-700 dark:hover:text-pink-300 transition-colors p-2"
                aria-label="Follow us on Instagram"
              >
                <Instagram className="h-5 w-5" />
              </a>
              {/* Chat Icon - Always visible */}
              <Button
                onClick={() => setIsChatOpen(true)}
                variant="ghost"
                size="sm"
                className="relative text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-900/20 p-2 h-auto"
                aria-label="Open Chat"
              >
                <MessageCircle className="h-5 w-5" />
              </Button>
              {/* Register & Sign In - Desktop only */}
              <div className="hidden sm:flex items-center gap-3">
                <Link href="/register">
                  <Button variant="ghost" size="sm" className="text-gray-700 dark:text-gray-300 h-9">
                    Register
                  </Button>
                </Link>
                <Link href="/signin">
                  <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white h-9">
                    Sign In
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </header>
      
      {/* Public Chat Component */}
      <PublicChat 
        auctionId={auctionId} 
        hideFloatingButton={true}
        externalIsOpen={isChatOpen}
        externalSetIsOpen={setIsChatOpen}
      />
    </>
  )
}

