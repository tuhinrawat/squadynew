import { POST } from '@/app/api/analytics/[id]/predict/route'
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
      findUnique: jest.fn(),
    },
  },
}))

// Mock auth config
jest.mock('@/app/api/auth/[...nextauth]/config', () => ({
  authOptions: {},
}))

// Mock OpenAI to prevent import errors
jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [{
              message: {
                content: JSON.stringify({
                  likelyBidders: [],
                  recommendedAction: { action: 'wait', reasoning: 'Test' },
                  marketAnalysis: {}
                })
              }
            }]
          }),
        },
      },
    })),
  }
})

// Mock NextResponse properly
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

describe('API: /api/analytics/[id]/predict', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('POST /api/analytics/[id]/predict', () => {
    it('should return 400 if playerId is missing', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: 'user1', role: 'ADMIN' },
      } as any)

      const request = new Request('http://localhost:3000/api/analytics/auction1/predict', {
        method: 'POST',
        body: JSON.stringify({
          tusharBidderId: 'bidder1',
        }),
      })
      
      const response = await POST(request, { params: { id: 'auction1' } })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Missing required parameters')
    })

    it('should return 400 if tusharBidderId is missing', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: 'user1', role: 'ADMIN' },
      } as any)

      const request = new Request('http://localhost:3000/api/analytics/auction1/predict', {
        method: 'POST',
        body: JSON.stringify({
          playerId: 'player1',
        }),
      })
      
      const response = await POST(request, { params: { id: 'auction1' } })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Missing required parameters')
    })

    it('should return 404 if auction not found', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: 'user1', role: 'ADMIN' },
      } as any)

      ;(prisma.auction.findUnique as jest.Mock).mockResolvedValue(null)

      const request = new Request('http://localhost:3000/api/analytics/auction1/predict', {
        method: 'POST',
        body: JSON.stringify({
          playerId: 'player1',
          tusharBidderId: 'bidder1',
        }),
      })
      
      const response = await POST(request, { params: { id: 'auction1' } })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Auction not found')
    })

    it('should return 404 if player not found', async () => {
      const mockAuction = {
        id: 'auction1',
        players: [],
        bidders: [{ id: 'bidder1' }],
      }

      mockGetServerSession.mockResolvedValue({
        user: { id: 'user1', role: 'ADMIN' },
      } as any)

      ;(prisma.auction.findUnique as jest.Mock).mockResolvedValue(mockAuction)

      const request = new Request('http://localhost:3000/api/analytics/auction1/predict', {
        method: 'POST',
        body: JSON.stringify({
          playerId: 'player1',
          tusharBidderId: 'bidder1',
        }),
      })
      
      const response = await POST(request, { params: { id: 'auction1' } })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Player not found')
    })

    it('should return 404 if bidder not found', async () => {
      const mockAuction = {
        id: 'auction1',
        players: [{ id: 'player1', data: { Name: 'Player 1' } }],
        bidders: [],
      }

      mockGetServerSession.mockResolvedValue({
        user: { id: 'user1', role: 'ADMIN' },
      } as any)

      ;(prisma.auction.findUnique as jest.Mock).mockResolvedValue(mockAuction)

      const request = new Request('http://localhost:3000/api/analytics/auction1/predict', {
        method: 'POST',
        body: JSON.stringify({
          playerId: 'player1',
          tusharBidderId: 'bidder1',
        }),
      })
      
      const response = await POST(request, { params: { id: 'auction1' } })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Bidder not found')
    })

    it('should return predictions successfully with fallback when OpenAI is disabled', async () => {
      const mockAuction = {
        id: 'auction1',
        players: [
          {
            id: 'player1',
            data: { Name: 'Player 1', Speciality: 'Batter', 'Base Price': 10000 },
            status: 'AVAILABLE',
          },
        ],
        bidders: [
          {
            id: 'bidder1',
            teamName: 'Team 1',
            username: 'bidder1',
            remainingPurse: 50000,
            user: { id: 'user1', name: 'Bidder 1', email: 'bidder1@test.com' },
          },
        ],
        bidHistory: [],
        rules: { minBidIncrement: 1000, countdownSeconds: 30, totalPurse: 100000 },
      }

      mockGetServerSession.mockResolvedValue({
        user: { id: 'user1', role: 'ADMIN' },
      } as any)

      ;(prisma.auction.findUnique as jest.Mock).mockResolvedValue(mockAuction)

      // Disable OpenAI
      process.env.OPENAI_API_KEY = ''

      const request = new Request('http://localhost:3000/api/analytics/auction1/predict', {
        method: 'POST',
        body: JSON.stringify({
          playerId: 'player1',
          tusharBidderId: 'bidder1',
          useOpenAI: false,
        }),
      })
      
      const response = await POST(request, { params: { id: 'auction1' } })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.predictions).toBeDefined()
      expect(data.predictions.likelyBidders).toBeDefined()
      expect(data.predictions.recommendedAction).toBeDefined()
      expect(data.predictions.marketAnalysis).toBeDefined()
    })

    it('should handle invalid JSON in request body', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: 'user1', role: 'ADMIN' },
      } as any)

      const request = new Request('http://localhost:3000/api/analytics/auction1/predict', {
        method: 'POST',
        body: 'invalid json',
      })
      
      const response = await POST(request, { params: { id: 'auction1' } })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid request body')
    })

    it('should return 500 on internal server error', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: 'user1', role: 'ADMIN' },
      } as any)

      ;(prisma.auction.findUnique as jest.Mock).mockRejectedValue(new Error('Database error'))

      const request = new Request('http://localhost:3000/api/analytics/auction1/predict', {
        method: 'POST',
        body: JSON.stringify({
          playerId: 'player1',
          tusharBidderId: 'bidder1',
        }),
      })
      
      const response = await POST(request, { params: { id: 'auction1' } })
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to generate predictions')
    })
  })
})

