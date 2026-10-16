import { useCallback, useEffect, useState } from 'react'
import type { NimIndicativeRate } from '../persistence/paymentApi'

/** Informational-only retention: a recent rate may back Home/form display. */
export const INFORMATIVE_RATE_TTL_MS = 5 * 60_000
/** Bounded background retry after a failed informational fetch. */
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000]
/** Steady background revalidation while mounted. */
const REVALIDATE_INTERVAL_MS = 60_000

export type RateFreshness = 'fresh' | 'recent' | 'stale' | 'none'

export interface NimRateState {
  /** Displayable rate: fresh, or recent within the informational window. */
  rate: NimIndicativeRate | null
  freshness: RateFreshness
  /** Initial load with nothing displayable yet. */
  loading: boolean
  /** A background fetch is in flight while a rate remains displayed. */
  refreshing: boolean
  /** Last failure message, cleared on success. */
  error: string | null
  refresh: () => void
}

/**
 * Shared informational NIM/NGN rate for Home estimates and the Airtime
 * form preview. Never payment authority: quotes are priced server-side
 * from a live rate with their own strict TTL.
 *
 * Behavior: fetch on mount, retain the last good rate for
 * INFORMATIVE_RATE_TTL_MS across transient failures, retry failures
 * with bounded backoff (2s → 5s → 15s, then stop), and revalidate every
 * 60s while mounted. All timers abort on unmount. No wallet contact.
 */
export function useNimRate(
  fetchRate: ((signal: AbortSignal) => Promise<NimIndicativeRate>) | undefined,
  nowMs: number,
  /**
   * Restarts the lifecycle when the surrounding scope changes (e.g. the
   * wallet account switched). In-flight attempts are abandoned so stale
   * responses can never overwrite the new scope.
   */
  scopeKey?: string,
): NimRateState {
  const [nonce, setNonce] = useState(0)
  const [snapshot, setSnapshot] = useState<{
    rate: NimIndicativeRate | null
    refreshing: boolean
    error: string | null
  }>({ rate: null, refreshing: false, error: null })

  useEffect(() => {
    if (!fetchRate) return
    let active = true
    let attempt = 0
    let inflight: AbortController | null = null
    const timers: Array<ReturnType<typeof setTimeout>> = []

    const settleSuccess = (rate: NimIndicativeRate) => {
      if (!active) return
      attempt = 0
      inflight = null
      setSnapshot({ rate, refreshing: false, error: null })
    }
    const settleFailure = (error: unknown) => {
      if (!active) return
      inflight = null
      const message = error instanceof Error ? error.message : 'NIM rate unavailable.'
      setSnapshot((prev) => ({ rate: prev.rate, refreshing: false, error: message }))
      if (attempt < RETRY_DELAYS_MS.length) {
        const delay = RETRY_DELAYS_MS[attempt]
        attempt += 1
        timers.push(setTimeout(() => runAttempt(), delay))
      }
    }
    const runAttempt = () => {
      if (!active || inflight) return
      const controller = new AbortController()
      inflight = controller
      // The fetch itself starts synchronously so every effect run issues
      // its own attempt; every state update stays inside promise
      // callbacks below, never synchronous in the effect body.
      let result: Promise<NimIndicativeRate>
      try {
        result = fetchRate(controller.signal)
      } catch (error) {
        void Promise.resolve().then(() => settleFailure(error))
        return
      }
      void Promise.resolve().then(() => {
        if (active) setSnapshot((prev) => (prev.rate ? { ...prev, refreshing: true } : prev))
      })
      void result.then(settleSuccess, settleFailure)
    }

    runAttempt()
    const interval = setInterval(() => runAttempt(), REVALIDATE_INTERVAL_MS)
    return () => {
      active = false
      timers.forEach((timer) => clearTimeout(timer))
      clearInterval(interval)
      inflight?.abort()
    }
  }, [fetchRate, nonce, scopeKey])

  const refresh = useCallback(() => {
    setNonce((current) => current + 1)
  }, [])


  const { rate, refreshing, error } = snapshot
  const asOf = rate ? Date.parse(rate.asOf) : NaN
  const displayable = rate && Number.isFinite(asOf) && nowMs < asOf + INFORMATIVE_RATE_TTL_MS ? rate : null
  const freshness: RateFreshness = !rate
    ? 'none'
    : nowMs < Date.parse(rate.expiresAt)
      ? 'fresh'
      : displayable
        ? 'recent'
        : 'stale'
  return {
    rate: displayable,
    freshness,
    loading: displayable === null && error === null,
    refreshing: refreshing && displayable !== null,
    error,
    refresh,
  }
}
