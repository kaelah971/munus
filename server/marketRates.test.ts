// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  INFORMATIVE_RATE_MAX_AGE_MS,
  InformativeRateService,
  InMemoryMarketRateStore,
  PostgresMarketRateStore,
} from './marketRates'
import { NimRateError, type NimRateProvider } from './nimRates'
import type { DatabasePool } from './database'

const NOW = Date.parse('2026-10-16T12:00:00.000Z')
const iso = (ms: number) => new Date(ms).toISOString()

function fixtureRates(rate = '0.410829', observedAt = iso(NOW)): NimRateProvider & { calls: number; fail?: unknown } {
  const provider = {
    calls: 0,
    fail: undefined as unknown,
    async getNimNgnRate() {
      provider.calls += 1
      if (provider.fail) throw provider.fail
      return { rateNgnPerNim: rate, source: 'fixture', observedAt }
    },
  }
  return provider
}

function setup(options: {
  rate?: string
  observedAt?: string
  fail?: unknown
  seed?: { rate: string; observedAt: string }
  maxAgeMs?: number
  failureCooldownMs?: number
  refreshIntervalMs?: number
  now?: number
} = {}) {
  const rates = fixtureRates(options.rate, options.observedAt)
  if (options.fail) rates.fail = options.fail
  const store = new InMemoryMarketRateStore()
  const service = new InformativeRateService({
    rates,
    store,
    quoteTtlMs: 120_000,
    maxAgeMs: options.maxAgeMs,
    failureCooldownMs: options.failureCooldownMs,
    refreshIntervalMs: options.refreshIntervalMs,
    now: () => options.now ?? NOW,
  })
  if (options.seed) {
    return { service, rates, store, seed: store.writeRate({ asset: 'NIM', quoteCurrency: 'NGN', rate: options.seed.rate, source: 'fixture', observedAt: options.seed.observedAt }) }
  }
  return { service, rates, store }
}

describe('informative NIM/NGN market rates', () => {
  it('serves a fresh upstream rate and persists the exact observation', async () => {
    const { service, rates, store } = setup()
    const outcome = await service.getRateDetailed()
    expect(outcome.rate).toMatchObject({
      ngnPerNim: '0.410829',
      asOf: iso(NOW),
      source: 'fixture',
      freshness: 'fresh',
    })
    expect(outcome.trace).toMatchObject({ upstream: 'success', durable: 'unused' })
    expect(rates.calls).toBe(1)
    // Persisted verbatim: same rate, same source, same observed_at.
    await expect(store.readRate('NIM', 'NGN')).resolves.toMatchObject({
      asset: 'NIM',
      quoteCurrency: 'NGN',
      rate: '0.410829',
      source: 'fixture',
      observedAt: iso(NOW),
    })
  })

  it('serves a recent durable rate after a cold start without upstream contact', async () => {
    const seedObservedAt = iso(NOW - 10 * 60_000)
    const rates = fixtureRates()
    rates.fail = new Error('upstream down')
    const seeded = new InMemoryMarketRateStore()
    await seeded.writeRate({ asset: 'NIM', quoteCurrency: 'NGN', rate: '0.410829', source: 'fixture', observedAt: seedObservedAt })
    const cold = new InformativeRateService({ rates, store: seeded, quoteTtlMs: 120_000, now: () => NOW })
    const outcome = await cold.getRateDetailed()
    expect(outcome.rate).toMatchObject({
      ngnPerNim: '0.410829',
      asOf: seedObservedAt,
      freshness: 'recent',
    })
    // observed_at is never rewritten on read: still the original instant.
    expect(outcome.rate.asOf).toBe(seedObservedAt)
    expect(outcome.trace).toMatchObject({ upstream: 'failure', durable: 'hit' })
  })

  it('fails closed when upstream fails and no recent durable rate exists', async () => {
    const { service } = setup({ fail: new Error('upstream down') })
    await expect(service.getRate()).rejects.toBeInstanceOf(NimRateError)
    // Ancient durable rows never display.
    const ancient = setup({
      fail: new Error('upstream down'),
      seed: { rate: '0.410829', observedAt: iso(NOW - INFORMATIVE_RATE_MAX_AGE_MS - 1_000) },
    })
    await ancient.seed
    await expect(ancient.service.getRate()).rejects.toBeInstanceOf(NimRateError)
  })

  it('keeps one global row per asset pair, never per user', async () => {
    const { store } = setup()
    await store.writeRate({ asset: 'NIM', quoteCurrency: 'NGN', rate: '0.41', source: 'a', observedAt: iso(NOW) })
    await store.writeRate({ asset: 'NIM', quoteCurrency: 'NGN', rate: '0.42', source: 'b', observedAt: iso(NOW + 1_000) })
    await expect(store.readRate('NIM', 'NGN')).resolves.toMatchObject({ rate: '0.42', source: 'b' })
    await expect(store.readRate('NIM', 'USD')).resolves.toBeNull()
  })

  it('rejects malformed rows instead of persisting or serving them', async () => {
    const { store, service } = setup({ fail: new Error('down') })
    await expect(store.writeRate({ asset: 'NIM', quoteCurrency: 'NGN', rate: 'abc', source: 'x', observedAt: iso(NOW) })).rejects.toThrow()
    await expect(store.writeRate({ asset: 'NIM', quoteCurrency: 'NGN', rate: '-5', source: 'x', observedAt: iso(NOW) })).rejects.toThrow()
    await expect(store.writeRate({ asset: 'NIM', quoteCurrency: 'NGN', rate: '0', source: 'x', observedAt: iso(NOW) })).rejects.toThrow()
    await expect(service.getRate()).rejects.toBeInstanceOf(NimRateError)
  })

  it('skips upstream within the failure cooldown and still serves durable data', async () => {
    const seedObservedAt = iso(NOW - 60_000)
    const seeded = new InMemoryMarketRateStore()
    await seeded.writeRate({ asset: 'NIM', quoteCurrency: 'NGN', rate: '0.41', source: 'fixture', observedAt: seedObservedAt })
    const rates = fixtureRates()
    rates.fail = new Error('upstream down')
    const service = new InformativeRateService({
      rates, store: seeded, quoteTtlMs: 120_000, now: () => NOW, failureCooldownMs: 60_000,
    })
    const first = await service.getRateDetailed()
    expect(first.trace).toMatchObject({ upstream: 'failure', durable: 'hit' })
    expect(rates.calls).toBe(1)
    const second = await service.getRateDetailed()
    expect(second.trace).toMatchObject({ upstream: 'skipped-cooldown', durable: 'hit' })
    expect(rates.calls).toBe(1)
    expect(second.rate.asOf).toBe(seedObservedAt)
  })

  it('does not fail a healthy rate when persistence hiccups', async () => {
    const { service, rates } = setup()
    const failingStore = {
      readRate: async () => null,
      writeRate: async () => { throw new Error('disk full') },
    }
    const resilient = new InformativeRateService({ rates, store: failingStore, quoteTtlMs: 120_000, now: () => NOW })
    const outcome = await resilient.getRateDetailed()
    expect(outcome.rate.ngnPerNim).toBe('0.410829')
    expect(outcome.trace.upstream).toBe('success')
    void service
  })

  it('refreshes in the background on start without blocking callers', async () => {
    const rates = fixtureRates()
    const store = new InMemoryMarketRateStore()
    const service = new InformativeRateService({
      rates, store, quoteTtlMs: 120_000, now: () => NOW, refreshIntervalMs: 60_000,
    })
    service.start()
    await vi.waitFor(() => expect(rates.calls).toBeGreaterThanOrEqual(1))
    await expect(store.readRate('NIM', 'NGN')).resolves.toMatchObject({ rate: '0.410829' })
    service.stop()
  })

  it('reports memory/durable/upstream verdicts in every trace', async () => {
    const { service } = setup()
    const outcome = await service.getRateDetailed()
    expect(outcome.trace).toMatchObject({
      upstream: 'success',
      upstreamAttempted: true,
      upstreamStatus: null,
      memory: 'miss',
      durable: 'unused',
      durableAgeMs: null,
    })
  })

  it('reports durable age and upstream status when falling back', async () => {
    const seedObservedAt = iso(NOW - 5 * 60_000)
    const seeded = new InMemoryMarketRateStore()
    await seeded.writeRate({ asset: 'NIM', quoteCurrency: 'NGN', rate: '0.41', source: 'fixture', observedAt: seedObservedAt })
    const rates = fixtureRates()
    rates.fail = new NimRateError('Live NIM rate is unavailable.', 502, {
      status: 429,
      latencyMs: 12,
      shape: 'http-error',
      retryAfterMs: null,
    })
    const service = new InformativeRateService({ rates, store: seeded, quoteTtlMs: 120_000, now: () => NOW })
    const outcome = await service.getRateDetailed()
    expect(outcome.trace).toMatchObject({
      upstream: 'failure',
      upstreamAttempted: true,
      upstreamStatus: 429,
      memory: 'miss',
      durable: 'hit',
      durableAgeMs: 5 * 60_000,
      freshness: 'recent',
    })
  })

  it('recovers in the background after a failure without a permanent lock', async () => {
    const rates = fixtureRates()
    rates.fail = new Error('upstream down')
    const store = new InMemoryMarketRateStore()
    const logged: unknown[][] = []
    const info = console.info
    console.info = (...args: unknown[]) => { logged.push(args) }
    try {
      const service = new InformativeRateService({
        rates, store, quoteTtlMs: 120_000, now: () => NOW, refreshIntervalMs: 15,
      })
      service.start()
      await vi.waitFor(() => expect(rates.calls).toBeGreaterThanOrEqual(1))
      service.stop()
      // A failed startup refresh leaves no row but must not wedge the loop.
      await expect(store.readRate('NIM', 'NGN')).resolves.toBeNull()
      rates.fail = undefined
      const retry = new InformativeRateService({
        rates, store, quoteTtlMs: 120_000, now: () => NOW, refreshIntervalMs: 15,
      })
      retry.start()
      await vi.waitFor(() => expect(rates.calls).toBeGreaterThanOrEqual(2))
      retry.stop()
      await expect(store.readRate('NIM', 'NGN')).resolves.toMatchObject({ rate: '0.410829' })
      expect(logged.some((args) => args[0] === 'NIM/NGN market rate persisted')).toBe(true)
    } finally {
      console.info = info
    }
  })

  it('logs every successful market-rate upsert explicitly', async () => {
    const logged: unknown[][] = []
    const info = console.info
    console.info = (...args: unknown[]) => { logged.push(args) }
    try {
      const { service } = setup()
      await service.getRateDetailed()
      const persisted = logged.find((args) => args[0] === 'NIM/NGN market rate persisted')
      expect(persisted?.[1]).toMatchObject({ rate: '0.410829', observedAt: iso(NOW) })
    } finally {
      console.info = info
    }
  })
})

describe('Postgres market rate store', () => {
  function fakePool(handler: (text: string, values: unknown[]) => Record<string, unknown>[]): DatabasePool {
    return {
      query: <Row,>(text: string, values?: unknown[]) => (async () => ({
        rows: handler(text, values ?? []) as Row[],
        rowCount: 1,
      }))(),
      connect: async () => { throw new Error('no transactions in fixture') },
      end: async () => undefined,
    }
  }

  it('upserts and reads with parameterized asset keys and exact numerics', async () => {
    const seen: Array<{ text: string; values: unknown[] }> = []
    const pool = fakePool((text, values) => {
      seen.push({ text, values })
      if (text.startsWith('SELECT')) {
        return [{ asset: 'NIM', quote_currency: 'NGN', rate: '0.410829', source: 'coingecko:nimiq-2/ngn', observed_at: new Date(NOW - 60_000) }]
      }
      return []
    })
    const store = new PostgresMarketRateStore(pool)
    await store.writeRate({ asset: 'NIM', quoteCurrency: 'NGN', rate: '0.410829', source: 'coingecko:nimiq-2/ngn', observedAt: iso(NOW - 60_000) })
    const upsert = seen.find((call) => call.text.includes('INSERT'))
    expect(upsert?.text).toContain('ON CONFLICT (asset, quote_currency)')
    expect(upsert?.values).toEqual(['NIM', 'NGN', '0.410829', 'coingecko:nimiq-2/ngn', iso(NOW - 60_000)])
    await expect(store.readRate('NIM', 'NGN')).resolves.toMatchObject({
      asset: 'NIM',
      quoteCurrency: 'NGN',
      rate: '0.410829',
      observedAt: iso(NOW - 60_000),
    })
    // observed_at arrives as a Date from pg and is normalized, not rewritten.
    const select = seen.find((call) => call.text.startsWith('SELECT'))
    expect(select?.values).toEqual(['NIM', 'NGN'])
  })

  it('treats missing or corrupt rows as a miss and wraps transport errors', async () => {
    const empty = fakePool(() => [])
    await expect(new PostgresMarketRateStore(empty).readRate('NIM', 'NGN')).resolves.toBeNull()
    const corrupt = fakePool(() => [{ asset: 'NIM', quote_currency: 'NGN', rate: 'bogus', source: '', observed_at: new Date(NOW) }])
    await expect(new PostgresMarketRateStore(corrupt).readRate('NIM', 'NGN')).resolves.toBeNull()
    const down = fakePool(() => { throw new Error('connection reset') })
    await expect(new PostgresMarketRateStore(down).readRate('NIM', 'NGN')).rejects.toThrow(/Could not load market rate/)
    await expect(new PostgresMarketRateStore(down).writeRate({
      asset: 'NIM', quoteCurrency: 'NGN', rate: '0.41', source: 'x', observedAt: iso(NOW),
    })).rejects.toThrow(/Could not persist market rate/)
  })
})
