import { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Squady - Auction Management System',
    short_name: 'Squady',
    description: 'Professional auction management system for live player auctions',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#3b82f6',
    icons: [
      {
        src: '/squady-logo.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
    ],
    categories: ['business', 'productivity', 'utilities'],
  }
}

