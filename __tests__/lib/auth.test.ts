import { hashPassword, verifyPassword } from '@/lib/auth'

describe('Auth Utilities', () => {
  describe('hashPassword', () => {
    it('should hash a password', async () => {
      const password = 'testPassword123'
      const hashed = await hashPassword(password)
      
      expect(hashed).toBeDefined()
      expect(hashed).not.toBe(password)
      expect(hashed.length).toBeGreaterThan(0)
      expect(hashed.startsWith('$2')).toBe(true) // bcrypt hash starts with $2
    })

    it('should produce different hashes for the same password', async () => {
      const password = 'testPassword123'
      const hash1 = await hashPassword(password)
      const hash2 = await hashPassword(password)
      
      // Bcrypt uses salt, so same password should produce different hashes
      expect(hash1).not.toBe(hash2)
    })

    it('should handle empty string', async () => {
      const hashed = await hashPassword('')
      expect(hashed).toBeDefined()
      expect(hashed.length).toBeGreaterThan(0)
    })

    it('should handle special characters', async () => {
      const password = '!@#$%^&*()_+-=[]{}|;:,.<>?'
      const hashed = await hashPassword(password)
      expect(hashed).toBeDefined()
      
      const isValid = await verifyPassword(password, hashed)
      expect(isValid).toBe(true)
    })
  })

  describe('verifyPassword', () => {
    it('should verify correct password', async () => {
      const password = 'testPassword123'
      const hashed = await hashPassword(password)
      
      const isValid = await verifyPassword(password, hashed)
      expect(isValid).toBe(true)
    })

    it('should reject incorrect password', async () => {
      const password = 'testPassword123'
      const wrongPassword = 'wrongPassword'
      const hashed = await hashPassword(password)
      
      const isValid = await verifyPassword(wrongPassword, hashed)
      expect(isValid).toBe(false)
    })

    it('should handle empty password', async () => {
      const password = 'testPassword123'
      const hashed = await hashPassword(password)
      
      const isValid = await verifyPassword('', hashed)
      expect(isValid).toBe(false)
    })

    it('should handle case-sensitive passwords', async () => {
      const password = 'TestPassword123'
      const hashed = await hashPassword(password)
      
      const isValidLower = await verifyPassword('testpassword123', hashed)
      expect(isValidLower).toBe(false)
      
      const isValidCorrect = await verifyPassword('TestPassword123', hashed)
      expect(isValidCorrect).toBe(true)
    })
  })

  describe('hashPassword and verifyPassword integration', () => {
    it('should work together correctly', async () => {
      const passwords = [
        'simple',
        'complexPassword123!@#',
        'verylongpasswordthatexceedsnormallengthrequirements',
        '1234567890',
        'Password With Spaces',
      ]

      for (const password of passwords) {
        const hashed = await hashPassword(password)
        const isValid = await verifyPassword(password, hashed)
        expect(isValid).toBe(true)
      }
    })
  })
})


