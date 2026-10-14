// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  assertSupportedNetwork,
  ClubKonnectDataCatalog,
  DATA_CATALOG_TTL_MS,
  normalizeNetworks,
  normalizePlans,
  resolveDataPlanForOrder,
} from './dataCatalog'
import { ClubKonnectError } from './clubKonnect'

const credentials = { userId: 'fixture-user', apiKey: 'fixture-key' }

function catalog(fetchJson: (url: string) => Promise<unknown>, now = { at: 0 }) {
  return new ClubKonnectDataCatalog({
    credentials,
    fetchJson,
    now: () => now.at,
  })
}

describe('data bundle catalog', () => {
  it('normalizes provider networks to Munus network names', () => {
    expect(normalizeNetworks([
      { network: 'MTN', code: '01' },
      { name: 'Glo', networkCode: '02' },
      { networkName: 'T2mobile', id: '03' },
      { network: 'Airtel' },
      { network: 'UnknownNet', code: '99' },
      'garbage',
    ])).toEqual([
      { network: 'MTN', label: 'MTN' },
      { network: 'Glo', label: 'Glo' },
      { network: '9mobile', label: 'T2mobile' },
      { network: 'Airtel', label: 'Airtel' },
    ])
  })

  it('normalizes plans with exact ids, original labels, and safe prices', () => {
    const plans = normalizePlans('MTN', [
      { planId: 'MTN-15', name: '1.5GB - 7 days', price: 350, type: 'corporate' },
      { planID: 'MTN-2', planName: '500MB 30 days', amount: '200' },
      { id: 'MTN-3', description: 'Mystery bundle', price: '₦1,000' },
      { planId: 'MTN-4', name: 'Freebie', price: 0 },
      { name: 'No id bundle', price: 100 },
      { planId: 'MTN-5', name: 'Priceless', price: 'soon' },
      { planId: 'MTN-6', name: 'Gone', price: 100, available: false },
    ])

    expect(plans).toEqual([
      {
        providerPlanId: 'MTN-15',
        network: 'MTN',
        displayName: '1.5GB - 7 days',
        dataAllowance: '1.5 GB',
        validity: '7 days',
        planType: 'corporate',
        localPriceNgn: '350',
        available: true,
        provider: 'clubkonnect',
      },
      {
        providerPlanId: 'MTN-2',
        network: 'MTN',
        displayName: '500MB 30 days',
        dataAllowance: '500 MB',
        validity: '30 days',
        planType: undefined,
        localPriceNgn: '200',
        available: true,
        provider: 'clubkonnect',
      },
      {
        providerPlanId: 'MTN-3',
        network: 'MTN',
        displayName: 'Mystery bundle',
        dataAllowance: undefined,
        validity: undefined,
        planType: undefined,
        localPriceNgn: '1000',
        available: true,
        provider: 'clubkonnect',
      },
    ])
  })

  it('keeps structured allowance and validity over label guesses', () => {
    const [plan] = normalizePlans('Glo', [
      { planId: 'G-1', name: '1GB promo', allowance: '2 GB bonus', validity: '14 days', price: 500 },
    ])
    expect(plan.dataAllowance).toBe('2 GB bonus')
    expect(plan.validity).toBe('14 days')
  })

  it('fetches once per TTL window and fails closed without stale fallbacks', async () => {
    const now = { at: 1_000 }
    const fetchJson = vi.fn(async (url: string) => {
      if (url.includes('NetworkV2')) return [{ network: 'MTN', code: '01' }]
      return [{ planId: 'MTN-15', name: '1.5GB - 7 days', price: 350 }]
    })
    const provider = catalog(fetchJson, now)

    await provider.listNetworks()
    await provider.listNetworks()
    await provider.listPlans('MTN')
    await provider.listPlans('MTN')
    expect(fetchJson).toHaveBeenCalledTimes(2)

    now.at += DATA_CATALOG_TTL_MS
    await provider.listPlans('MTN')
    expect(fetchJson).toHaveBeenCalledTimes(3)

    const failing = catalog(async () => { throw new Error('down') }, now)
    await expect(failing.listPlans('MTN')).rejects.toMatchObject({ statusCode: 502 })
    await expect(failing.listNetworks()).rejects.toMatchObject({ statusCode: 502 })
    const malformed = catalog(async () => ({ ok: true }), now)
    await expect(malformed.listPlans('MTN')).rejects.toBeInstanceOf(ClubKonnectError)
  })

  it('never returns provider secrets in normalized output', async () => {
    const provider = catalog(async () => [{ planId: 'P-1', name: '1GB', price: 300 }])
    const [networks, plans] = await Promise.all([provider.listNetworks(), provider.listPlans('MTN')])
    void networks
    const serialized = JSON.stringify(plans)
    expect(serialized).not.toContain('fixture-user')
    expect(serialized).not.toContain('fixture-key')
  })

  it('refreshes once when a cached plan disappears, then fails closed', async () => {
    const now = { at: 0 }
    let round = 0
    const provider = catalog(async () => {
      round += 1
      return round === 1 ? [{ planId: 'OLD', name: '1GB', price: 300 }] : []
    }, now)
    await expect(resolveDataPlanForOrder(provider, 'MTN', 'OLD')).resolves.toMatchObject({ providerPlanId: 'OLD' })
    now.at += DATA_CATALOG_TTL_MS
    await expect(resolveDataPlanForOrder(provider, 'MTN', 'OLD')).rejects.toMatchObject({ statusCode: 404 })
    expect(round).toBe(3)
  })

  it('validates order networks without guessing', () => {
    expect(assertSupportedNetwork('MTN')).toBe('MTN')
    expect(() => assertSupportedNetwork('Starlink')).toThrow(ClubKonnectError)
    expect(() => assertSupportedNetwork(null)).toThrow(ClubKonnectError)
  })
})
