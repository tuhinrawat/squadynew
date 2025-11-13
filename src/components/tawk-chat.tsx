'use client'

import { useEffect } from 'react'

interface TawkChatProps {
  auctionId?: string // Optional auction ID for context
  auctionName?: string // Optional auction name for context
}

/**
 * Tawk.to Chat Widget Component
 * 
 * Integrates Tawk.to chat widget for mobile-optimized chat experience.
 * 
 * Features:
 * - Fully responsive on mobile
 * - Handles keyboard properly without zooming
 * - Smooth chat experience
 * - Per-auction context support
 * 
 * Tawk.to Property ID: 691629cc61b59b195ec6e69f
 * Tawk.to Widget ID: 1j9v96iie
 */
export function TawkChat({ auctionId, auctionName }: TawkChatProps) {
  useEffect(() => {
    // Check if Tawk.to script is already loaded
    if (window.Tawk_API || document.getElementById('tawk-script')) {
      // If already loaded, set visitor attributes if auction context provided
      if (auctionId && window.Tawk_API && window.Tawk_API.setAttributes) {
        try {
          window.Tawk_API.setAttributes({
            auctionId: auctionId,
            auctionName: auctionName || 'Unknown Auction',
            page: window.location.pathname,
          }, (error: any) => {
            if (error) {
              console.warn('Failed to set Tawk.to attributes:', error)
            }
          })
        } catch (error) {
          console.warn('Error setting Tawk.to attributes:', error)
        }
      }
      return
    }

    // Initialize Tawk.to API object
    window.Tawk_API = window.Tawk_API || {}
    window.Tawk_LoadStart = new Date()

    // Load Tawk.to script
    const script = document.createElement('script')
    script.id = 'tawk-script'
    script.async = true
    script.src = 'https://embed.tawk.to/691629cc61b59b195ec6e69f/1j9v96iie'
    script.charset = 'UTF-8'
    script.setAttribute('crossorigin', '*')
    
    // Insert script before the first script tag
    const firstScript = document.getElementsByTagName('script')[0]
    if (firstScript && firstScript.parentNode) {
      firstScript.parentNode.insertBefore(script, firstScript)
    } else {
      document.body.appendChild(script)
    }

    // Set visitor attributes after Tawk.to loads (if auction context provided)
    if (auctionId) {
      script.onload = () => {
        // Wait for Tawk_API to be fully initialized
        const checkTawk = setInterval(() => {
          if (window.Tawk_API && window.Tawk_API.setAttributes) {
            try {
              window.Tawk_API.setAttributes({
                auctionId: auctionId,
                auctionName: auctionName || 'Unknown Auction',
                page: window.location.pathname,
              }, (error: any) => {
                if (error) {
                  console.warn('Failed to set Tawk.to attributes:', error)
                } else {
                  console.log('Tawk.to attributes set for auction:', auctionId)
                }
              })
            } catch (error) {
              console.warn('Error setting Tawk.to attributes:', error)
            }
            clearInterval(checkTawk)
          }
        }, 100)

        // Timeout after 5 seconds
        setTimeout(() => clearInterval(checkTawk), 5000)
      }
    }

    // Cleanup function
    return () => {
      // Note: Tawk.to doesn't provide a cleanup method, but we can hide the widget
      if (window.Tawk_API && window.Tawk_API.hideWidget) {
        try {
          window.Tawk_API.hideWidget()
        } catch (error) {
          console.warn('Error hiding Tawk.to widget:', error)
        }
      }
    }
  }, [auctionId, auctionName])

  // This component doesn't render anything - Tawk.to adds its own UI
  return null
}

// Extend Window interface for TypeScript
declare global {
  interface Window {
    Tawk_API?: {
      setAttributes?: (attributes: Record<string, string>, callback?: (error: any) => void) => void
      hideWidget?: () => void
      showWidget?: () => void
      [key: string]: any
    }
    Tawk_LoadStart?: Date
  }
}

