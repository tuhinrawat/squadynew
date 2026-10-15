import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { SiteNav } from '@/components/site-nav'
import { SiteFooter } from '@/components/site-footer'

// Four features grounded in what this app actually does, not generic SaaS
// copy - each one maps to a real, shipped mechanic (see the components/
// routes named below), not an aspirational claim.
const FEATURES = [
  {
    title: 'Projector-ready stage',
    description: "A dedicated full-screen presenter view for the room to watch — separate from the admin screen, which bidders never see.",
    accent: 'teal' as const,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
  },
  {
    title: 'Fairness, built into the rules',
    description: 'Icon players go first, every time. A player who goes unsold automatically re-enters the pool for another round instead of vanishing from the auction.',
    accent: 'amber' as const,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 014-4h14" /><path d="M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 01-4 4H3" />
      </svg>
    ),
  },
  {
    title: 'Real stats, not just names',
    description: "Batting and bowling numbers pulled from each player's Cricheroes profile, shown live on stage while bidding is open.",
    accent: 'teal' as const,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
  },
  {
    title: 'Nothing is locked in by accident',
    description: 'Undo a bid, reverse a sale, or mark a player unsold mid-auction. The admin stays in control, start to finish.',
    accent: 'amber' as const,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
      </svg>
    ),
  },
]

export default function Home() {
  return (
    <div className="dark min-h-screen overflow-x-hidden bg-[#05070a] text-white flex flex-col">
      <SiteNav />

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-5 sm:px-8 py-16 sm:py-20 flex flex-wrap items-center gap-12 lg:gap-16">
        <div className="flex-1 min-w-[320px]">
          <div className="text-xs font-bold uppercase tracking-[0.14em] text-teal-400 mb-4">Live cricket auctions</div>
          <h1 className="text-4xl sm:text-5xl lg:text-[52px] font-black uppercase leading-[1.03] mb-6">
            Auctions that feel like<br />
            <span className="text-amber-400">match day.</span>
          </h1>
          <p className="text-base sm:text-lg text-white/65 max-w-[480px] mb-8 leading-relaxed">
            Squady runs the bidding, the projector stage, and the fairness rules — so your players get the auction day they&apos;ve been waiting for, not a spreadsheet with extra steps.
          </p>
          <div className="flex flex-wrap gap-3.5">
            <Link href="/signup">
              <Button size="lg" className="h-12 px-7 bg-gradient-to-b from-amber-300 to-amber-400 text-amber-950 font-bold hover:brightness-105">
                Start Free
              </Button>
            </Link>
            <Link href="/register">
              <Button size="lg" variant="ghost" className="h-12 px-7 border border-white/15 text-white hover:bg-white/10 hover:text-white">
                See Live Auctions
              </Button>
            </Link>
          </div>
        </div>

        {/* Hero visual - an honest, miniature replica of the real presenter
            stage card (public-auction-view.tsx's isPresenter branch), not a
            stock illustration, so the homepage shows the actual product. */}
        <div className="flex-1 min-w-[320px] max-w-[460px]">
          <div className="rounded-2xl border border-white/10 bg-[#0c1116] p-5 shadow-[0_30px_60px_-20px_rgba(0,0,0,0.6)]">
            <div className="flex items-start justify-between mb-4">
              <div className="w-[52px] h-[52px] rounded-2xl bg-gradient-to-br from-amber-300 to-amber-500 flex items-center justify-center font-black text-amber-950 text-xl">24</div>
              <div className="text-right">
                <div className="text-[11px] font-bold uppercase tracking-wider text-white/40">Current Bid</div>
                <div className="font-black text-2xl text-teal-400">₹85,000</div>
              </div>
            </div>
            <div className="h-[170px] rounded-xl bg-gradient-to-br from-[#1c2b2a] to-[#10181b] flex items-center justify-center mb-4">
              {/* A batsman mid cover-drive, not a generic bust-and-shoulders
                  silhouette - a bold athletic pictogram (thick rounded limb
                  strokes, the way Olympic sport icons are built) rather than
                  fine line art, which held up badly at this card's size -
                  thin strokes read as a stick-figure sketch, not a crafted
                  illustration. Verified by screenshotting the actual hero
                  card before and after this rebuild. */}
              <svg width="104" height="156" viewBox="0 0 200 300" fill="none" strokeLinecap="round">
                {/* Back leg, trailing */}
                <line x1="94" y1="126" x2="64" y2="215" stroke="#5eead4" strokeWidth={15} />
                {/* Front leg, stepped into the drive */}
                <line x1="94" y1="126" x2="122" y2="158" stroke="#5eead4" strokeWidth={15} />
                <line x1="122" y1="158" x2="112" y2="220" stroke="#5eead4" strokeWidth={15} />
                {/* Torso, leaning into the shot */}
                <line x1="100" y1="56" x2="94" y2="126" stroke="#5eead4" strokeWidth={17} />
                {/* Arms, both converging on the grip */}
                <line x1="90" y1="75" x2="145" y2="90" stroke="#5eead4" strokeWidth={11} />
                <line x1="100" y1="62" x2="145" y2="90" stroke="#5eead4" strokeWidth={11} />
                {/* Bat: handle from the grip, blade continuing the same line */}
                <line x1="145" y1="90" x2="164" y2="34" stroke="#5eead4" strokeWidth={9} />
                <line x1="164" y1="34" x2="174" y2="6" stroke="#5eead4" strokeWidth={17} />
                {/* Helmet */}
                <circle cx="100" cy="40" r="20" fill="#5eead4" />
                <path d="M83 31 Q100 18 117 29" stroke="#05070a" strokeWidth={4} fill="none" />
              </svg>
            </div>
            <div className="font-black text-xl uppercase mb-1">Rahul Deshmukh</div>
            <div className="text-[13px] text-white/40 mb-4">All-Rounder · Right-Hand Bat</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-white/[0.04] border border-white/10 rounded-lg p-2.5 text-center">
                <div className="font-black text-lg">342</div>
                <div className="text-[10px] text-white/40 uppercase">Runs</div>
              </div>
              <div className="bg-white/[0.04] border border-white/10 rounded-lg p-2.5 text-center">
                <div className="font-black text-lg">17</div>
                <div className="text-[10px] text-white/40 uppercase">Wickets</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="fairness-preview" className="max-w-6xl mx-auto px-5 sm:px-8 py-16">
        <div className="max-w-[640px] mx-auto text-center mb-12">
          <div className="text-xs font-bold uppercase tracking-[0.14em] text-teal-400 mb-3">What Squady actually does</div>
          <h2 className="text-2xl sm:text-3xl font-extrabold uppercase">Built from running real auctions</h2>
        </div>
        <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {FEATURES.map((feature) => (
            <div key={feature.title} className="rounded-2xl border border-white/[0.07] bg-[#0c1116] p-7">
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center mb-4 ${feature.accent === 'teal' ? 'bg-teal-400/10 text-teal-400' : 'bg-amber-400/10 text-amber-400'}`}>
                {feature.icon}
              </div>
              <h3 className="text-[17px] font-extrabold uppercase mb-2.5">{feature.title}</h3>
              <p className="text-sm text-white/60 leading-relaxed">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Showcase videos */}
      <section className="max-w-6xl mx-auto px-5 sm:px-8 py-16">
        <div className="max-w-[640px] mx-auto text-center mb-10">
          <div className="text-xs font-bold uppercase tracking-[0.14em] text-teal-400 mb-3">See it in the room</div>
          <h2 className="text-2xl sm:text-3xl font-extrabold uppercase">Auction night, as it happens</h2>
        </div>
        <div className="grid gap-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
          <div className="rounded-2xl overflow-hidden border border-white/10 bg-[#0c1116]">
            <video className="w-full h-auto block" controls playsInline preload="metadata">
              <source src="/poster1.mp4" type="video/mp4" />
              Your browser does not support the video tag.
            </video>
          </div>
          <div className="rounded-2xl overflow-hidden border border-white/10 bg-[#0c1116]">
            <video className="w-full h-auto block" controls playsInline preload="metadata">
              <source src="/poster2.mp4" type="video/mp4" />
              Your browser does not support the video tag.
            </video>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="max-w-6xl mx-auto px-5 sm:px-8 py-16">
        <div className="max-w-[460px] mx-auto rounded-2xl border border-white/[0.07] bg-[#0c1116] p-9 text-center">
          <div className="text-xs font-bold uppercase tracking-[0.14em] text-teal-400 mb-3">Pricing</div>
          <h2 className="text-2xl font-extrabold mb-2.5">Simple, transparent pricing</h2>
          <p className="text-sm text-white/60 mb-6">Contact us for custom pricing based on your auction volume and requirements.</p>
          <Link href="/contact" className="block">
            <Button className="w-full h-12 bg-gradient-to-b from-amber-300 to-amber-400 text-amber-950 font-bold hover:brightness-105">
              Contact Sales
            </Button>
          </Link>
        </div>
      </section>

      <SiteFooter />
    </div>
  )
}
