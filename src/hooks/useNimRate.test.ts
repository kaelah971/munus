import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  RECENT_RATE_TTL_MS,
  configureNimRateFetcher,
  createNimRateStore,
  nimRateStore,
  useNimRate,
} from './useNimRate'
import type { NimIndicativeRate } from '../persistence/paymentApi'

function rateAt(asOfMs: number, ngnPerNim = '0.410829'): NimIndicativeRate {
  return {
    ngnPerNim,
    source: 'coingecko:nimiq-2/ngn',
    asOf: new Date(asOfMs).toISOString(),
    expiresAt: new Date(asOfMs + 120_000).toISOString(),
  }
}

async function flush(ms = 10) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('NimRateStore informational policy', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('is global: configuration is not keyed by wallet, session, or account', async () => {
    const store = createNimRateStore()
    const fetchRate = vi.fn().mockResolvedValue(rateAt(Date.now()))
    store.configure(fetchRate)
    // Two different "users" share one loop and one fetch.
    const first = renderHook(({ nowMs }: { nowMs: number }) => {
      const state = useNimRate(nowMs, store)
      return state
    }, { initialProps: { nowMs: Date.now() } })
    const second = renderHook(({ nowMs }: { nowMs: number }) => {
      const state = useNimRate(nowMs, store)
      return state
    }, { initialProps: { nowMs: Date.now() } })
    await flush()
    expect(fetchRate).toHaveBeenCalledTimes(1)
    expect(first.result.current.rate?.ngnPerNim).toBe('0.410829')
    expect(second.result.current.rate?.ngnPerNim).toBe('0.410829')
    first.unmount()
    second.unmount()
  })

  it('retains the last good rate across transient failures and retries with backoff', async () => {
    const store = createNimRateStore()
    const now = Date.now()
    const fetchRate = vi.fn()
      .mockResolvedValueOnce(rateAt(now))
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(rateAt(now + 30_000, '0.42'))
    store.configure(fetchRate)
    const { result } = renderHook(() => useNimRate(now, store))
    await flush()
    expect(result.current.rate?.ngnPerNim).toBe('0.410829')

    store.refresh()
    await flush()
    expect(fetchRate).toHaveBeenCalledTimes(2)
    expect(result.current.rate?.ngnPerNim).toBe('0.410829')
    expect(result.current.error).toContain('boom')

    await flush(2_000)
    expect(fetchRate).toHaveBeenCalledTimes(3)
    await flush(5_000)
    expect(result.current.rate?.ngnPerNim).toBe('0.42')
    expect(result.current.error).toBeNull()
    expect(fetchRate).toHaveBeenCalledTimes(4)
  })

  it('keeps retrying at a low cadence instead of stopping forever', async () => {
    const store = createNimRateStore()
    const fetchRate = vi.fn().mockRejectedValue(new Error('down'))
    store.configure(fetchRate)
    const { result } = renderHook(() => useNimRate(Date.now(), store))
    await flush()
    expect(result.current.error).toBe('down')
    expect(result.current.rate).toBeNull()
    const before = fetchRate.mock.calls.length
    await flush(5 * 60_000)
    // Retries at 2s/5s/15s/30s then every 60s: strictly more attempts.
    expect(fetchRate.mock.calls.length).toBeGreaterThan(before)
    // And still honest: nothing displayable, no fabrication.
    expect(result.current.rate).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  it('expires retained rates outside the informational window', async () => {
    const store = createNimRateStore()
    const now = Date.now()
    store.configure(vi.fn().mockResolvedValue(rateAt(now - RECENT_RATE_TTL_MS - 1_000)))
    const { result } = renderHook(() => useNimRate(now, store))
    await flush()
    expect(result.current.rate).toBeNull()
    expect(result.current.freshness).toBe('stale')
  })

  it('marks recent retained rates distinctly from fresh ones', async () => {
    const store = createNimRateStore()
    const now = Date.now()
    store.configure(vi.fn().mockResolvedValue(rateAt(now - 130_000)))
    const { result } = renderHook(() => useNimRate(now, store))
    await flush()
    expect(result.current.rate?.ngnPerNim).toBe('0.410829')
    expect(result.current.freshness).toBe('recent')
  })

  it('seeds from validated persisted rates without extending freshness', async () => {
    const now = Date.now()
    window.localStorage.setItem('munus:nim-rate', JSON.stringify(rateAt(now - 130_000)))
    const store = createNimRateStore()
    store.configure(vi.fn().mockRejectedValue(new Error('down')))
    const { result } = renderHook(() => useNimRate(now, store))
    await flush(10)
    // Seeded from storage: visible immediately, aging from original asOf.
    expect(result.current.rate?.ngnPerNim).toBe('0.410829')
    expect(result.current.freshness).toBe('recent')
  })

  it('rejects corrupt or ancient persisted rates', async () => {
    window.localStorage.setItem('munus:nim-rate', 'not-json{')
    const ancient = createNimRateStore()
    ancient.configure(vi.fn().mockRejectedValue(new Error('down')))
    const first = renderHook(() => useNimRate(Date.now(), ancient))
    await flush(10)
    expect(first.result.current.rate).toBeNull()
    first.unmount()

    window.localStorage.setItem('munus:nim-rate', JSON.stringify(rateAt(Date.now() - RECENT_RATE_TTL_MS - 1_000)))
    const aged = createNimRateStore()
    aged.configure(vi.fn().mockRejectedValue(new Error('down')))
    const second = renderHook(() => useNimRate(Date.now(), aged))
    await flush(10)
    expect(second.result.current.rate).toBeNull()
    second.unmount()
  })

  it('ignores stale responses that land after remount success', async () => {
    const store = createNimRateStore()
    let resolveSlow!: (rate: NimIndicativeRate) => void
    const slow = new Promise<NimIndicativeRate>((resolve) => { resolveSlow = resolve })
    const fetchRate = vi.fn()
      .mockReturnValueOnce(slow)
      .mockResolvedValue(rateAt(Date.now(), '0.42'))
    store.configure(fetchRate)
    const first = renderHook(() => useNimRate(Date.now(), store))
    await flush(10)
    expect(fetchRate).toHaveBeenCalledTimes(1)
    // Remount abandons the slow attempt; the new lifecycle resolves first.
    first.unmount()
    const second = renderHook(() => useNimRate(Date.now(), store))
    await flush(10)
    expect(second.result.current.rate?.ngnPerNim).toBe('0.42')
    // ...then the older request lands late and must not overwrite.
    await act(async () => {
      resolveSlow(rateAt(Date.now(), '0.41'))
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(second.result.current.rate?.ngnPerNim).toBe('0.42')
    second.unmount()
  })
})

describe('global nimRateStore wiring', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.localStorage.clear()
    nimRateStore.resetForTests()
  })

  afterEach(() => {
    nimRateStore.resetForTests()
    vi.useRealTimers()
  })

  it('feeds every consumer from one loop without wallet coupling', async () => {
    const fetchRate = vi.fn().mockResolvedValue(rateAt(Date.now()))
    configureNimRateFetcher(fetchRate)
    const { result } = renderHook(() => useNimRate(Date.now()))
    await flush()
    expect(result.current.rate?.ngnPerNim).toBe('0.410829')
    expect(fetchRate).toHaveBeenCalledTimes(1)
  })
})
