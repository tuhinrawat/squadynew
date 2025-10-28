'use client'

import { useEffect, useState } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'

type FloatingPromoChipProps = {
  variant?: 'purple' | 'blue'
  sessionKey?: string
}

export default function FloatingPromoChip({ variant = 'purple', sessionKey = 'professio_promo_seen' }: FloatingPromoChipProps) {
  const [open, setOpen] = useState(false)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    try {
      const seen = sessionStorage.getItem(sessionKey)
      if (seen === 'hidden') {
        setHidden(true)
      }
    } catch {}
  }, [sessionKey])

  const hideForSession = () => {
    try {
      sessionStorage.setItem(sessionKey, 'hidden')
    } catch {}
    setHidden(true)
  }

  if (hidden) return null

  const chipClasses =
    variant === 'purple'
      ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg'
      : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg'

  return (
    <>
      {/* Floating Chip - Mobile only */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`sm:hidden fixed bottom-20 right-4 z-50 px-3 py-2 rounded-full text-xs font-semibold ${chipClasses}`}
        aria-label="What is Professio AI?"
      >
        What is Professio AI?
      </button>

      {/* Bottom Sheet */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="sm:hidden h-[70vh] p-0 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
          <SheetHeader className="px-4 pt-4">
            <SheetTitle className="text-left text-gray-900 dark:text-white">Your career AI best friend</SheetTitle>
            <SheetDescription className="text-left text-gray-700 dark:text-gray-300">Professio AI helps you plan, upskill, and land roles faster.</SheetDescription>
          </SheetHeader>

          <div className="px-4 py-4 space-y-5">
            <ul className="space-y-3 text-sm text-gray-800 dark:text-gray-200">
              <li className="flex items-start gap-2">
                <span className="mt-0.5 h-2 w-2 rounded-full bg-purple-500" />
                ATS-optimized resume builder that rewrites bullets, calibrates keywords, and boosts screening scores.
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 h-2 w-2 rounded-full bg-purple-500" />
                CV analytics with instant strengths, gaps, and role-mapped recommendations you can apply in minutes.
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 h-2 w-2 rounded-full bg-purple-500" />
                AI mock interviews with targeted questions, real‑time feedback, and a readiness score.
              </li>
            </ul>

            <div className="grid grid-cols-1 gap-2">
              <a
                href="https://professio.ai/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-md bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold px-4 py-2"
              >
                Build an ATS Resume
              </a>
              <a
                href="https://professio.ai/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-300 dark:border-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 text-sm font-semibold px-4 py-2"
              >
                Analyze My CV
              </a>
              <a
                href="https://professio.ai/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-300 dark:border-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 text-sm font-semibold px-4 py-2"
              >
                Start a Mock Interview
              </a>
            </div>

            <div className="flex gap-2 pt-2">
              <a
                href="https://professio.ai/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-md bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white text-sm font-semibold px-4 py-2"
              >
                Explore Professio AI
              </a>
              <button
                type="button"
                onClick={hideForSession}
                className="px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300"
              >
                Don’t show
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}


