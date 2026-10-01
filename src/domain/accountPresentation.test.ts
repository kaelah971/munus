import { describe, expect, it } from 'vitest'
import { estimateNgn, getNgnQuote, mapNimBalance, readUsdtBalance, type AssetBalanceResult, type NgnQuoteResult } from './accountPresentation'

const balance: AssetBalanceResult = { status: 'available', asset: 'NIM', amount: '123456789.12345', network: 'mainnet', environment: 'mainnet', observedAt: 1000 }
const quote: NgnQuoteResult = { status: 'available', asset: 'NIM', network: 'mainnet', ngnPerUnit: '0.123456789', source: 'Test quote', asOf: 900, expiresAt: 2000 }

describe('account presentation data boundaries', () => {
  it('preserves a real NIM zero and refuses invalid decimal values', () => {
    expect(mapNimBalance({ status: 'zero', nimBalance: '0', network: 'mainnet' })).toMatchObject({ status: 'available', amount: '0' })
    expect(mapNimBalance({ status: 'available', nimBalance: 'NaN', network: 'mainnet' }).status).toBe('error')
    expect(mapNimBalance({ status: 'loading', network: 'unknown' }).status).toBe('loading')
    expect(mapNimBalance({ status: 'unavailable', network: 'unknown' }).status).toBe('unavailable')
  })

  it('keeps production USDT and NGN adapters unavailable', async () => {
    expect(await readUsdtBalance(undefined, new AbortController().signal)).toMatchObject({ status: 'unavailable', asset: 'USDT' })
    expect(await getNgnQuote('NIM', 'mainnet', new AbortController().signal)).toEqual({ status: 'unavailable' })
  })

  it('multiplies decimal strings exactly and rounds only the final NGN amount', () => {
    expect(estimateNgn(balance, quote, 1000)).toBe('15241578.77')
    expect(estimateNgn({ ...balance, amount: '0.1' }, { ...quote, ngnPerUnit: '0.05' }, 1000)).toBe('0.01')
    expect(estimateNgn({ ...balance, amount: '0' }, quote, 1000)).toBe('0.00')
  })

  it('rejects expired, future, malformed, mismatched and testnet quotes', () => {
    expect(estimateNgn(balance, { ...quote, expiresAt: 1000 }, 1000)).toBeNull()
    expect(estimateNgn(balance, { ...quote, asOf: 1100 }, 1000)).toBeNull()
    expect(estimateNgn(balance, { ...quote, ngnPerUnit: '-1' }, 1000)).toBeNull()
    expect(estimateNgn(balance, { ...quote, network: 'testnet' }, 1000)).toBeNull()
    expect(estimateNgn(balance, { ...quote, asset: 'USDT' }, 1000)).toBeNull()
    expect(estimateNgn({ ...balance, environment: 'testnet' }, quote, 1000)).toBeNull()
  })
})
