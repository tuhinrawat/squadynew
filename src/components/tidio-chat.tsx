'use client'

import { useEffect } from 'react'

interface TidioChatProps {
  tidioId?: string // Tidio widget ID (from environment variable or prop)
}

/**
 * Tidio Chat Widget Component
 * 
 * Integrates Tidio chat widget for mobile-optimized chat experience.
 * 
 * Setup:
 * 1. Sign up at https://www.tidio.com
 * 2. Get your Tidio widget ID
 * 3. Set NEXT_PUBLIC_TIDIO_ID in .env.local
 * 
 * The widget will automatically:
 * - Be fully responsive on mobile
 * - Handle keyboard properly without zooming
 * - Provide smooth chat experience
 */
export function TidioChat({ tidioId }: TidioChatProps) {
  useEffect(() => {
    // Get Tidio ID from prop or environment variable
    // Default to the provided widget ID if not set
    const tidioWidgetId = tidioId || process.env.NEXT_PUBLIC_TIDIO_ID || 'byvbbwq5anuy2vhczx6eg2hinrlps3mn'

    // Check if Tidio script is already loaded
    if (document.getElementById('tidio-script')) {
      return
    }

    // Load Tidio script
    const script = document.createElement('script')
    script.id = 'tidio-script'
    script.src = `//code.tidio.co/${tidioWidgetId}.js`
    script.async = true
    script.charset = 'UTF-8'
    
    document.body.appendChild(script)

    // Cleanup function
    return () => {
      const existingScript = document.getElementById('tidio-script')
      if (existingScript) {
        existingScript.remove()
      }
      // Remove Tidio iframe if it exists
      const tidioIframe = document.querySelector('iframe[src*="tidio"]')
      if (tidioIframe) {
        tidioIframe.remove()
      }
    }
  }, [tidioId])

  // This component doesn't render anything - Tidio adds its own UI
  return null
}

