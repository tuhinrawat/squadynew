import { act, renderHook } from '@testing-library/react'
import { useConnectivityBeacon } from '@/hooks/use-connectivity-beacon'

// This hook drives an automatic "switch to offline mode" banner during a
// live auction - a false "offline" flip is a false alarm during a real
// event, and a missed "actually offline" is worse. These tests exist
// because that failure-streak/recovery timing is exactly the kind of logic
// that's easy to get subtly wrong.
//
// Each timer advance is wrapped in act() - the state updates here come from
// setTimeout callbacks outside React's normal render/event flow, and without
// act() wrapping, `result.current` can read stale state even though the
// hook's internal logic already ran correctly (confirmed by tracing the
// hook directly before adding this wrapping).

async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms)
  })
}

describe('useConnectivityBeacon', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('reports online after a successful check', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    const { result } = renderHook(() => useConnectivityBeacon('auction-1'))

    await advance(0)

    expect(result.current.isOnline).toBe(true)
  })

  it('does not flip offline after a single failed check', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network error'))
    const { result } = renderHook(() => useConnectivityBeacon('auction-2'))

    await advance(0)

    expect(result.current.isOnline).toBe(true)
  })

  it('flips offline only after two consecutive failed checks', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network error'))
    const { result } = renderHook(() => useConnectivityBeacon('auction-3'))

    await advance(0) // 1st check fails
    expect(result.current.isOnline).toBe(true)

    await advance(5000) // 2nd check fails
    expect(result.current.isOnline).toBe(false)
  })

  it('recovers immediately on the next successful check after going offline', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    global.fetch = fetchMock
    const { result } = renderHook(() => useConnectivityBeacon('auction-4'))

    await advance(0)
    await advance(5000)
    expect(result.current.isOnline).toBe(false)

    await advance(5000) // 3rd check succeeds
    expect(result.current.isOnline).toBe(true)
  })

  it('treats a non-OK HTTP response the same as a network failure', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response('{}', { status: 500 }))
    const { result } = renderHook(() => useConnectivityBeacon('auction-5'))

    await advance(0)
    await advance(5000)

    expect(result.current.isOnline).toBe(false)
  })

  it('stops scheduling further checks after unmount', async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    global.fetch = fetchMock
    const { unmount } = renderHook(() => useConnectivityBeacon('auction-6'))

    await advance(0)
    const callsBeforeUnmount = fetchMock.mock.calls.length
    unmount()

    await advance(20000)

    expect(fetchMock.mock.calls.length).toBe(callsBeforeUnmount)
  })
})
