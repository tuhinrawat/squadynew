'use client'

import { useState } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'

export function ProfessioPromoButton() {
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Floating Button - Bottom Center */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-40 px-4 py-2.5 sm:px-5 sm:py-3 rounded-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white text-xs sm:text-sm font-medium shadow-lg hover:shadow-xl transition-all hover:scale-105 flex items-center gap-2 animate-pulse"
        aria-label="Explore Professio AI"
      >
        <span>✨</span>
        <span>Explore Professio AI</span>
      </button>

      {/* Bottom Sheet - Mobile & Desktop */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="sm:max-w-lg md:max-w-2xl h-[75vh] sm:h-[70vh] md:h-auto p-0 bg-gradient-to-br from-gray-900 via-purple-900 to-indigo-900 text-white border-t border-purple-500/30">
          <SheetHeader className="px-4 pt-6 sm:px-6 sm:pt-8">
            <SheetTitle className="text-left text-white text-xl sm:text-2xl">Your career AI best friend</SheetTitle>
            <SheetDescription className="text-left text-purple-200 text-sm sm:text-base">
              Professio AI helps you plan, upskill, and land roles faster.
            </SheetDescription>
          </SheetHeader>

          <div className="px-4 py-4 sm:px-6 sm:py-6 space-y-5 sm:space-y-6 overflow-y-auto max-h-[calc(75vh-120px)] sm:max-h-[calc(70vh-120px)] md:max-h-none">
            <ul className="space-y-4 text-sm sm:text-base text-purple-100">
              <li className="flex items-start gap-3">
                <span className="mt-1.5 h-2 w-2 rounded-full bg-pink-400 flex-shrink-0" />
                <span>
                  <strong className="text-white">ATS-optimized resume builder</strong> that rewrites bullets, calibrates keywords, and boosts screening scores.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1.5 h-2 w-2 rounded-full bg-pink-400 flex-shrink-0" />
                <span>
                  <strong className="text-white">CV analytics</strong> with instant strengths, gaps, and role-mapped recommendations you can apply in minutes.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1.5 h-2 w-2 rounded-full bg-pink-400 flex-shrink-0" />
                <span>
                  <strong className="text-white">AI mock interviews</strong> with targeted questions, real‑time feedback, and a readiness score.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1.5 h-2 w-2 rounded-full bg-pink-400 flex-shrink-0" />
                <span>
                  <strong className="text-white">Career path planning</strong> with personalized recommendations based on your skills and goals.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1.5 h-2 w-2 rounded-full bg-pink-400 flex-shrink-0" />
                <span>
                  <strong className="text-white">Skill gap analysis</strong> that identifies what you need to learn to land your dream role.
                </span>
              </li>
            </ul>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              <a
                href="https://professio.ai/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-md bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold px-4 py-2.5 transition-colors"
              >
                Build an ATS Resume
              </a>
              <a
                href="https://professio.ai/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-md border border-purple-400/50 bg-purple-900/30 hover:bg-purple-800/50 text-white text-sm font-semibold px-4 py-2.5 transition-colors"
              >
                Analyze My CV
              </a>
              <a
                href="https://professio.ai/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-md border border-purple-400/50 bg-purple-900/30 hover:bg-purple-800/50 text-white text-sm font-semibold px-4 py-2.5 transition-colors"
              >
                Mock Interview
              </a>
            </div>

            <div className="pt-2 border-t border-purple-500/30">
              <a
                href="https://professio.ai/"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white text-sm font-semibold px-4 py-3 transition-all hover:scale-105 shadow-lg"
              >
                <span>🚀</span>
                <span>Explore Professio AI</span>
              </a>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

