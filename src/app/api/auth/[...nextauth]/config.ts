import { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { RateLimiter } from "@/lib/rate-limiter"

// Unlimited password guesses were previously possible against this endpoint -
// this doesn't stop a distributed attacker (see RateLimiter's own documented
// per-instance limitation), but it does stop the common case of a script
// hammering one known account's password.
const loginRateLimiter = new RateLimiter(5 * 60 * 1000, 5) // 5 attempts per 5 minutes per email

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        try {
          if (!credentials?.email || !credentials?.password) {
            return null
          }

          // Rejected the same way as a wrong password (rather than a
          // distinct error) so a rate-limited response doesn't itself leak
          // that this email address hit the limit.
          const rateLimitKey = credentials.email.trim().toLowerCase()
          if (!loginRateLimiter.check(rateLimitKey).allowed) {
            return null
          }

          const user = await prisma.user.findUnique({
            where: {
              email: credentials.email
            }
          })

          if (!user) {
            return null
          }

          const isPasswordValid = await bcrypt.compare(
            credentials.password,
            user.password
          )

          if (!isPasswordValid) {
            return null
          }

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
          }
        } catch (error) {
          console.error("Authentication error:", error)
          return null
        }
      }
    })
  ],
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  jwt: {
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role
      }
      return token
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.sub!
        session.user.role = token.role
      }
      return session
    },
    async redirect({ url, baseUrl }) {
      // If redirecting after signout, go to home
      if (url === baseUrl || url === `${baseUrl}/` || url.startsWith(baseUrl + '/')) {
        // Check if this is a signout (url is baseUrl)
        if (url === baseUrl || url === `${baseUrl}/`) {
          return baseUrl
        }
        // Otherwise, default signin goes to dashboard
        return baseUrl + '/dashboard'
      }
      return url
    },
  },
  pages: {
    signIn: "/signin",
  },
}
