export const NIM_RATE_SOURCE_COIN_GECKO = 'coingecko:nimiq-2/ngn'
export const COIN_GECKO_SIMPLE_PRICE_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=nimiq-2&vs_currencies=ngn'
/** Identifies Munus to the upstream edge; datacenter egress without a
 *  real User-Agent is challenged more often. Public contact only. */
export const NIM_RATE_USER_AGENT = 'Munus/1.0 (+https://munus-public-beta.onrender.com)'

export interface NimRate {
  /** NGN per 1 NIM, exact decimal string (never a float). */
  rateNgnPerNim: string
  source: string
  observedAt: string
}

export interface NimRateProvider {
  getNimNgnRate(): Promise<NimRate>
  /** True when the most recent successful call was served from the short
   *  instance cache without contacting upstream. Absent for providers
   *  that do not cache. */
  readonly lastServedFromCache?: boolean
}

/** Server-side-only upstream diagnostics. Never sent to clients; the
 *  client-facing message stays generic while operators get the exact
 *  status/latency/shape in logs. */
export interface NimRateUpstreamDiagnostic {
  /** HTTP status when a response arrived; null on transport failure. */
  status: number | null
  latencyMs: number
  shape: 'ok' | 'http-error' | 'non-json' | 'unexpected-shape' | 'transport-error' | 'timeout'
  /** Parsed Retry-After hint on 429, when present. */
  retryAfterMs: number | null
}

export type RateFetchJson = (url: string) => Promise<unknown>

export class NimRateError extends Error {
  readonly statusCode: number
  readonly upstream: NimRateUpstreamDiagnostic | undefined
  constructor(message: string, statusCode = 502, upstream?: NimRateUpstreamDiagnostic) {
    super(message)
    this.name = 'NimRateError'
    this.statusCode = statusCode
    this.upstream = upstream
  }
}

export class NimRateTimeoutError extends NimRateError {
  constructor(upstream?: NimRateUpstreamDiagnostic) {
    super('Live NIM rate is unavailable: upstream timed out. No quote was created.', 502, upstream)
    this.name = 'NimRateTimeoutError'
  }
}

/** Short instance cache: one upstream call per minute across all callers. */
export const NIM_RATE_CACHE_TTL_MS = 60_000
/** Upstream fetch budget: a hung CoinGecko must fail closed, not hang quotes. */
export const NIM_RATE_FETCH_TIMEOUT_MS = 15_000

/**
 * Live NIM/NGN rate from CoinGecko (`nimiq-2`). Fails closed: any transport,
 * shape, or sanity problem surfaces as an error and the caller must not
 * fall back to a fabricated rate. No stale fallback: an expired cache
 * entry is discarded, never served.
 */
export class CoinGeckoNimRateProvider implements NimRateProvider {
  private cached: { rate: NimRate; expiresAtMs: number } | null = null
  readonly lastServedFromCache: boolean = false

  constructor(
    private readonly fetchJson: RateFetchJson = createCoinGeckoFetch(),
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly timeoutMs: number = NIM_RATE_FETCH_TIMEOUT_MS,
  ) {}

  async getNimNgnRate(): Promise<NimRate> {
    const nowMs = Date.parse(this.now())
    if (this.cached && Number.isFinite(nowMs) && nowMs < this.cached.expiresAtMs) {
      ;(this as { lastServedFromCache: boolean }).lastServedFromCache = true
      return this.cached.rate
    }
    ;(this as { lastServedFromCache: boolean }).lastServedFromCache = false
    const startedAt = Date.now()
    let payload: unknown
    try {
      payload = await withTimeout(this.fetchJson(COIN_GECKO_SIMPLE_PRICE_URL), this.timeoutMs)
    } catch (error) {
      if (error instanceof NimRateError) throw error
      const timeout = error instanceof NimRateTimeoutError
      throw timeout
        ? error
        : new NimRateError('Live NIM rate is unavailable. No quote was created.', 502, {
          status: null,
          latencyMs: Date.now() - startedAt,
          shape: 'transport-error',
          retryAfterMs: null,
        })
    }
    let rate: string
    try {
      rate = normalizeRate(payload)
    } catch (error) {
      if (error instanceof NimRateError && !error.upstream) {
        throw new NimRateError(error.message, error.statusCode, {
          status: null,
          latencyMs: Date.now() - startedAt,
          shape: 'unexpected-shape',
          retryAfterMs: null,
        })
      }
      throw error
    }
    const observed = { rateNgnPerNim: rate, source: NIM_RATE_SOURCE_COIN_GECKO, observedAt: this.now() }
    const observedMs = Date.parse(observed.observedAt)
    if (Number.isFinite(observedMs)) {
      this.cached = { rate: observed, expiresAtMs: observedMs + NIM_RATE_CACHE_TTL_MS }
    }
    return observed
  }
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await new Promise<T>((resolve, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new NimRateTimeoutError({
              status: null,
              latencyMs: timeoutMs,
              shape: 'timeout',
              retryAfterMs: null,
            }),
          ),
        timeoutMs,
      )
      work.then(resolve, reject)
    })
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Optional CoinGecko demo API key. Unset in most environments; when an
 *  operator configures MUNUS_COINGECKO_API_KEY (free demo key), requests
 *  carry x-cg-demo-api-key so shared-datacenter egress is not treated as
 *  anonymous bulk traffic. Never logged, never sent to clients. */
function readCoinGeckoApiKey(): string | undefined {
  const raw = process.env.MUNUS_COINGECKO_API_KEY?.trim()
  return raw ? raw : undefined
}

/** Default upstream fetch with real headers, an aborting timeout, and
 *  structured diagnostics on every failure path. */
function createCoinGeckoFetch(apiKey: string | undefined = readCoinGeckoApiKey()): RateFetchJson {
  return async (url: string): Promise<unknown> => {
    const startedAt = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), NIM_RATE_FETCH_TIMEOUT_MS)
    try {
      const headers: Record<string, string> = {
        accept: 'application/json',
        'user-agent': NIM_RATE_USER_AGENT,
      }
      if (apiKey) headers['x-cg-demo-api-key'] = apiKey
      let response: Response
      try {
        response = await fetch(url, { headers, signal: controller.signal })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          throw new NimRateTimeoutError({
            status: null,
            latencyMs: Date.now() - startedAt,
            shape: 'timeout',
            retryAfterMs: null,
          })
        }
        throw new NimRateError('Live NIM rate is unavailable. No quote was created.', 502, {
          status: null,
          latencyMs: Date.now() - startedAt,
          shape: 'transport-error',
          retryAfterMs: null,
        })
      }
      const latencyMs = Date.now() - startedAt
      if (!response.ok) {
        throw new NimRateError('Live NIM rate is unavailable. No quote was created.', 502, {
          status: response.status,
          latencyMs,
          shape: 'http-error',
          retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
        })
      }
      try {
        return (await response.json()) as unknown
      } catch {
        throw new NimRateError('Live NIM rate is unavailable. No quote was created.', 502, {
          status: response.status,
          latencyMs,
          shape: 'non-json',
          retryAfterMs: null,
        })
      }
    } finally {
      clearTimeout(timer)
    }
  }
}

/** Parses seconds- or HTTP-date Retry-After into milliseconds. */
function parseRetryAfter(value: string | null): number | null {
  if (!value) return null
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10)
    if (Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 3_600) return seconds * 1_000
    return null
  }
  const when = Date.parse(trimmed)
  if (!Number.isFinite(when)) return null
  const delta = when - Date.now()
  if (!Number.isFinite(delta) || delta < 0 || delta > 3_600_000) return null
  return delta
}

export function normalizeRate(payload: unknown): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new NimRateError('Live NIM rate is unavailable. No quote was created.')
  }
  const entry = (payload as Record<string, unknown>)['nimiq-2']
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new NimRateError('Live NIM rate is unavailable. No quote was created.')
  }
  const ngn = (entry as Record<string, unknown>).ngn
  if (typeof ngn !== 'number' || !Number.isFinite(ngn) || ngn <= 0) {
    throw new NimRateError('Live NIM rate is unavailable. No quote was created.')
  }
  // Round-trip through decimal text so the stored rate is exact decimal,
  // never binary floating point.
  const text = String(ngn)
  if (!/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text)) {
    throw new NimRateError('Live NIM rate is unavailable. No quote was created.')
  }
  return expandExponent(text)
}

/** Expands scientific notation (e.g. `1.2e-7`) into plain decimal text. */
export function expandExponent(text: string): string {
  const match = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text)
  if (!match) throw new NimRateError('Live NIM rate is unavailable. No quote was created.')
  const [, whole, fraction = '', exponentText] = match
  const exponent = exponentText === undefined ? 0 : Number.parseInt(exponentText, 10)
  if (!Number.isSafeInteger(exponent)) throw new NimRateError('Live NIM rate is unavailable. No quote was created.')
  const digits = `${whole}${fraction}`
  const point = whole.length + exponent
  if (point <= 0) return `0.${'0'.repeat(-point)}${digits}`
  if (point >= digits.length) return `${digits}${'0'.repeat(point - digits.length)}`
  return `${digits.slice(0, point)}.${digits.slice(point)}`
}
