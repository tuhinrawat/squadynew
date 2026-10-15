'use client'

import { signIn, getSession } from 'next-auth/react'
import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function SignIn() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const searchParams = useSearchParams()
  const message = searchParams.get('message')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')

    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      })

      if (result?.error) {
        setError('Invalid email or password')
      } else if (result?.ok) {
        // Get the session to check role
        const session = await getSession()
        if (session?.user?.role === 'BIDDER') {
          router.push('/bidder/auctions')
        } else if (session?.user?.role === 'ADMIN' || session?.user?.role === 'SUPER_ADMIN') {
          router.push('/dashboard')
        } else {
          // Default to dashboard
          router.push('/dashboard')
        }
      }
    } catch {
      setError('An error occurred. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="dark min-h-screen flex items-center justify-center bg-[#05070a] text-white py-12 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
      <div className="absolute -top-28 -left-20 w-[420px] h-[420px] rounded-full bg-teal-400/10 blur-3xl" />
      <div className="absolute -bottom-32 -right-24 w-[460px] h-[460px] rounded-full bg-amber-400/10 blur-3xl" />

      <div className="relative max-w-md w-full space-y-8">
        <div className="text-center">
          <Link href="/" className="inline-flex">
            <Image src="/squady-logo.svg" alt="Squady" width={130} height={24} className="h-9 w-auto mx-auto [filter:brightness(0)_invert(1)]" />
          </Link>
          <h2 className="mt-6 text-2xl font-extrabold">
            Sign in to your account
          </h2>
          <p className="mt-2 text-sm text-white/50">
            Access your auction management dashboard
          </p>
        </div>

        <div className="rounded-2xl border border-white/[0.07] bg-[#0c1116] p-8">
          {message && (
            <div className="mb-5 text-sm text-teal-300 bg-teal-400/10 border border-teal-400/20 p-3 rounded-lg">
              {message}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="email" className="block text-sm font-semibold text-white/70 mb-2">
                Email Address
              </label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="bg-white/[0.03] border-white/15 text-white placeholder:text-white/30 h-11 focus-visible:ring-teal-400/50"
                placeholder="Enter your email"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-semibold text-white/70 mb-2">
                Password
              </label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="bg-white/[0.03] border-white/15 text-white placeholder:text-white/30 h-11 focus-visible:ring-teal-400/50"
                placeholder="Enter your password"
              />
            </div>

            {error && (
              <div className="text-sm text-red-300 bg-red-400/10 border border-red-400/20 p-3 rounded-lg">
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-11 bg-gradient-to-b from-amber-300 to-amber-400 text-amber-950 font-bold hover:brightness-105"
              disabled={isLoading}
            >
              {isLoading ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-white/50">
              Don&apos;t have an account?{' '}
              <Link href="/signup" className="font-semibold text-teal-400 hover:text-teal-300">
                Sign up
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
