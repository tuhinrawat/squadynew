/**
 * Format a number as Indian Rupee currency
 * @param amount - The amount to format
 * @param options - Optional formatting options
 * @returns Formatted string with ₹ symbol
 */
export function formatCurrency(
  amount: number,
  options?: {
    minimumFractionDigits?: number
    maximumFractionDigits?: number
    showDecimals?: boolean
  }
): string {
  const { 
    minimumFractionDigits = 0, 
    maximumFractionDigits = 0,
    showDecimals = false 
  } = options || {}

  const formatted = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: showDecimals ? Math.max(0, Math.min(20, minimumFractionDigits)) : 0,
    maximumFractionDigits: showDecimals ? Math.max(0, Math.min(20, maximumFractionDigits || 2)) : 0,
  }).format(amount)

  return formatted
}

/**
 * Parse a currency string back to a number
 * Removes currency symbols and formatting
 */
export function parseCurrency(value: string): number {
  return parseFloat(value.replace(/[₹,\s]/g, ''))
}

/**
 * Format a large number with abbreviation (e.g., 1.5L for 1,50,000)
 */
export function formatCompactCurrency(amount: number): string {
  if (amount >= 10000000) {
    return `₹${(amount / 10000000).toFixed(2)}Cr`
  }
  if (amount >= 100000) {
    return `₹${(amount / 100000).toFixed(2)}L`
  }
  if (amount >= 1000) {
    return `₹${(amount / 1000).toFixed(2)}K`
  }
  return `₹${amount}`
}
