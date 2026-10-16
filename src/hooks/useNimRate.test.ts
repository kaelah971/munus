import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { INFORMATIVE_RATE_TTL_MS, useNimRate } from './useNimRate'
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

describe('useNimRate informational policy', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('loads once on mount without touching any wallet API', async () => {
    const fetchRate = vi.fn().mockResolvedValue(rateAt(Date.now()))
    const { result } = renderHook(() => useNimRate(fetchRate, Date.now()))
    expect(result.current.loading).toBe(true)
    // The fetch starts synchronously with the effect, like a plain fetch;
    // only state updates are deferred. Still zero wallet contact.
    expect(fetchRate).toHaveBeenCalledTimes(1)
    expect(globalThis.window?.nimiq).toBeUndefined()
    await flush()
    expect(fetchRate).toHaveBeenCalledTimes(1)
    expect(result.current.rate?.ngnPerNim).toBe('0.410829')
    expect(result.current.freshness).toBe('fresh')
    expect(result.current.error).toBeNull()
  })

  it('retains the last good rate across transient failures and retries with backoff', async () => {
    const now = Date.now()
    const fetchRate = vi.fn()
      .mockResolvedValueOnce(rateAt(now))
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(rateAt(now + 30_000, '0.42'))
    const { result } = renderHook(() => useNimRate(fetchRate, now))
    await flush()
    expect(result.current.rate?.ngnPerNim).toBe('0.410829')

    // Manual refresh fails: the retained rate stays visible, error noted.
    act(() => {
      void result.current.refresh()
    })
    await flush()
    expect(fetchRate).toHaveBeenCalledTimes(2)
    expect(result.current.rate?.ngnPerNim).toBe('0.410829')
    expect(result.current.error).toContain('boom')

    // Auto-retry at +2s fails again, then +5s succeeds with a fresh rate.
    await flush(2_000)
    expect(fetchRate).toHaveBeenCalledTimes(3)
    await flush(5_000)
    expect(result.current.rate?.ngnPerNim).toBe('0.42')
    expect(result.current.error).toBeNull()
    expect(fetchRate).toHaveBeenCalledTimes(4)
  })

  it('stops retrying after the bounded attempts and keeps honest state', async () => {
    const fetchRate = vi.fn().mockRejectedValue(new Error('down'))
    const { result } = renderHook(() => useNimRate(fetchRate, Date.now()))
    await flush()
    expect(result.current.error).toBe('down')
    expect(result.current.rate).toBeNull()
    expect(result.current.loading).toBe(false)
    await flush(60_000)
    // Initial + 3 bounded retries, then silence (the 60s poll is separate).
    expect(fetchRate.mock.calls.length).toBeLessThanOrEqual(5)
  })

  it('expires retained rates outside the informational window', async () => {
    const now = Date.now()
    const fetchRate = vi.fn().mockResolvedValue(rateAt(now - INFORMATIVE_RATE_TTL_MS - 1_000))
    const { result } = renderHook(() => useNimRate(fetchRate, now))
    await flush()
    expect(fetchRate).toHaveBeenCalled()
    expect(result.current.rate).toBeNull()
    expect(result.current.freshness).toBe('stale')
  })

  it('marks recent retained rates distinctly from fresh ones', async () => {
    const now = Date.now()
    // Server TTL (120s) lapsed 10s ago, but well within the 5-minute window.
    const fetchRate = vi.fn().mockResolvedValue(rateAt(now - 130_000))
    const { result } = renderHook(() => useNimRate(fetchRate, now))
    await flush()
    expect(result.current.rate?.ngnPerNim).toBe('0.410829')
    expect(result.current.freshness).toBe('recent')
  })

  it('manual refresh refetches on demand', async () => {
    const fetchRate = vi.fn()
      .mockResolvedValueOnce(rateAt(Date.now(), '0.41'))
      .mockResolvedValueOnce(rateAt(Date.now(), '0.42'))
    const { result } = renderHook(() => useNimRate(fetchRate, Date.now()))
    await flush()
    expect(result.current.rate?.ngnPerNim).toBe('0.41')
    act(() => {
      result.current.refresh()
    })
    await flush()
    expect(result.current.rate?.ngnPerNim).toBe('0.42')
    expect(fetchRate).toHaveBeenCalledTimes(2)
  })
})
