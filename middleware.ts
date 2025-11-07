import { withAuth } from "next-auth/middleware"
import { NextResponse } from "next/server"

export default withAuth(
  function middleware(req) {
    const pathname = req.nextUrl.pathname
    const token = req.nextauth.token

    // Redirect authenticated users from home page to their dashboard
    if (pathname === '/' && token) {
      if (token.role === 'BIDDER') {
        return NextResponse.redirect(new URL('/bidder/auctions', req.url))
      } else if (token.role === 'ADMIN' || token.role === 'SUPER_ADMIN') {
        return NextResponse.redirect(new URL('/dashboard', req.url))
      }
    }

    // Protect /dashboard routes - only ADMIN and SUPER_ADMIN
    if (pathname.startsWith('/dashboard')) {
      if (token?.role !== 'ADMIN' && token?.role !== 'SUPER_ADMIN') {
        return NextResponse.rewrite(new URL('/403', req.url))
      }
    }

    // Protect /bidder routes - only BIDDER or SUPER_ADMIN (for management)
    if (pathname.startsWith('/bidder')) {
      if (token?.role !== 'BIDDER' && token?.role !== 'SUPER_ADMIN') {
        return NextResponse.rewrite(new URL('/403', req.url))
      }
    }

    // /auction/[id] routes are handled by page component - allow through
    return NextResponse.next()
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        const pathname = req.nextUrl.pathname
        
        // Allow access to public routes (no auth required)
        const publicRoutes = ['/', '/signin', '/register', '/signup']
        if (publicRoutes.includes(pathname)) {
          return true
        }

        // Allow access to auction routes without auth - page component will check if published
        // This must return true to prevent withAuth from redirecting to signin
        if (pathname.startsWith('/auction/')) {
          return true
        }

        // For all other routes, require authentication
        return !!token
      },
    },
    pages: {
      signIn: '/signin',
    },
  }
)

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
}

