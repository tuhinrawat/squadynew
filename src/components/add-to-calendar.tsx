'use client'

import { useState } from 'react'
import { Calendar, ChevronDown, Download, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface AddToCalendarProps {
  auctionName: string
  auctionDescription?: string
  startDate: Date | string
  auctionUrl: string
  className?: string
  iconOnly?: boolean
}

export function AddToCalendar({
  auctionName,
  auctionDescription,
  startDate,
  auctionUrl,
  className = '',
  iconOnly = false
}: AddToCalendarProps) {
  const [isOpen, setIsOpen] = useState(false)

  const formatDateForCalendar = (date: Date | string) => {
    const d = typeof date === 'string' ? new Date(date) : date
    return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  }

  const getCalendarDates = () => {
    const start = typeof startDate === 'string' ? new Date(startDate) : startDate
    const end = new Date(start.getTime() + 3 * 60 * 60 * 1000) // 3 hours duration
    
    return {
      start: formatDateForCalendar(start),
      end: formatDateForCalendar(end),
      startDate: start
    }
  }

  const generateICS = () => {
    const { start, end } = getCalendarDates()
    const description = `${auctionDescription || 'Join the live auction!'}\n\nAuction Link: ${auctionUrl}\n\nPowered by Squady`
    
    const icsContent = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Squady//Auction Calendar//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `DTSTAMP:${formatDateForCalendar(new Date())}`,
      `UID:${Math.random().toString(36).substring(7)}@squady.auction`,
      `SUMMARY:${auctionName}`,
      `DESCRIPTION:${description.replace(/\n/g, '\\n')}`,
      `URL:${auctionUrl}`,
      'STATUS:CONFIRMED',
      'SEQUENCE:0',
      'BEGIN:VALARM',
      'TRIGGER:-PT30M',
      'ACTION:DISPLAY',
      'DESCRIPTION:Auction starts in 30 minutes!',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n')

    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${auctionName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_auction.ics`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(link.href)
  }

  const getGoogleCalendarUrl = () => {
    const { startDate } = getCalendarDates()
    const endDate = new Date(startDate.getTime() + 3 * 60 * 60 * 1000)
    
    const formatGoogleDate = (date: Date) => {
      return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
    }

    const details = `${auctionDescription || 'Join the live auction!'}\n\nAuction Link: ${auctionUrl}\n\nPowered by Squady`
    
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: auctionName,
      dates: `${formatGoogleDate(startDate)}/${formatGoogleDate(endDate)}`,
      details: details,
      location: auctionUrl,
    })

    return `https://calendar.google.com/calendar/render?${params.toString()}`
  }

  const getOutlookUrl = () => {
    const { startDate } = getCalendarDates()
    const endDate = new Date(startDate.getTime() + 3 * 60 * 60 * 1000)
    
    const params = new URLSearchParams({
      path: '/calendar/action/compose',
      rru: 'addevent',
      subject: auctionName,
      body: `${auctionDescription || 'Join the live auction!'}\n\nAuction Link: ${auctionUrl}\n\nPowered by Squady`,
      startdt: startDate.toISOString(),
      enddt: endDate.toISOString(),
      location: auctionUrl,
    })

    return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`
  }

  const getYahooUrl = () => {
    const { startDate } = getCalendarDates()
    const endDate = new Date(startDate.getTime() + 3 * 60 * 60 * 1000)
    
    const formatYahooDate = (date: Date) => {
      return date.toISOString().replace(/[-:]/g, '').split('.')[0]
    }

    const params = new URLSearchParams({
      v: '60',
      title: auctionName,
      st: formatYahooDate(startDate),
      et: formatYahooDate(endDate),
      desc: `${auctionDescription || 'Join the live auction!'}\n\nAuction Link: ${auctionUrl}`,
      in_loc: auctionUrl,
    })

    return `https://calendar.yahoo.com/?${params.toString()}`
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        {iconOnly ? (
          <Button 
            size="icon"
            className={`bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white shadow-lg hover:shadow-xl transition-all ${className}`}
            title="Add to Calendar"
          >
            <Calendar className="h-4 w-4" />
          </Button>
        ) : (
          <Button 
            className={`bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white font-semibold shadow-lg hover:shadow-xl transition-all ${className}`}
          >
            <Calendar className="h-4 w-4 mr-2" />
            Add to Calendar
            <ChevronDown className="h-4 w-4 ml-2" />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-56 bg-slate-900 border-slate-700">
        <DropdownMenuItem 
          onClick={() => {
            window.open(getGoogleCalendarUrl(), '_blank')
            setIsOpen(false)
          }}
          className="text-white hover:bg-white/10 cursor-pointer"
        >
          <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z"/>
            <path d="M7 11h5v5H7z"/>
          </svg>
          Google Calendar
        </DropdownMenuItem>
        
        <DropdownMenuItem 
          onClick={() => {
            window.open(getOutlookUrl(), '_blank')
            setIsOpen(false)
          }}
          className="text-white hover:bg-white/10 cursor-pointer"
        >
          <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24" fill="currentColor">
            <path d="M7 18h7v-1H7v1zm0-2h10v-1H7v1zm0-3h10v-1H7v1z"/>
            <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14z"/>
          </svg>
          Outlook
        </DropdownMenuItem>
        
        <DropdownMenuItem 
          onClick={() => {
            window.open(getYahooUrl(), '_blank')
            setIsOpen(false)
          }}
          className="text-white hover:bg-white/10 cursor-pointer"
        >
          <Calendar className="h-4 w-4 mr-2" />
          Yahoo Calendar
        </DropdownMenuItem>
        
        <DropdownMenuItem 
          onClick={() => {
            generateICS()
            setIsOpen(false)
          }}
          className="text-white hover:bg-white/10 cursor-pointer"
        >
          <Download className="h-4 w-4 mr-2" />
          Download ICS (Apple/Other)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

