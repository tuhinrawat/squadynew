import Link from 'next/link'
import Image from 'next/image'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Shuffle, Star, RotateCcw, ShieldCheck, ArrowLeft } from 'lucide-react'

export const metadata = {
  title: 'How the Next Player Is Picked - Squady',
  description: 'The exact rule Squady uses to choose who comes up next in a live auction.',
}

export default function FairnessPage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-gradient-to-br from-teal-50 via-white to-blue-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      {/* Nav */}
      <nav className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-14 sm:h-16">
            <Link href="/" className="flex items-center flex-shrink-0">
              <Image src="/squady-logo.svg" alt="Squady" width={100} height={33} className="h-7 sm:h-8 w-auto" />
            </Link>
            <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100">
              <ArrowLeft className="h-4 w-4" />
              Home
            </Link>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        {/* Header */}
        <div className="text-center mb-12">
          <Badge className="mb-4 bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-900/40">
            For every bidder
          </Badge>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-gray-900 dark:text-white mb-4">
            How the Next Player Is Picked
          </h1>
          <p className="text-base sm:text-lg text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">
            This is the exact rule Squady uses to decide who comes up for auction next — not a
            summary, the actual rule, written in plain language, and identical to what runs in
            the code. No admin picks favorites, and no player&apos;s turn is decided on the spot.
          </p>
        </div>

        {/* Steps */}
        <div className="space-y-6">
          <Card className="border-0 shadow-lg">
            <CardHeader className="flex flex-row items-start gap-4 space-y-0">
              <div className="w-10 h-10 rounded-lg bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center flex-shrink-0">
                <Star className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <CardTitle className="text-lg">1. Icon players go first — no exceptions</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="text-gray-600 dark:text-gray-300 pl-[3.5rem] -mt-2">
              Every player falls into one of two groups when the roster is set up: <strong>Icon
              (&ldquo;Bidder&apos;s Choice&rdquo;)</strong> players, and everyone else. As long as
              even one Icon player hasn&apos;t been sold or marked unsold yet, the system will
              only draw from that group — it never looks at a regular player until every single
              Icon player has had their turn.
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg">
            <CardHeader className="flex flex-row items-start gap-4 space-y-0">
              <div className="w-10 h-10 rounded-lg bg-teal-100 dark:bg-teal-900/40 flex items-center justify-center flex-shrink-0">
                <Shuffle className="w-5 h-5 text-teal-600 dark:text-teal-400" />
              </div>
              <div>
                <CardTitle className="text-lg">2. Within that group, it&apos;s a genuine random draw</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="text-gray-600 dark:text-gray-300 pl-[3.5rem] -mt-2">
              Whichever group is currently &ldquo;live&rdquo; — Icon or regular — the specific
              player chosen is decided by the same kind of random draw a computer uses to shuffle
              a deck: every player still available in that group has an equal chance. There&apos;s
              no weighting by price, stats, team need, or anything else, and the admin running the
              auction doesn&apos;t choose who&apos;s next any more than the bidders do.
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg">
            <CardHeader className="flex flex-row items-start gap-4 space-y-0">
              <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center flex-shrink-0">
                <RotateCcw className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <CardTitle className="text-lg">3. Unsold players get another chance</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="text-gray-600 dark:text-gray-300 pl-[3.5rem] -mt-2">
              Once every regular player has either been sold or gone unsold at least once, anyone
              still marked unsold is automatically put back into the draw pool — like reshuffling
              a discard pile back into the deck — and the random draw continues from there. A
              player going unsold once doesn&apos;t mean they&apos;re done for the day.
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg">
            <CardHeader className="flex flex-row items-start gap-4 space-y-0">
              <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center flex-shrink-0">
                <ShieldCheck className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <CardTitle className="text-lg">4. It&apos;s the same rule everywhere, every time</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="text-gray-600 dark:text-gray-300 pl-[3.5rem] -mt-2">
              This exact rule runs identically whether a player is being picked right after a sale,
              when the auction first goes live, when the admin manually skips ahead, or even if the
              venue loses internet and the auction has to continue from Squady&apos;s offline backup
              console. There&apos;s no separate, looser process for exceptions — the fallback follows
              the same random, Icon-first rule as the main auction, so a network outage never becomes
              a reason someone&apos;s turn was decided differently.
            </CardContent>
          </Card>
        </div>

        <div className="mt-10 text-center text-sm text-gray-500 dark:text-gray-400">
          Have a question about how a specific auction ran? Ask that auction&apos;s admin — every
          sale, unsold call, and player order is kept in the auction&apos;s own history.
        </div>
      </main>
    </div>
  )
}
