// Learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom'

// Mock environment variables
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test'
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-key'
process.env.NEXTAUTH_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000'

// Mock Next.js Request and Response
if (typeof global.Request === 'undefined') {
  global.Request = class Request {
    constructor(input, init = {}) {
      this.url = typeof input === 'string' ? input : input.url
      this.method = init.method || 'GET'
      this.headers = new Map(Object.entries(init.headers || {}))
      this._body = init.body
      this._json = null
    }
    
    async json() {
      if (this._json) return this._json
      if (typeof this._body === 'string') {
        this._json = JSON.parse(this._body)
        return this._json
      }
      this._json = this._body || {}
      return this._json
    }
    
    async text() {
      return typeof this._body === 'string' ? this._body : JSON.stringify(this._body || {})
    }
  }
}

if (typeof global.Response === 'undefined') {
  global.Response = class Response {
    constructor(body, init = {}) {
      this.body = body
      this.status = init.status || 200
      this.statusText = init.statusText || 'OK'
      this.headers = new Map(Object.entries(init.headers || {}))
    }
    
    async json() {
      return typeof this.body === 'string' ? JSON.parse(this.body) : this.body
    }
    
    async text() {
      return typeof this.body === 'string' ? this.body : JSON.stringify(this.body)
    }
  }
}

if (typeof global.Headers === 'undefined') {
  global.Headers = class Headers extends Map {
    constructor(init) {
      super()
      if (init) {
        Object.entries(init).forEach(([key, value]) => {
          this.set(key, value)
        })
      }
    }
    
    set(name, value) {
      super.set(name.toLowerCase(), value)
    }
    
    get(name) {
      return super.get(name.toLowerCase())
    }
  }
}

// Mock Next.js router
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
    back: jest.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}))

// Mock Pusher
jest.mock('pusher-js', () => {
  return jest.fn().mockImplementation(() => ({
    subscribe: jest.fn(() => ({
      bind: jest.fn(),
      unbind: jest.fn(),
    })),
    unsubscribe: jest.fn(),
    disconnect: jest.fn(),
  }))
})

// Global test utilities
global.console = {
  ...console,
  // Uncomment to silence specific console methods during tests
  // log: jest.fn(),
  // debug: jest.fn(),
  // info: jest.fn(),
  // warn: jest.fn(),
  error: jest.fn(),
}

