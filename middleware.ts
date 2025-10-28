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

    // Protect /auction/[id] routes - check if user has access
    if (pathname.startsWith('/auction/')) {
      // We'll check auction access in the page component
      // since we need to query the database
    }

    return NextResponse.next()
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        // Allow access to public routes
        const publicRoutes = ['/', '/signin', '/register', '/signup']
        if (publicRoutes.includes(req.nextUrl.pathname)) {
          return true
        }

        // Require authentication for protected routes
        return !!token
      },
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

