import { describe, expect, it } from 'vitest'
import { buildAggregateFundingView, buildFundingPreview } from './funding'

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

  it('refuses to preview on malformed input', () => {
    expect(buildFundingPreview('abc', '221', '50500', '0.505')).toBeNull()
    expect(buildFundingPreview('22100000', '221', '50.5', '0.505')).toBeNull()
    expect(buildFundingPreview('22100000', '', '50500', '0.505')).toBeNull()
    expect(buildFundingPreview('-5', '-5', '50500', '0.505')).toBeNull()
  })
})
