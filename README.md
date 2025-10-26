# Squady - Auction Management System

A modern auction management system built with Next.js 14, TypeScript, Prisma, PostgreSQL, TailwindCSS, and NextAuth.js.

## Features

- **Multi-Tenant Admin System**: Each organization gets their own isolated admin account
- **User Management**: Admin and Bidder roles with authentication
- **Auction Management**: Create and manage live auctions
- **Player Management**: Upload and manage player data with flexible JSON storage
- **Real-time Bidding**: Live bidding system with Pusher integration
- **Responsive Design**: Modern UI with dark/light mode support

## Tech Stack

- **Frontend**: Next.js 14 with App Router, TypeScript, TailwindCSS
- **Backend**: Next.js API routes, Prisma ORM
- **Database**: PostgreSQL
- **Authentication**: NextAuth.js with JWT strategy
- **Real-time**: Pusher for live updates
- **State Management**: Zustand
- **File Processing**: XLSX for player data uploads

## Project Structure

```
/src
  /app
    /api/auth/[...nextauth]  # NextAuth.js configuration
    /(auth)                  # Authentication pages
    /dashboard               # Admin dashboard
    /auction                 # Auction management
    /bidder                  # Bidder interface
  /components               # Reusable UI components
  /lib                      # Utility functions and configurations
    - prisma.ts             # Prisma client configuration
    - pusher.ts             # Pusher server/client setup
    - auth.ts               # Password hashing utilities
  /types                    # TypeScript type definitions
/prisma
  - schema.prisma           # Database schema
```

## Database Schema

### Models

- **User**: Admin and bidder accounts with role-based access
- **Auction**: Auction events with flexible rules and status tracking
- **Player**: Player data with flexible JSON storage for any uploaded columns
- **Bidder**: Bidder profiles linked to auctions with purse management

### Key Features

- Flexible player data storage using JSON fields
- Auction rules stored as JSON for customizable bidding parameters
- Real-time bid history tracking
- Role-based access control (ADMIN/BIDDER)

## Setup Instructions

### 1. Prerequisites

- Node.js 18+ 
- PostgreSQL database
- Pusher account (for real-time features)

### 2. Installation

```bash
# Clone the repository
git clone <repository-url>
cd squady

# Install dependencies
npm install
```

### 3. Environment Configuration

Create a `.env.local` file with the following variables:

```env
# Database
DATABASE_URL="postgresql://username:password@localhost:5432/squady?schema=public"

# NextAuth.js
NEXTAUTH_SECRET="your-secret-key-here"
NEXTAUTH_URL="http://localhost:3000"

# Pusher (Server-side)
PUSHER_APP_ID="your-pusher-app-id"
PUSHER_KEY="your-pusher-key"
PUSHER_SECRET="your-pusher-secret"
PUSHER_CLUSTER="your-pusher-cluster"

# Pusher (Client-side - public variables)
NEXT_PUBLIC_PUSHER_KEY="your-pusher-key"
NEXT_PUBLIC_PUSHER_CLUSTER="your-pusher-cluster"
```

### 4. Pusher Setup

1. Sign up for a free account at [pusher.com](https://pusher.com)
2. Create a new app in your Pusher dashboard
3. Copy the App ID, Key, Secret, and Cluster from your app settings
4. Add these values to your `.env.local` file
5. The same Key and Cluster are used for both server and client configuration

### 5. Database Setup

```bash
# Generate Prisma client
npx prisma generate

# Push schema to database
npx prisma db push

# (Optional) Seed the database
npx prisma db seed
```

### 6. Development

```bash
# Start the development server
npm run dev
```

Visit `http://localhost:3000` to access the application.

## Getting Started

### For New Admins (Organizations)

1. **Sign Up**: Visit the landing page and click "Get Started Free" or "Sign Up"
2. **Create Account**: Enter your name, email, and password
3. **You're an Admin!**: You now have access to your own isolated admin dashboard
4. **Create Auctions**: Start creating and managing your auctions
5. **Invite Bidders**: Add bidders to your auctions
6. **Run Live Auctions**: Start and manage real-time bidding

### How It Works

- **Each admin account is completely isolated** - You only see your own auctions, players, and bidders
- **Bidders are per-auction** - When you create an auction, you add bidders specifically for that auction
- **No cross-contamination** - Multiple organizations can use the same instance without seeing each other's data

## Real-time Features

The application includes real-time functionality powered by Pusher:

### Event Types

- **new-bid**: When a bidder places a new bid
- **bid-undo**: When a bid is undone
- **player-sold**: When a player is sold to a bidder
- **sale-undo**: When a player sale is undone
- **new-player**: When a new player is added to the auction
- **timer-update**: Real-time countdown timer updates
- **auction-paused**: When the auction is paused
- **auction-resumed**: When the auction is resumed
- **auction-ended**: When the auction ends

### Usage

```typescript
import { usePusher } from '@/lib/pusher-client'
import { useAuctionStore } from '@/lib/store/auction-store'

function AuctionComponent({ auctionId }: { auctionId: string }) {
  const { updateBid, addToBidHistory } = useAuctionStore()
  
  usePusher(auctionId, {
    onNewBid: (data) => {
      updateBid({
        bidderId: data.bidderId,
        amount: data.amount,
        bidderName: data.bidderName,
        teamName: data.teamName
      })
    },
    onTimerUpdate: (data) => {
      // Handle timer updates
    }
  })
}
```

## Design System

The application uses a custom design system defined in `globals.css`:

### Colors
- Primary: Teal (#14b8a6)
- Background: White/Dark slate
- Surface: Light gray/Dark slate
- Text: Dark slate/Light gray

### Typography
- Font family: System fonts
- Base font size: 14px
- Font weight medium: 500

### Spacing
- 4px, 8px, 16px, 24px increments

### Border Radius
- Small: 6px
- Base: 8px
- Large: 12px

### Shadows
- Small and medium shadow variants

## Authentication

The application uses NextAuth.js with:
- Credentials provider (email/password)
- JWT session strategy
- Role-based access control
- Password hashing with bcryptjs

## Real-time Features

Pusher integration provides:
- Live auction updates
- Real-time bidding
- Player status changes
- Bid notifications

## API Routes

- `/api/auth/[...nextauth]` - NextAuth.js authentication
- Additional API routes will be added for auction management, bidding, etc.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is licensed under the MIT License.