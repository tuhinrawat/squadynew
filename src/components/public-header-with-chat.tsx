'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { MessageCircle } from 'lucide-react'
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
        <div className="max-w-full mx-auto px-4 sm:px-6">
          <div className="flex justify-between items-center h-16">
            {/* Left: Logo + Powered by (Desktop and Mobile) */}
            <div className="flex items-center gap-2">
              <Link href="/" className="flex items-center">
                <Image src="/squady-logo.svg" alt="Squady" width={120} height={40} className="h-8 w-auto" />
              </Link>
              <a href={PROFESSIO_URL_HEADER} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-md border text-[10px] sm:text-xs bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800 shadow-sm hover:from-purple-100 hover:to-pink-100 dark:hover:from-purple-900/30 dark:hover:to-pink-900/30 animate-pulse">
                <span className="hidden sm:inline">Powered by</span>
                <span className="sm:hidden">by</span>
                <span className="font-semibold">Professio</span>
              </a>
            </div>
            {/* Right: Chat Icon + Register & Sign In (Desktop only) */}
            <div className="flex items-center gap-2 sm:gap-4">
              {/* Chat Icon - Always visible */}
              <Button
                onClick={() => setIsChatOpen(true)}
                variant="ghost"
                size="sm"
                className="relative text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-900/20"
              >
                <MessageCircle className="h-5 w-5" />
                <span className="sr-only">Open Chat</span>
              </Button>
              {/* Register & Sign In - Desktop only */}
              <div className="hidden sm:flex items-center gap-4">
                <Link href="/register">
                  <Button variant="ghost" size="sm" className="text-gray-700 dark:text-gray-300">
                    Register
                  </Button>
                </Link>
                <Link href="/signin">
                  <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white">
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

