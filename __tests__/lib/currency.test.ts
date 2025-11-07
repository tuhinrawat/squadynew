import { formatCurrency, parseCurrency, formatCompactCurrency } from '@/lib/currency'

describe('Currency Utilities', () => {
  describe('formatCurrency', () => {
    it('should format currency in Indian Rupee format', () => {
      expect(formatCurrency(1000)).toBe('₹1,000')
      expect(formatCurrency(100000)).toBe('₹1,00,000')
      expect(formatCurrency(10000000)).toBe('₹1,00,00,000')
    })

    it('should handle zero and negative values', () => {
      expect(formatCurrency(0)).toBe('₹0')
      // Note: Intl.NumberFormat formats negative as "-₹1,000" not "₹-1,000"
      expect(formatCurrency(-1000)).toBe('-₹1,000')
    })

    it('should format with decimals when showDecimals is true', () => {
      expect(formatCurrency(1000.50, { showDecimals: true, minimumFractionDigits: 2 })).toContain('1,000.50')
      // Note: maximumFractionDigits will default to 2 if showDecimals is true and not provided
      expect(formatCurrency(1000.123, { showDecimals: true, maximumFractionDigits: 2 })).toContain('1,000.12')
    })

    it('should format without decimals by default', () => {
      expect(formatCurrency(1000.50)).not.toContain('.')
    })

    it('should handle large numbers correctly', () => {
      expect(formatCurrency(999999999)).toBe('₹99,99,99,999')
    })
  })

  describe('parseCurrency', () => {
    it('should parse currency string to number', () => {
      expect(parseCurrency('₹1,000')).toBe(1000)
      expect(parseCurrency('₹1,00,000')).toBe(100000)
      expect(parseCurrency('₹1,00,00,000')).toBe(10000000)
    })

    it('should handle strings with spaces', () => {
      expect(parseCurrency('₹ 1,000')).toBe(1000)
      expect(parseCurrency('₹ 1, 00, 000')).toBe(100000)
    })

    it('should handle decimal values', () => {
      expect(parseCurrency('₹1,000.50')).toBe(1000.50)
      expect(parseCurrency('₹1,00,000.99')).toBe(100000.99)
    })

    it('should handle empty or invalid strings', () => {
      expect(parseCurrency('')).toBeNaN()
      expect(parseCurrency('invalid')).toBeNaN()
    })
  })

  describe('formatCompactCurrency', () => {
    it('should format amounts in Crores (Cr)', () => {
      expect(formatCompactCurrency(10000000)).toBe('₹1.00Cr')
      expect(formatCompactCurrency(25000000)).toBe('₹2.50Cr')
      expect(formatCompactCurrency(99999999)).toBe('₹10.00Cr')
    })

    it('should format amounts in Lakhs (L)', () => {
      expect(formatCompactCurrency(100000)).toBe('₹1.00L')
      expect(formatCompactCurrency(500000)).toBe('₹5.00L')
      expect(formatCompactCurrency(9999999)).toBe('₹100.00L')
    })

    it('should format amounts in Thousands (K)', () => {
      expect(formatCompactCurrency(1000)).toBe('₹1.00K')
      expect(formatCompactCurrency(5000)).toBe('₹5.00K')
      expect(formatCompactCurrency(99999)).toBe('₹100.00K')
    })

    it('should format small amounts without abbreviation', () => {
      expect(formatCompactCurrency(999)).toBe('₹999')
      expect(formatCompactCurrency(500)).toBe('₹500')
      expect(formatCompactCurrency(0)).toBe('₹0')
    })

    it('should handle edge cases', () => {
      expect(formatCompactCurrency(10000000 - 1)).toBe('₹100.00L') // Just below 1Cr (9999999 / 100000 = 99.999, but rounds to 100.00L)
      // 99999 / 1000 = 99.999, which rounds to 100.00 when using toFixed(2)
      expect(formatCompactCurrency(100000 - 1)).toBe('₹100.00K') // Just below 1L (99999 / 1000 = 99.999 → 100.00K)
      expect(formatCompactCurrency(1000 - 1)).toBe('₹999') // Just below 1K (999 < 1000, so no abbreviation)
    })
  })
})

