import { GET, POST } from '@/app/api/auctions/route'
import { getServerSession } from 'next-auth'

// Mock next-auth before anything else to avoid ES module issues
jest.mock('next-auth', () => ({
  getServerSession: jest.fn(),
  default: jest.fn(),
}))

// Mock Prisma
jest.mock('@/lib/prisma', () => ({
  prisma: {
    auction: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  },
}))

// Mock auth config
jest.mock('@/app/api/auth/[...nextauth]/config', () => ({
  authOptions: {},
}))

// Mock NextResponse properly - must be a function that returns a response-like object
jest.mock('next/server', () => {
  return {
    NextRequest: class NextRequest extends Request {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        super(input, init)
      }
    },
    NextResponse: {
      json: jest.fn((data: any, init?: { status?: number; statusText?: string; headers?: any }) => {
        const headers = new Map()
        const mockHeaders = {
          get: jest.fn((name: string) => headers.get(name)),
          set: jest.fn((name: string, value: string) => headers.set(name, value)),
          has: jest.fn((name: string) => headers.has(name)),
        }
        
        return {
          json: jest.fn(async () => data),
          text: jest.fn(async () => JSON.stringify(data)),
          status: init?.status || 200,
          statusText: init?.statusText || 'OK',
          headers: mockHeaders,
          ok: (init?.status || 200) >= 200 && (init?.status || 200) < 300,
        }
      }),
    },
  }
})

import { prisma } from '@/lib/prisma'

const mockGetServerSession = getServerSession as jest.MockedFunction<typeof getServerSession>

describe('API: /api/auctions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('GET /api/auctions', () => {
    it('should return 401 if user is not authenticated', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const request = new Request('http://localhost:3000/api/auctions')
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return 401 if user is not admin', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: 'user1', role: 'BIDDER' },
      } as any)

      const request = new Request('http://localhost:3000/api/auctions')
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return auctions for authenticated admin', async () => {
      const mockAuctions = [
        { id: 'auction1', name: 'Auction 1', _count: { players: 10, bidders: 5 } },
        { id: 'auction2', name: 'Auction 2', _count: { players: 20, bidders: 8 } },
      ]

      mockGetServerSession.mockResolvedValue({
        user: { id: 'admin1', role: 'ADMIN' },
      } as any)

      ;(prisma.auction.findMany as jest.Mock).mockResolvedValue(mockAuctions)

      const request = new Request('http://localhost:3000/api/auctions')
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.auctions).toEqual(mockAuctions)
      expect(prisma.auction.findMany).toHaveBeenCalledWith({
        where: { createdById: 'admin1' },
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: {
              players: true,
              bidders: true,
            },
          },
        },
      })
      expect(response.headers.get('Cache-Control')).toBe('private, max-age=60, stale-while-revalidate=120')
    })

    it('should return 500 on database error', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: 'admin1', role: 'ADMIN' },
      } as any)

      ;(prisma.auction.findMany as jest.Mock).mockRejectedValue(new Error('Database error'))

      const request = new Request('http://localhost:3000/api/auctions')
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Internal server error')
    })
  })

  describe('POST /api/auctions', () => {
    it('should return 401 if user is not authenticated', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const request = new Request('http://localhost:3000/api/auctions', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Test Auction',
          rules: { minBidIncrement: 1000, countdownSeconds: 30 },
        }),
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return 400 if name is missing', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: 'admin1', role: 'ADMIN' },
      } as any)

      const request = new Request('http://localhost:3000/api/auctions', {
        method: 'POST',
        body: JSON.stringify({
          rules: { minBidIncrement: 1000, countdownSeconds: 30 },
        }),
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Name and rules are required')
    })

    it('should return 400 if rules are missing', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: 'admin1', role: 'ADMIN' },
      } as any)

      const request = new Request('http://localhost:3000/api/auctions', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Test Auction',
        }),
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Name and rules are required')
    })

    it('should return 400 if minBidIncrement is missing', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: 'admin1', role: 'ADMIN' },
      } as any)

      const request = new Request('http://localhost:3000/api/auctions', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Test Auction',
          rules: { countdownSeconds: 30 },
        }),
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('minBidIncrement and countdownSeconds are required')
    })

    it('should create auction successfully', async () => {
      const mockAuction = {
        id: 'auction1',
        name: 'Test Auction',
        description: 'Test Description',
        rules: { minBidIncrement: 1000, countdownSeconds: 30 },
        isPublished: false,
        registrationOpen: true,
        status: 'DRAFT',
        createdById: 'admin1',
        _count: { players: 0, bidders: 0 },
      }

      mockGetServerSession.mockResolvedValue({
        user: { id: 'admin1', role: 'ADMIN' },
      } as any)

      ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'admin1' })
      ;(prisma.auction.create as jest.Mock).mockResolvedValue(mockAuction)

      const request = new Request('http://localhost:3000/api/auctions', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Test Auction',
          description: 'Test Description',
          rules: { minBidIncrement: 1000, countdownSeconds: 30 },
          isPublished: false,
          registrationOpen: true,
        }),
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.message).toBe('Auction created successfully')
      expect(data.auction).toEqual(mockAuction)
      expect(prisma.auction.create).toHaveBeenCalledWith({
        data: {
          name: 'Test Auction',
          description: 'Test Description',
          rules: { minBidIncrement: 1000, countdownSeconds: 30 },
          isPublished: false,
          registrationOpen: true,
          createdById: 'admin1',
          status: 'DRAFT',
        },
        include: {
          _count: {
            select: {
              players: true,
              bidders: true,
            },
          },
        },
      })
    })

    it('should return 404 if user not found', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: 'admin1', role: 'ADMIN' },
      } as any)

      ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(null)

      const request = new Request('http://localhost:3000/api/auctions', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Test Auction',
          rules: { minBidIncrement: 1000, countdownSeconds: 30 },
        }),
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('User not found. Please sign in again.')
    })

    it('should return 500 on database error', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: 'admin1', role: 'ADMIN' },
      } as any)

      ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'admin1' })
      ;(prisma.auction.create as jest.Mock).mockRejectedValue(new Error('Database error'))

      const request = new Request('http://localhost:3000/api/auctions', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Test Auction',
          rules: { minBidIncrement: 1000, countdownSeconds: 30 },
        }),
      })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Internal server error')
    })
  })
})

