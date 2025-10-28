'use client'

import { useEffect } from 'react'

export function JsonLd() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'Squady',
    description: 'Professional auction management system for live player auctions',
    url: 'https://squady.auction',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Any',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    featureList: [
      'Live Bidding',
      'Real-time Updates',
      'Automated Timers',
      'Team Management',
      'Player Management',
      'Bid History Tracking',
    ],
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  )
}

