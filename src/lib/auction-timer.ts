type TimerCallback = () => void

const timers = new Map<string, {
  interval: NodeJS.Timeout | null
  seconds: number
  onComplete: TimerCallback
}>()

export function startTimer(auctionId: string, seconds: number, onComplete: TimerCallback) {
  // Clear existing timer if any
  stopTimer(auctionId)

  const timer = {
    interval: null as NodeJS.Timeout | null,
    seconds,
    onComplete
  }

  timer.interval = setInterval(() => {
    timer.seconds--
    
    if (timer.seconds <= 0) {
      stopTimer(auctionId)
      onComplete()
    }
  }, 1000)

  timers.set(auctionId, timer)
}

export function resetTimer(auctionId: string, seconds: number) {
  const timer = timers.get(auctionId)
  if (timer) {
    timer.seconds = seconds
  }
}

export function stopTimer(auctionId: string) {
  const timer = timers.get(auctionId)
  if (timer && timer.interval) {
    clearInterval(timer.interval)
    timers.delete(auctionId)
  }
}

export function getTimerValue(auctionId: string): number {
  const timer = timers.get(auctionId)
  return timer ? timer.seconds : 0
}

export function pauseTimer(auctionId: string) {
  const timer = timers.get(auctionId)
  if (timer && timer.interval) {
    clearInterval(timer.interval)
    timer.interval = null
  }
}

export function resumeTimer(auctionId: string) {
  const timer = timers.get(auctionId)
  if (timer && !timer.interval) {
    timer.interval = setInterval(() => {
      timer.seconds--
      
      if (timer.seconds <= 0) {
        stopTimer(auctionId)
        timer.onComplete()
      }
    }, 1000)
  }
}

