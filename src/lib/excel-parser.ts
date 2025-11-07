import * as XLSX from 'xlsx'

export interface ParsedPlayerData {
  [key: string]: any
}

export interface ParseResult {
  success: boolean
  data?: ParsedPlayerData[]
  columns?: string[]
  error?: string
  preview?: ParsedPlayerData[]
}

export function parseExcelFile(file: File): Promise<ParseResult> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    
    reader.onload = (e) => {
      try {
        const data = e.target?.result
        if (!data) {
          resolve({
            success: false,
            error: 'Failed to read file'
          })
          return
        }

        // Parse the workbook
        const workbook = XLSX.read(data, { type: 'binary' })
        
        // Get the first sheet
        const firstSheetName = workbook.SheetNames[0]
        if (!firstSheetName) {
          resolve({
            success: false,
            error: 'No sheets found in the file'
          })
          return
        }

        const worksheet = workbook.Sheets[firstSheetName]
        
        // Convert to JSON array
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { 
          header: 1,
          defval: '' // Default value for empty cells
        }) as any[][]

        if (jsonData.length === 0) {
          resolve({
            success: false,
            error: 'No data found in the file'
          })
          return
        }

        // First row contains headers
        const headers = jsonData[0] as string[]
        const rows = jsonData.slice(1)

        // Clean headers and preserve order
        const cleanHeaders = headers.map(header => header ? header.trim() : '').filter(header => header)
        
        // Convert to array of objects while preserving column order
        const players: ParsedPlayerData[] = rows.map((row, index) => {
          const player: ParsedPlayerData = {}
          cleanHeaders.forEach((header, colIndex) => {
            player[header] = row[colIndex] || ''
          })
          return player
        }).filter(player => {
          // Filter out completely empty rows
          return Object.values(player).some(value => value !== '')
        })

        if (players.length === 0) {
          resolve({
            success: false,
            error: 'No valid player data found'
          })
          return
        }

        // Get unique column names
        // Create preview (first 5 rows)
        const preview = players.slice(0, 5)

        resolve({
          success: true,
          data: players,
          columns: cleanHeaders,
          preview
        })

      } catch (error) {
        console.error('Error parsing Excel file:', error)
        resolve({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error occurred'
        })
      }
    }

    reader.onerror = () => {
      resolve({
        success: false,
        error: 'Failed to read file'
      })
    }

    // Read as binary string for XLSX
    reader.readAsBinaryString(file)
  })
}

export function validatePlayerData(data: ParsedPlayerData[]): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  
  if (!data || !Array.isArray(data) || data.length === 0) {
    errors.push('No player data provided')
    return { valid: false, errors }
  }
  
  console.log('Validating player data:', { count: data.length, sample: data[0] })

  // Check for required fields (at minimum, we need some identifying field)
  const hasRequiredFields = data.every(player => {
    const values = Object.values(player)
    return values.some(value => value && value.toString().trim() !== '')
  })

  if (!hasRequiredFields) {
    errors.push('All players must have at least one non-empty field')
  }

  // Check for duplicate entries (based on Name field if available, otherwise first field)
  // Only warn about duplicates, don't fail validation
  const nameField = Object.keys(data[0] || {}).find(key => 
    key.toLowerCase().includes('name') || key.toLowerCase().includes('player')
  ) || Object.keys(data[0] || {})[0]
  
  console.log('Checking for duplicates using field:', nameField)
  
  if (nameField) {
    const values = data.map(player => player[nameField]?.toString().trim()).filter(Boolean)
    const uniqueValues = new Set(values)
    console.log('Duplicate check:', { totalValues: values.length, uniqueValues: uniqueValues.size, values: values.slice(0, 5) })
    
    if (values.length !== uniqueValues.size) {
      console.warn(`Warning: Duplicate entries found in the ${nameField} field. This won't prevent upload.`)
      // Don't add to errors array - just log a warning
    }
  }

  return {
    valid: errors.length === 0,
    errors
  }
}

export function cleanPlayerData(data: ParsedPlayerData): ParsedPlayerData {
  const cleaned: ParsedPlayerData = {}
  
  Object.entries(data).forEach(([key, value]) => {
    if (key && key.trim()) {
      const cleanKey = key.trim()
      let cleanValue = value
      
      // Convert numbers if they look like numbers
      if (typeof value === 'string' && !isNaN(Number(value)) && value.trim() !== '') {
        cleanValue = Number(value)
      }
      
      // Convert empty strings to null
      if (cleanValue === '') {
        cleanValue = null
      }
      
      cleaned[cleanKey] = cleanValue
    }
  })
  
  return cleaned
}
