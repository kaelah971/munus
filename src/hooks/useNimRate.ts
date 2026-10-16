import { useSyncExternalStore } from 'react'
import type { NimIndicativeRate } from '../persistence/paymentApi'

/**
 * Recent informational window: a recent rate may back Home/form display.
 * Freshness itself still follows the server quote TTL (~120s); beyond
 * that a rate is recent-but-aging until this bound, then stale.
 */
export const RECENT_RATE_TTL_MS = 15 * 60_000
/** Bounded retry after a failed fetch, then a steady low cadence forever. */
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000]
/** Steady background revalidation while observed. */
const REVALIDATE_INTERVAL_MS = 60_000
const STORE_KEY = 'munus:nim-rate'

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

interface RateSnapshot {
  rate: NimIndicativeRate | null
  refreshing: boolean
  error: string | null
}

type RateFetcher = (signal: AbortSignal) => Promise<NimIndicativeRate>
type Listener = () => void

function isRateShape(value: unknown): value is NimIndicativeRate {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.ngnPerNim === 'string' &&
    typeof record.source === 'string' &&
    typeof record.asOf === 'string' &&
    typeof record.expiresAt === 'string'
  )
}

function readStoredRate(nowMs: number): NimIndicativeRate | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    const raw = window.localStorage.getItem(STORE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isRateShape(parsed)) return null
    const asOf = Date.parse(parsed.asOf)
    // Seeded rates age honestly from their original asOf — persistence
    // never extends freshness and never feeds payment authority.
    if (!Number.isFinite(asOf) || nowMs >= asOf + RECENT_RATE_TTL_MS) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * Single shared informational NIM/NGN rate loop. The rate is global
 * market data: it is never keyed by wallet, session, or account, so
 * sign-in changes, route changes, and remounts never reset it.
 */
export class NimRateStore {
  private snapshot: RateSnapshot = { rate: null, refreshing: false, error: null }
  private listeners = new Set<Listener>()
  private fetcher: RateFetcher | null = null
  private attempt = 0
  private inflight: AbortController | null = null
  private epoch = 0
  private timers: Array<ReturnType<typeof setTimeout>> = []
  private interval: ReturnType<typeof setInterval> | null = null
  private visibilityAttached = false

  constructor() {
    const seeded = readStoredRate(Date.now())
    if (seeded) this.snapshot = { rate: seeded, refreshing: false, error: null }
  }

  configure(fetcher: RateFetcher | null): void {
    this.fetcher = fetcher
    if (fetcher) this.ensureRunning()
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    this.ensureRunning()
    this.attachVisibility()
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) {
        this.teardownLoop()
        this.detachVisibility()
      }
    }
  }

  getSnapshot = (): RateSnapshot => {
    return this.snapshot
  }

  refresh = (): void => {
    this.attemptFetch()
  }

  /** Test-only reset back to a pristine store. */
  resetForTests(): void {
    this.teardownLoop()
    this.listeners.clear()
    this.fetcher = null
    this.attempt = 0
    this.epoch += 1
    this.snapshot = { rate: null, refreshing: false, error: null }
    try {
      window.localStorage?.removeItem(STORE_KEY)
    } catch {
      // Ignore storage failures in tests.
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  private ensureRunning(): void {
    if (!this.fetcher || this.listeners.size === 0 || this.interval) return
    void this.attemptFetch()
    this.interval = setInterval(() => this.attemptFetch(), REVALIDATE_INTERVAL_MS)
  }

  private teardownLoop(): void {
    this.timers.forEach((timer) => clearTimeout(timer))
    this.timers = []
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
    this.inflight?.abort()
    this.inflight = null
  }

  private scheduleRetry(): void {
    const delay = this.attempt < RETRY_DELAYS_MS.length ? RETRY_DELAYS_MS[this.attempt] : REVALIDATE_INTERVAL_MS
    this.attempt += 1
    const timer = setTimeout(() => this.attemptFetch(), delay)
    this.timers.push(timer)
  }

  private attemptFetch(): void {
    if (!this.fetcher || this.inflight) return
    const controller = new AbortController()
    const epoch = this.epoch
    this.inflight = controller
    if (this.snapshot.rate) {
      this.snapshot = { ...this.snapshot, refreshing: true }
      this.emit()
    }
    void this.fetcher(controller.signal).then(
      (rate) => {
        if (this.inflight !== controller || epoch !== this.epoch) return
        this.inflight = null
        this.attempt = 0
        this.snapshot = { rate, refreshing: false, error: null }
        this.persist(rate)
        this.emit()
      },
      (error: unknown) => {
        if (this.inflight !== controller || epoch !== this.epoch) return
        this.inflight = null
        const message = error instanceof Error ? error.message : 'NIM rate unavailable.'
        this.snapshot = { ...this.snapshot, refreshing: false, error: message }
        this.emit()
        // Retry forever at a decaying then steady cadence — a failed
        // refresh must never permanently wedge the display.
        this.scheduleRetry()
      },
    )
  }

  private persist(rate: NimIndicativeRate): void {
    try {
      window.localStorage?.setItem(STORE_KEY, JSON.stringify(rate))
    } catch {
      // Storage is a convenience cache; failures must not break rates.
    }
  }

  private attachVisibility(): void {
    if (this.visibilityAttached || typeof window === 'undefined' || typeof document === 'undefined') return
    this.visibilityAttached = true
    window.addEventListener('focus', this.handleVisible)
    document.addEventListener('visibilitychange', this.handleVisible)
    window.addEventListener('pageshow', this.handleVisible)
  }

  private detachVisibility(): void {
    if (!this.visibilityAttached || typeof window === 'undefined' || typeof document === 'undefined') return
    this.visibilityAttached = false
    window.removeEventListener('focus', this.handleVisible)
    document.removeEventListener('visibilitychange', this.handleVisible)
    window.removeEventListener('pageshow', this.handleVisible)
  }

  private handleVisible = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    // Webview resume: refresh when nothing is held, or the held rate is
    // past its server TTL. Recent rates otherwise ride out resume.
    const rate = this.snapshot.rate
    if (!rate || Date.now() >= Date.parse(rate.expiresAt)) this.attemptFetch()
  }
}

export const nimRateStore = new NimRateStore()

/** Wire (or unwire) the authenticated fetcher feeding the shared loop. */
export function configureNimRateFetcher(
  fetcher: ((signal: AbortSignal) => Promise<NimIndicativeRate>) | null,
): void {
  nimRateStore.configure(fetcher)
}

export function createNimRateStore(): NimRateStore {
  return new NimRateStore()
}

/**
 * Shared informational NIM/NGN rate for Home estimates and the Airtime
 * form preview. Never payment authority: quotes are priced server-side
 * from a live rate with their own strict TTL. No wallet contact.
 */
export function useNimRate(nowMs: number, store: NimRateStore = nimRateStore): NimRateState {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)

  const { rate, refreshing, error } = snapshot
  const asOf = rate ? Date.parse(rate.asOf) : NaN
  const displayable = rate && Number.isFinite(asOf) && nowMs < asOf + RECENT_RATE_TTL_MS ? rate : null
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
    refresh: store.refresh,
  }
}
