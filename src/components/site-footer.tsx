import Link from 'next/link'
import Image from 'next/image'
import { Instagram } from 'lucide-react'

// Every link here goes somewhere real. The previous footer (copy-pasted
// across four pages) had seven links - Features, Pricing, About, Support,
// Terms of Service, Privacy Policy, Cookie Policy - that were all literal
// href="#" placeholders with no page behind them, which is a real trust
// problem on a site people are about to hand player and bidder data to.
export function SiteFooter() {
  return (
    <footer className="border-t border-white/[0.07] mt-auto">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 py-12 flex flex-wrap gap-10 justify-between">
        <div className="max-w-[280px]">
          <Image src="/squady-logo.svg" alt="Squady" width={110} height={20} className="h-6 w-auto mb-3 [filter:brightness(0)_invert(1)]" />
          <p className="text-[13px] text-white/45 leading-relaxed">
            Live cricket auction management — bidding, presenter stage, and fairness, in one place.
          </p>
        </div>
        <div className="flex gap-14 flex-wrap">
          <div>
            <div className="text-[12px] font-bold uppercase tracking-wider text-white/45 mb-3.5">Product</div>
            <div className="flex flex-col gap-2.5">
              <Link href="/register" className="text-sm text-white/70 hover:text-white">Live Auctions</Link>
              <Link href="/fairness" className="text-sm text-white/70 hover:text-white">How Fairness Works</Link>
            </div>
          </div>
          <div>
            <div className="text-[12px] font-bold uppercase tracking-wider text-white/45 mb-3.5">Company</div>
            <div className="flex flex-col gap-2.5">
              <Link href="/contact" className="text-sm text-white/70 hover:text-white">Contact</Link>
              <a
                href="https://www.instagram.com/squady.auction/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-white/70 hover:text-white inline-flex items-center gap-1.5"
              >
                <Instagram className="h-3.5 w-3.5" /> Instagram
              </a>
            </div>
          </div>
        </div>
      </div>
      <div className="border-t border-white/[0.07]">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-5">
          <p className="text-xs text-white/40">&copy; {new Date().getFullYear()} Squady. All rights reserved.</p>
        </div>
      </div>
    </footer>
  )
}
