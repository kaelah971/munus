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

/**
 * Live NIM/NGN rate from CoinGecko (`nimiq-2`). Fails closed: any transport,
 * shape, or sanity problem surfaces as an error and the caller must not
 * fall back to a fabricated rate.
 */
export class CoinGeckoNimRateProvider implements NimRateProvider {
  constructor(
    private readonly fetchJson: RateFetchJson = defaultFetchJson,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async getNimNgnRate(): Promise<NimRate> {
    let payload: unknown
    try {
      payload = await this.fetchJson(COIN_GECKO_SIMPLE_PRICE_URL)
    } catch {
      throw new NimRateError('Live NIM rate is unavailable. No quote was created.')
    }
    const rate = normalizeRate(payload)
    return { rateNgnPerNim: rate, source: NIM_RATE_SOURCE_COIN_GECKO, observedAt: this.now() }
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
