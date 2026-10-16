import type { DatabasePool } from './database'
import { NimRateError, NimRateTimeoutError, type NimRateProvider } from './nimRates'

/**
 * Durable last-known-good informational market rates. Home and form NGN
 * estimates read the freshest trustworthy row when the upstream provider
 * is temporarily unavailable, so a CoinGecko outage never blanks the
 * display. Display evidence only: payment quotes never read this store
 * and always price from a live upstream rate.
 */
export interface MarketRateRecord {
  asset: string
  quoteCurrency: string
  /** Exact decimal NGN per unit, never a float. */
  rate: string
  source: string
  /** ISO timestamp of the upstream observation. Never rewritten on read. */
  observedAt: string
}

export interface MarketRateStore {
  readRate(asset: string, quoteCurrency: string): Promise<MarketRateRecord | null>
  writeRate(record: MarketRateRecord): Promise<void>
}

function isExactPositiveDecimal(value: unknown): value is string {
  return typeof value === 'string' && /^(?=.*[1-9])\d+(\.\d+)?$/.test(value)
}

function isRecordLike(value: unknown): value is MarketRateRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.asset === 'string' &&
    typeof record.quoteCurrency === 'string' &&
    isExactPositiveDecimal(record.rate) &&
    typeof record.source === 'string' &&
    typeof record.observedAt === 'string' &&
    Number.isFinite(Date.parse(record.observedAt))
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown database error'
}

export class PostgresMarketRateStore implements MarketRateStore {
  constructor(private readonly database: DatabasePool) {}

  async readRate(asset: string, quoteCurrency: string): Promise<MarketRateRecord | null> {
    let result
    try {
      result = await this.database.query(
        `SELECT asset, quote_currency, rate, source, observed_at
         FROM public.market_rates
         WHERE asset = $1 AND quote_currency = $2`,
        [asset, quoteCurrency],
      )
    } catch (error) {
      throw new Error(`Could not load market rate: ${errorMessage(error)}`, { cause: error })
    }
    const row = result.rows[0]
    if (!row) return null
    const record = {
      asset: String(row.asset),
      quoteCurrency: String(row.quote_currency),
      // pg returns NUMERIC as a string; String() keeps it exact either way.
      rate: String(row.rate),
      source: String(row.source ?? ''),
      observedAt: row.observed_at instanceof Date ? row.observed_at.toISOString() : String(row.observed_at),
    }
    // A corrupt row must never crash display: treat it as a miss.
    return isRecordLike(record) ? record : null
  }

  async writeRate(record: MarketRateRecord): Promise<void> {
    if (!isRecordLike(record)) throw new Error('Refusing to persist an invalid market rate.')
    try {
      await this.database.query(
        `INSERT INTO public.market_rates (asset, quote_currency, rate, source, observed_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (asset, quote_currency) DO UPDATE SET
           rate = EXCLUDED.rate,
           source = EXCLUDED.source,
           observed_at = EXCLUDED.observed_at,
           updated_at = NOW()`,
        [record.asset, record.quoteCurrency, record.rate, record.source, record.observedAt],
      )
    } catch (error) {
      throw new Error(`Could not persist market rate: ${errorMessage(error)}`, { cause: error })
    }
  }
}

export class InMemoryMarketRateStore implements MarketRateStore {
  private readonly rows = new Map<string, MarketRateRecord>()

  async readRate(asset: string, quoteCurrency: string): Promise<MarketRateRecord | null> {
    return this.rows.get(`${asset}/${quoteCurrency}`) ?? null
  }

  async writeRate(record: MarketRateRecord): Promise<void> {
    if (!isRecordLike(record)) throw new Error('Refusing to persist an invalid market rate.')
    this.rows.set(`${record.asset}/${record.quoteCurrency}`, { ...record })
  }
}

/** Informational max age: a durable row older than this never displays. */
export const INFORMATIVE_RATE_MAX_AGE_MS = 30 * 60_000
/** Cooldown between upstream attempts after a failure; bounds 15s hangs. */
export const INFORMATIVE_FAILURE_COOLDOWN_MS = 60_000
/** Background refresh cadence while the process lives. */
export const INFORMATIVE_REFRESH_INTERVAL_MS = 3 * 60_000

export type InformativeFreshness = 'fresh' | 'recent'

export interface InformativeRate {
  ngnPerNim: string
  asOf: string
  source: string
  freshness: InformativeFreshness
  expiresAt: string
}

export interface InformativeRateTrace {
  upstream: 'success' | 'failure' | 'skipped-cooldown'
  upstreamError?: 'timeout' | 'error'
  /** True when the provider was contacted on this call. */
  upstreamAttempted: boolean
  /** HTTP status when upstream responded; null on transport failure or skip. */
  upstreamStatus: number | null
  /** Short instance-cache verdict for this call. */
  memory: 'hit' | 'miss'
  durable: 'hit' | 'miss' | 'unused'
  /** Age of the served durable row; null unless durable was hit. */
  durableAgeMs: number | null
  durationMs: number
  freshness?: InformativeFreshness
  asOf?: string
}

export interface InformativeRateOutcome {
  rate: InformativeRate
  trace: InformativeRateTrace
}

export interface InformativeRateServiceDeps {
  rates: NimRateProvider
  store: MarketRateStore
  quoteTtlMs: number
  maxAgeMs?: number
  failureCooldownMs?: number
  refreshIntervalMs?: number
  now?: () => number
}

/**
 * Informational NIM/NGN rate with durable fallback. Policy, in order:
 * fresh upstream (or its short memory cache) → recent durable DB row
 * (≤30 min, original observed_at preserved) → honest unavailable.
 * A failed request never clears anything; every failure schedules the
 * next attempt. Payment quote creation does not use this service.
 */
export class InformativeRateService {
  private readonly now: () => number
  private readonly maxAgeMs: number
  private readonly failureCooldownMs: number
  private readonly refreshIntervalMs: number
  private lastFailureAt: number | null = null
  private lastFailure: unknown = null
  private refreshing = false
  private timer: ReturnType<typeof setInterval> | null = null
  private started = false

  private readonly rates: NimRateProvider
  private readonly store: MarketRateStore
  private readonly quoteTtlMs: number

  constructor(deps: InformativeRateServiceDeps) {
    this.rates = deps.rates
    this.store = deps.store
    this.quoteTtlMs = deps.quoteTtlMs
    this.now = deps.now ?? Date.now
    this.maxAgeMs = deps.maxAgeMs ?? INFORMATIVE_RATE_MAX_AGE_MS
    this.failureCooldownMs = deps.failureCooldownMs ?? INFORMATIVE_FAILURE_COOLDOWN_MS
    this.refreshIntervalMs = deps.refreshIntervalMs ?? INFORMATIVE_REFRESH_INTERVAL_MS
  }

  async getRate(): Promise<InformativeRate> {
    return (await this.getRateDetailed()).rate
  }

  async getRateDetailed(): Promise<InformativeRateOutcome> {
    const startedAt = this.now()
    const cooledDown = this.lastFailureAt !== null && startedAt - this.lastFailureAt < this.failureCooldownMs
    if (!cooledDown) {
      try {
        const live = await this.rates.getNimNgnRate()
        this.lastFailureAt = null
        this.lastFailure = null
        await this.persistQuietly({
          asset: 'NIM',
          quoteCurrency: 'NGN',
          rate: live.rateNgnPerNim,
          source: live.source,
          observedAt: live.observedAt,
        })
        const rate = this.toRate(live.rateNgnPerNim, live.source, live.observedAt, 'fresh')
        return {
          rate,
          trace: {
            upstream: 'success',
            upstreamAttempted: true,
            upstreamStatus: null,
            memory: this.rates.lastServedFromCache === true ? 'hit' : 'miss',
            durable: 'unused',
            durableAgeMs: null,
            durationMs: this.now() - startedAt,
            freshness: 'fresh',
            asOf: rate.asOf,
          },
        }
      } catch (error) {
        this.lastFailureAt = startedAt
        this.lastFailure = error
        const stored = await this.readDurableQuietly()
        if (stored) {
          return {
            rate: stored.rate,
            trace: {
              upstream: 'failure',
              upstreamError: error instanceof NimRateTimeoutError ? 'timeout' : 'error',
              upstreamAttempted: true,
              upstreamStatus: error instanceof NimRateError ? (error.upstream?.status ?? null) : null,
              memory: 'miss',
              durable: 'hit',
              durableAgeMs: stored.ageMs,
              durationMs: this.now() - startedAt,
              freshness: 'recent',
              asOf: stored.rate.asOf,
            },
          }
        }
        throw error instanceof NimRateError ? error : new NimRateError('Live NIM rate is unavailable.')
      }
    }
    const stored = await this.readDurableQuietly()
    if (stored) {
      return {
        rate: stored.rate,
        trace: {
          upstream: 'skipped-cooldown',
          upstreamAttempted: false,
          upstreamStatus: null,
          memory: 'miss',
          durable: 'hit',
          durableAgeMs: stored.ageMs,
          durationMs: this.now() - startedAt,
          freshness: 'recent',
          asOf: stored.rate.asOf,
        },
      }
    }
    if (this.lastFailure instanceof NimRateError) throw this.lastFailure
    throw new NimRateError('Live NIM rate is unavailable.')
  }

  /**
   * Starts the background loop: one non-blocking refresh now plus a
   * periodic refresh. Singleflight-guarded; safe to call once from the
   * server entrypoint. Tests construct the service without starting it.
   */
  start(): void {
    if (this.started) return
    this.started = true
    void this.refreshInBackground()
    const timer = setInterval(() => {
      void this.refreshInBackground()
    }, this.refreshIntervalMs)
    const maybeUnref = timer as unknown as { unref?: () => void }
    if (typeof maybeUnref.unref === 'function') maybeUnref.unref()
    this.timer = timer
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.started = false
  }

  private toRate(rateNgnPerNim: string, source: string, observedAt: string, freshness: InformativeFreshness): InformativeRate {
    return {
      ngnPerNim: rateNgnPerNim,
      asOf: observedAt,
      source,
      freshness,
      expiresAt: new Date(Date.parse(observedAt) + this.quoteTtlMs).toISOString(),
    }
  }

  private async readDurableQuietly(): Promise<{ rate: InformativeRate; ageMs: number } | null> {
    let stored: MarketRateRecord | null
    try {
      stored = await this.store.readRate('NIM', 'NGN')
    } catch {
      return null
    }
    if (!stored) return null
    const ageMs = this.now() - Date.parse(stored.observedAt)
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > this.maxAgeMs) return null
    return { rate: this.toRate(stored.rate, stored.source, stored.observedAt, 'recent'), ageMs }
  }

  private async persistQuietly(record: MarketRateRecord): Promise<void> {
    try {
      await this.store.writeRate(record)
      // Proof of durability: every successful upsert is explicit.
      // Rate + source + observed_at are public market data; safe to log.
      console.info('NIM/NGN market rate persisted', {
        rate: record.rate,
        source: record.source,
        observedAt: record.observedAt,
      })
    } catch (error) {
      // A persistence hiccup must never fail a healthy rate response.
      // Rate + source are public market data; safe to log.
      console.warn('Munus market rate persist retryable', {
        rate: record.rate,
        source: record.source,
        cause: errorMessage(error),
      })
    }
  }

  private async refreshInBackground(): Promise<void> {
    if (this.refreshing) return
    this.refreshing = true
    try {
      const live = await this.rates.getNimNgnRate()
      this.lastFailureAt = null
      this.lastFailure = null
      await this.persistQuietly({
        asset: 'NIM',
        quoteCurrency: 'NGN',
        rate: live.rateNgnPerNim,
        source: live.source,
        observedAt: live.observedAt,
      })
    } catch (error) {
      this.lastFailureAt = this.now()
      this.lastFailure = error
      console.info('Munus market rate refresh retryable', {
        cause: error instanceof Error ? error.message : 'unknown upstream error',
        upstreamStatus: error instanceof NimRateError ? (error.upstream?.status ?? null) : null,
        upstreamShape: error instanceof NimRateError ? (error.upstream?.shape ?? null) : null,
        retryAfterMs: error instanceof NimRateError ? (error.upstream?.retryAfterMs ?? null) : null,
      })
    } finally {
      this.refreshing = false
    }
  }
}
