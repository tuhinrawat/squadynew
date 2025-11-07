import { startTimer, stopTimer, resetTimer, getTimerValue, pauseTimer, resumeTimer } from '@/lib/auction-timer'

// Mock timers
jest.useFakeTimers()

describe('Auction Timer', () => {
  beforeEach(() => {
    // Clear all timers before each test
    jest.clearAllTimers()
    // Stop any running timers
    stopTimer('test-auction-1')
    stopTimer('test-auction-2')
  })

  afterEach(() => {
    jest.clearAllTimers()
  })

  describe('startTimer', () => {
    it('should start a timer with the given seconds', () => {
      const onComplete = jest.fn()
      startTimer('test-auction-1', 5, onComplete)
      
      expect(getTimerValue('test-auction-1')).toBe(5)
      expect(onComplete).not.toHaveBeenCalled()
    })

    it('should call onComplete when timer reaches zero', () => {
      const onComplete = jest.fn()
      startTimer('test-auction-1', 2, onComplete)
      
      // Fast-forward 2 seconds
      jest.advanceTimersByTime(2000)
      
      expect(onComplete).toHaveBeenCalledTimes(1)
      expect(getTimerValue('test-auction-1')).toBe(0)
    })

    it('should stop timer when it completes', () => {
      const onComplete = jest.fn()
      startTimer('test-auction-1', 1, onComplete)
      
      jest.advanceTimersByTime(1000)
      
      // Timer should be stopped after completion
      expect(getTimerValue('test-auction-1')).toBe(0)
    })

    it('should replace existing timer if one exists', () => {
      const onComplete1 = jest.fn()
      const onComplete2 = jest.fn()
      
      startTimer('test-auction-1', 10, onComplete1)
      startTimer('test-auction-1', 5, onComplete2)
      
      expect(getTimerValue('test-auction-1')).toBe(5)
      
      jest.advanceTimersByTime(5000)
      
      expect(onComplete1).not.toHaveBeenCalled()
      expect(onComplete2).toHaveBeenCalledTimes(1)
    })

    it('should handle multiple timers independently', () => {
      const onComplete1 = jest.fn()
      const onComplete2 = jest.fn()
      
      startTimer('test-auction-1', 3, onComplete1)
      startTimer('test-auction-2', 5, onComplete2)
      
      jest.advanceTimersByTime(3000)
      
      expect(onComplete1).toHaveBeenCalledTimes(1)
      expect(onComplete2).not.toHaveBeenCalled()
      
      jest.advanceTimersByTime(2000)
      
      expect(onComplete2).toHaveBeenCalledTimes(1)
    })
  })

  describe('stopTimer', () => {
    it('should stop a running timer', () => {
      const onComplete = jest.fn()
      startTimer('test-auction-1', 5, onComplete)
      
      stopTimer('test-auction-1')
      
      jest.advanceTimersByTime(10000)
      
      expect(onComplete).not.toHaveBeenCalled()
      expect(getTimerValue('test-auction-1')).toBe(0)
    })

    it('should handle stopping non-existent timer', () => {
      expect(() => stopTimer('non-existent')).not.toThrow()
    })

    it('should not affect other timers', () => {
      const onComplete1 = jest.fn()
      const onComplete2 = jest.fn()
      
      startTimer('test-auction-1', 5, onComplete1)
      startTimer('test-auction-2', 5, onComplete2)
      
      stopTimer('test-auction-1')
      
      jest.advanceTimersByTime(5000)
      
      expect(onComplete1).not.toHaveBeenCalled()
      expect(onComplete2).toHaveBeenCalledTimes(1)
    })
  })

  describe('resetTimer', () => {
    it('should reset timer to new value', () => {
      const onComplete = jest.fn()
      startTimer('test-auction-1', 5, onComplete)
      
      jest.advanceTimersByTime(2000)
      resetTimer('test-auction-1', 10)
      
      expect(getTimerValue('test-auction-1')).toBe(10)
      
      jest.advanceTimersByTime(3000)
      
      expect(onComplete).not.toHaveBeenCalled()
    })

    it('should handle resetting non-existent timer', () => {
      expect(() => resetTimer('non-existent', 10)).not.toThrow()
    })
  })

  describe('getTimerValue', () => {
    it('should return current timer value', () => {
      startTimer('test-auction-1', 10, jest.fn())
      
      expect(getTimerValue('test-auction-1')).toBe(10)
      
      jest.advanceTimersByTime(3000)
      
      expect(getTimerValue('test-auction-1')).toBe(7)
    })

    it('should return 0 for non-existent timer', () => {
      expect(getTimerValue('non-existent')).toBe(0)
    })
  })

  describe('pauseTimer', () => {
    it('should pause a running timer', () => {
      const onComplete = jest.fn()
      startTimer('test-auction-1', 5, onComplete)
      
      jest.advanceTimersByTime(2000)
      pauseTimer('test-auction-1')
      
      const valueBefore = getTimerValue('test-auction-1')
      
      jest.advanceTimersByTime(10000)
      
      expect(getTimerValue('test-auction-1')).toBe(valueBefore)
      expect(onComplete).not.toHaveBeenCalled()
    })

    it('should handle pausing non-existent timer', () => {
      expect(() => pauseTimer('non-existent')).not.toThrow()
    })
  })

  describe('resumeTimer', () => {
    it('should resume a paused timer', () => {
      const onComplete = jest.fn()
      startTimer('test-auction-1', 5, onComplete)
      
      jest.advanceTimersByTime(2000)
      pauseTimer('test-auction-1')
      
      const pausedValue = getTimerValue('test-auction-1')
      
      resumeTimer('test-auction-1')
      
      jest.advanceTimersByTime(pausedValue * 1000)
      
      expect(onComplete).toHaveBeenCalledTimes(1)
    })

    it('should handle resuming non-existent timer', () => {
      expect(() => resumeTimer('non-existent')).not.toThrow()
    })

    it('should handle resuming already running timer', () => {
      const onComplete = jest.fn()
      startTimer('test-auction-1', 5, onComplete)
      
      resumeTimer('test-auction-1')
      
      jest.advanceTimersByTime(5000)
      
      // Should only complete once (not twice)
      expect(onComplete).toHaveBeenCalledTimes(1)
    })
  })
})

