import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/config'
import { prisma } from '@/lib/prisma'
import * as XLSX from 'xlsx'

// Builds the canonical "auction results" spreadsheet - the one format both
// this route and the standalone Auction Control Room tool agree on, rather
// than reverse-engineering an old one-off recovery script's shape. Every
// header here matches the Control Room's column auto-detection exactly, so
// a file downloaded here imports there with zero manual remapping.

const CRICHEROES_KEYS = ['Cricheroes Profile link', ' Cricheroes Profile link', 'cricheroes profile link', 'Cricheroes Profile Link']
const NAME_KEYS = ['name', 'Name', 'player_name']

function extractField(data: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = data?.[key]
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim()
  }
  return ''
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const auction = await prisma.auction.findUnique({
      where: { id: params.id },
      select: { id: true, name: true, createdById: true }
    })
    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 })
    }

    const isAuctionAdmin =
      session.user?.role === 'SUPER_ADMIN' ||
      (session.user?.role === 'ADMIN' && auction.createdById === session.user?.id)
    if (!isAuctionAdmin) {
      return NextResponse.json({ error: 'Only this auction\'s admin can export results' }, { status: 403 })
    }

    const [players, bidders] = await Promise.all([
      prisma.player.findMany({
        where: { auctionId: params.id },
        select: { id: true, data: true, status: true, soldTo: true, soldPrice: true, isIcon: true }
      }),
      prisma.bidder.findMany({
        where: { auctionId: params.id },
        select: {
          id: true, teamName: true, username: true, purseAmount: true, remainingPurse: true,
          user: { select: { name: true } }
        }
      })
    ])

    const bidderById = new Map(bidders.map(b => [b.id, b]))

    const resultRows = players.map(p => {
      const data = (p.data as Record<string, unknown>) || {}
      const buyer = p.soldTo ? bidderById.get(p.soldTo) : undefined
      return {
        'Cricheroes Profile link': extractField(data, CRICHEROES_KEYS),
        'Player Name': extractField(data, NAME_KEYS),
        'Bidder Choice': p.isIcon ? 'Yes' : 'No',
        'Status': p.status,
        'Sold Price': p.soldPrice ?? '',
        'Sold To': buyer ? (buyer.teamName || buyer.username) : ''
      }
    })

    const bidderRows = bidders.map(b => ({
      'Team Name': b.teamName || '',
      'Username': b.username,
      'Bidder Name': b.user?.name || '',
      'Purse Amount': b.purseAmount,
      'Remaining Purse': b.remainingPurse
    }))

    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(resultRows), 'Results')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(bidderRows), 'Bidders')

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    const safeName = auction.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/(^-|-$)/g, '')

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${safeName || 'auction'}-results.xlsx"`
      }
    })
  } catch (error) {
    console.error('Error exporting auction results:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
