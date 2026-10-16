import { describe, expect, it } from 'vitest'
import { buildAggregateFundingView, buildFundingPreview, estimateNimFromNgn, nimBalanceForEstimate } from './funding'
import type { AssetBalanceResult, NgnQuoteResult } from './accountPresentation'

describe('funding preview math', () => {
  it('computes exact remainders in integer luna', () => {
    const preview = buildFundingPreview('22100000', '221', '50500', '0.505')
    expect(preview).toEqual({
      quoteNim: '0.505',
      quoteLuna: '50500',
      balanceNim: '221',
      balanceLuna: '22100000',
      sufficient: true,
      remainingNim: '220.495',
      shortfallNim: null,
    })
  })

  it('computes exact shortfalls without blocking semantics', () => {
    const preview = buildFundingPreview('10000', '0.1', '50500', '0.505')
    expect(preview).toMatchObject({
      sufficient: false,
      remainingNim: null,
      shortfallNim: '0.405',
    })
  })

  it('handles exact-spend and zero-quote edges', () => {
    const exact = buildFundingPreview('50500', '0.505', '50500', '0.505')
    expect(exact).toMatchObject({ sufficient: true, remainingNim: '0' })
    expect(buildFundingPreview('50500', '0.505', '0', '0')).toBeNull()
  })

  it('renders the production aggregate with full precision and no suffixes', () => {
    const view = buildAggregateFundingView({ nim: '221.005', estimateNgn: '442010.00', network: 'mainnet' })
    expect(view).toMatchObject({
      amountText: '221.005',
      estimateText: '≈ ₦442010.00',
      statusText: 'Available in Nimiq Pay',
      networkText: 'Mainnet',
      networkProvenance: 'aggregate',
      accountHint: null,
    })
    expect(view.amountText).not.toBe('221.00')
    expect(view.amountText).not.toBe('221.01')
    const withoutEstimate = buildAggregateFundingView({ nim: '221.005', estimateNgn: null, network: 'mainnet' })
    expect(withoutEstimate.estimateText).toBe('NGN estimate unavailable')
  })

  it('attributes confirmed balances to the resolved network for estimates only', () => {
    const balance: AssetBalanceResult = {
      status: 'available', asset: 'NIM', amount: '12.5',
      network: 'unknown', environment: 'unknown', observedAt: 1,
    }
    const quote: NgnQuoteResult = {
      status: 'available', asset: 'NIM', network: 'mainnet',
      ngnPerUnit: '10', source: 'Fixture', asOf: 0, expiresAt: 1,
    }
    const attributed = nimBalanceForEstimate(balance, quote, 'mainnet')
    expect(attributed).toMatchObject({ network: 'mainnet', environment: 'mainnet', amount: '12.5' })
    // Untouched when already matching, unresolved, or not available.
    const matching = { ...balance, network: 'mainnet' }
    expect(nimBalanceForEstimate(matching, quote, 'mainnet')).toBe(matching)
    expect(nimBalanceForEstimate(balance, quote, 'unknown')).toBe(balance)
    expect(nimBalanceForEstimate(balance, { status: 'unavailable' }, 'mainnet')).toBe(balance)
    expect(nimBalanceForEstimate({ status: 'unavailable', asset: 'NIM' }, quote, 'mainnet').status).toBe('unavailable')
  })

  it('estimates NIM from NGN with exact decimal division', () => {
    expect(estimateNimFromNgn('50', '0.415461')).toEqual({ nim: '120.34824', luna: '12034824' })
    expect(estimateNimFromNgn('100', '0.415461')).toEqual({ nim: '240.69648', luna: '24069648' })
    expect(estimateNimFromNgn('1000', '2000')).toEqual({ nim: '0.5', luna: '50000' })
    // The estimate luna never exceeds the authoritative ceil.
    expect(BigInt(estimateNimFromNgn('100', '0.415461')?.luna ?? '0')).toBe(24069648n)
    expect(estimateNimFromNgn('', '2000')).toBeNull()
    expect(estimateNimFromNgn('abc', '2000')).toBeNull()
    expect(estimateNimFromNgn('-5', '2000')).toBeNull()
    expect(estimateNimFromNgn('0', '2000')).toBeNull()
    expect(estimateNimFromNgn('100', '0')).toBeNull()
    expect(estimateNimFromNgn('100', 'nope')).toBeNull()
  })

  it('refuses to preview on malformed input', () => {
    expect(buildFundingPreview('abc', '221', '50500', '0.505')).toBeNull()
    expect(buildFundingPreview('22100000', '221', '50.5', '0.505')).toBeNull()
    expect(buildFundingPreview('22100000', '', '50500', '0.505')).toBeNull()
    expect(buildFundingPreview('-5', '-5', '50500', '0.505')).toBeNull()
  })
})
