export const NIM_RATE_SOURCE_COIN_GECKO = 'coingecko:nimiq-2/ngn'
export const COIN_GECKO_SIMPLE_PRICE_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=nimiq-2&vs_currencies=ngn'

export interface NimRate {
  /** NGN per 1 NIM, exact decimal string (never a float). */
  rateNgnPerNim: string
  source: string
  observedAt: string
}

export interface NimRateProvider {
  getNimNgnRate(): Promise<NimRate>
}

export type RateFetchJson = (url: string) => Promise<unknown>

export class NimRateError extends Error {
  constructor(message: string, readonly statusCode = 502) {
    super(message)
    this.name = 'NimRateError'
  }
}

export class NimRateTimeoutError extends NimRateError {
  constructor() {
    super('Live NIM rate is unavailable: upstream timed out. No quote was created.')
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

  constructor(
    private readonly fetchJson: RateFetchJson = defaultFetchJson,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly timeoutMs: number = NIM_RATE_FETCH_TIMEOUT_MS,
  ) {}

  async getNimNgnRate(): Promise<NimRate> {
    const nowMs = Date.parse(this.now())
    if (this.cached && Number.isFinite(nowMs) && nowMs < this.cached.expiresAtMs) {
      return this.cached.rate
    }
    let payload: unknown
    try {
      payload = await withTimeout(this.fetchJson(COIN_GECKO_SIMPLE_PRICE_URL), this.timeoutMs)
    } catch {
      throw new NimRateError('Live NIM rate is unavailable. No quote was created.')
    }
    const rate = normalizeRate(payload)
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
      timer = setTimeout(() => reject(new NimRateTimeoutError()), timeoutMs)
      work.then(resolve, reject)
    })
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
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

async function defaultFetchJson(url: string): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, { headers: { accept: 'application/json' } })
  } catch {
    throw new NimRateError('Live NIM rate is unavailable. No quote was created.')
  }
  if (!response.ok) throw new NimRateError('Live NIM rate is unavailable. No quote was created.')
  try {
    return (await response.json()) as unknown
  } catch {
    throw new NimRateError('Live NIM rate is unavailable. No quote was created.')
  }
}
