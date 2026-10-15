// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  COIN_GECKO_SIMPLE_PRICE_URL,
  CoinGeckoNimRateProvider,
  expandExponent,
  NIM_RATE_SOURCE_COIN_GECKO,
  normalizeRate,
  NimRateError,
} from './nimRates'

describe('NIM rate provider', () => {
  it('normalizes a real CoinGecko nimiq-2/NGN response', async () => {
    const fetchJson = vi.fn(async () => ({ 'nimiq-2': { ngn: 2431.27 } }))
    const provider = new CoinGeckoNimRateProvider(fetchJson, () => '2026-10-14T00:00:00.000Z')

    const rate = await provider.getNimNgnRate()

    expect(fetchJson).toHaveBeenCalledWith(COIN_GECKO_SIMPLE_PRICE_URL)
    expect(rate).toEqual({
      rateNgnPerNim: '2431.27',
      source: NIM_RATE_SOURCE_COIN_GECKO,
      observedAt: '2026-10-14T00:00:00.000Z',
    })
  })

  it('caches for a minute and never serves stale rates', async () => {
    const fetchJson = vi.fn(async () => ({ 'nimiq-2': { ngn: 0.415461 } }))
    let nowMs = Date.parse('2026-10-14T00:00:00.000Z')
    const provider = new CoinGeckoNimRateProvider(fetchJson, () => new Date(nowMs).toISOString())

    const first = await provider.getNimNgnRate()
    expect(first.rateNgnPerNim).toBe('0.415461')
    nowMs += 30_000
    await expect(provider.getNimNgnRate()).resolves.toEqual(first)
    expect(fetchJson).toHaveBeenCalledTimes(1)
    nowMs += 31_000
    await provider.getNimNgnRate()
    expect(fetchJson).toHaveBeenCalledTimes(2)
  })

  it('times out a hung upstream instead of hanging quotes', async () => {
    const fetchJson = vi.fn(() => new Promise(() => {}))
    const provider = new CoinGeckoNimRateProvider(fetchJson, () => new Date().toISOString(), 20)
    await expect(provider.getNimNgnRate()).rejects.toBeInstanceOf(NimRateError)
    expect(fetchJson).toHaveBeenCalledTimes(1)
  })

  it('fails closed without a fabricated fallback rate', async () => {
    const cases: Array<() => Promise<unknown>> = [
      async () => { throw new Error('network down') },
      async () => ({}),
      async () => ({ 'nimiq-2': {} }),
      async () => ({ 'nimiq-2': { ngn: 0 } }),
      async () => ({ 'nimiq-2': { ngn: -5 } }),
      async () => ({ 'nimiq-2': { ngn: 'lots' } }),
      async () => ({ 'bitcoin': { ngn: 1 } }),
      async () => 'not json',
    ]
    for (const fetchJson of cases) {
      const provider = new CoinGeckoNimRateProvider(fetchJson as (url: string) => Promise<unknown>)
      await expect(provider.getNimNgnRate()).rejects.toBeInstanceOf(NimRateError)
    }
    expect(normalizeRate({ 'nimiq-2': { ngn: 100 } })).toBe('100')
    expect(() => normalizeRate({})).toThrow(NimRateError)
  })

  it('expands scientific notation into plain decimal text', () => {
    expect(expandExponent('2431.27')).toBe('2431.27')
    expect(expandExponent('1.2e-7')).toBe('0.00000012')
    expect(expandExponent('1E3')).toBe('1000')
  })
})
