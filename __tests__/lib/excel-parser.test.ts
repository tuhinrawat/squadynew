import { parseExcelFile, validatePlayerData, cleanPlayerData } from '@/lib/excel-parser'

// Mock XLSX library
jest.mock('xlsx', () => ({
  read: jest.fn(() => ({
    SheetNames: ['Sheet1'],
    Sheets: {
      Sheet1: {},
    },
  })),
  utils: {
    sheet_to_json: jest.fn(() => [
      ['Name', 'Speciality', 'Base Price'],
      ['Player 1', 'Batter', 10000],
      ['Player 2', 'Bowler', 15000],
      ['Player 3', 'Allrounder', 20000],
    ]),
  },
}))

describe('Excel Parser Utilities', () => {
  describe('parseExcelFile', () => {
    it('should parse valid Excel file', async () => {
      const file = new File(['test'], 'test.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      
      // Mock FileReader
      const mockFileReader = {
        readAsBinaryString: jest.fn(function(this: any, file: File) {
          setTimeout(() => {
            this.onload({ target: { result: 'binary data' } })
          }, 0)
        }),
        onload: null as any,
        onerror: null as any,
      }
      
      global.FileReader = jest.fn(() => mockFileReader) as any

      const result = await parseExcelFile(file)
      
      expect(result.success).toBe(true)
      expect(result.data).toBeDefined()
      expect(result.columns).toBeDefined()
      expect(result.preview).toBeDefined()
    })

    it('should handle file read errors', async () => {
      const file = new File(['test'], 'test.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      
      const mockFileReader = {
        readAsBinaryString: jest.fn(function(this: any) {
          setTimeout(() => {
            this.onerror()
          }, 0)
        }),
        onload: null as any,
        onerror: null as any,
      }
      
      global.FileReader = jest.fn(() => mockFileReader) as any

      const result = await parseExcelFile(file)
      
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('validatePlayerData', () => {
    it('should validate valid player data', () => {
      const validData = [
        { Name: 'Player 1', Speciality: 'Batter', 'Base Price': 10000 },
        { Name: 'Player 2', Speciality: 'Bowler', 'Base Price': 15000 },
      ]

      const result = validatePlayerData(validData)
      
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should reject empty data array', () => {
      const result = validatePlayerData([])
      
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors[0]).toContain('No player data provided')
    })

    it('should reject null or undefined data', () => {
      const result1 = validatePlayerData(null as any)
      expect(result1.valid).toBe(false)
      expect(result1.errors).toContain('No player data provided')

      const result2 = validatePlayerData(undefined as any)
      expect(result2.valid).toBe(false)
      expect(result2.errors).toContain('No player data provided')
    })

    it('should reject players with all empty fields', () => {
      const invalidData = [
        { Name: '', Speciality: '', 'Base Price': '' },
        { Name: 'Player 1', Speciality: 'Batter', 'Base Price': 10000 },
      ]

      const result = validatePlayerData(invalidData)
      
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })
  })

  describe('cleanPlayerData', () => {
    it('should clean player data', () => {
      const dirtyData = {
        '  Name  ': '  Player 1  ',
        'Speciality': 'Batter',
        'Base Price': '10000',
        'Empty Field': '',
      }

      const cleaned = cleanPlayerData(dirtyData)
      
      expect(cleaned['Name']).toBe('  Player 1  ') // Values are not trimmed, only keys
      expect(cleaned['Empty Field']).toBeNull()
      expect(cleaned['Base Price']).toBe(10000) // Should convert string numbers
    })

    it('should convert numeric strings to numbers', () => {
      const data = {
        'Base Price': '10000',
        'Age': '25',
        'Runs': '1500',
      }

      const cleaned = cleanPlayerData(data)
      
      expect(cleaned['Base Price']).toBe(10000)
      expect(cleaned['Age']).toBe(25)
      expect(cleaned['Runs']).toBe(1500)
    })

    it('should convert empty strings to null', () => {
      const data = {
        'Name': 'Player 1',
        'Empty Field': '',
        'Another Empty': '',
      }

      const cleaned = cleanPlayerData(data)
      
      expect(cleaned['Empty Field']).toBeNull()
      expect(cleaned['Another Empty']).toBeNull()
    })

    it('should handle empty objects', () => {
      const cleaned = cleanPlayerData({})
      expect(cleaned).toEqual({})
    })

    it('should preserve non-numeric strings', () => {
      const data = {
        'Name': 'Player 1',
        'Speciality': 'Batter',
        'Team': 'Team A',
      }

      const cleaned = cleanPlayerData(data)
      
      expect(cleaned['Name']).toBe('Player 1')
      expect(cleaned['Speciality']).toBe('Batter')
      expect(cleaned['Team']).toBe('Team A')
    })
  })
})

