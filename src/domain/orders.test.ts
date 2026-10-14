import { describe, expect, it } from 'vitest'
import {
  buildPaymentMemo,
  calculateQuoteLuna,
  canCreateQuote,
  canPayOrder,
  canStartFulfilment,
  describeFulfilmentStage,
  describeOrderStage,
  formatNimFromLunaBigint,
  fulfilmentStatusForOutcome,
  isFulfilmentTerminal,
  isOrderQuoteAvailable,
  isQuoteFresh,
  type PaymentOrder,
} from './orders'

function draftOrder(overrides: Partial<PaymentOrder> = {}): PaymentOrder {
  return {
    id: 'order-1',
    userId: 'user-a',
    serviceType: 'AIRTIME',
    paymentAsset: 'NIM',
    recipientPhone: '08012345678',
    recipientCountry: 'NG',
    requestedAmount: '1000',
    requestedCurrency: 'NGN',
    paymentStatus: 'DRAFT',
    fulfilmentStatus: 'NOT_STARTED',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('Munus payment order domain', () => {
  it('keeps a fresh draft unpayable with a truthful stage description', () => {
    const order = draftOrder()

    expect(canPayOrder(order)).toBe(false)
    expect(isOrderQuoteAvailable(order)).toBe(false)
    expect(describeOrderStage(order)).toBe('Order saved · payment quote not created yet.')
    expect(describeFulfilmentStage(order.fulfilmentStatus)).toBe('Not sent to a provider yet.')
  })

  it('separates crypto payment state from fulfilment state', () => {
    const paidUnfulfilled = draftOrder({ paymentStatus: 'PAID', fulfilmentStatus: 'NOT_STARTED' })

    expect(describeOrderStage(paidUnfulfilled)).toBe('Paid · waiting for fulfilment.')
    expect(describeOrderStage(draftOrder({ paymentStatus: 'PAID', fulfilmentStatus: 'FULFILLMENT_FAILED' })))
      .toBe('Paid · fulfilment needs recovery.')
    expect(canPayOrder(paidUnfulfilled)).toBe(false)
  })

  it('gates provider fulfilment on PAID orders waiting to start', () => {
    expect(canStartFulfilment(draftOrder())).toBe(false)
    expect(canStartFulfilment(draftOrder({ paymentStatus: 'PAID' }))).toBe(true)
    expect(canStartFulfilment(draftOrder({ paymentStatus: 'PAID', fulfilmentStatus: 'FULFILLING' }))).toBe(false)
    expect(canStartFulfilment(draftOrder({ paymentStatus: 'PAID', serviceType: 'DATA' }))).toBe(false)
    expect(canStartFulfilment(draftOrder({ paymentStatus: 'PAYMENT_FAILED' }))).toBe(false)
  })

  it('maps reconciled provider outcomes without guessing', () => {
    expect(fulfilmentStatusForOutcome('completed')).toBe('DELIVERED')
    expect(fulfilmentStatusForOutcome('failed')).toBe('FULFILLMENT_FAILED')
    expect(fulfilmentStatusForOutcome('unknown')).toBe('RECOVERY_REQUIRED')
    expect(fulfilmentStatusForOutcome('pending')).toBeNull()
    expect(fulfilmentStatusForOutcome('not-found')).toBeNull()
    expect(isFulfilmentTerminal('DELIVERED')).toBe(true)
    expect(isFulfilmentTerminal('FULFILLING')).toBe(false)
    expect(isFulfilmentTerminal('NOT_STARTED')).toBe(false)
  })

  it('requires a live quote before an order can pay', () => {
    const ready = draftOrder({
      paymentStatus: 'READY_FOR_PAYMENT',
      quotedCryptoAmount: '12.5',
      quoteLunaAmount: '1250000',
      quoteExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
    const expired = draftOrder({
      paymentStatus: 'READY_FOR_PAYMENT',
      quotedCryptoAmount: '12.5',
      quoteLunaAmount: '1250000',
      quoteExpiresAt: new Date(Date.now() - 60_000).toISOString(),
    })

    expect(canPayOrder(ready)).toBe(true)
    expect(canPayOrder(expired)).toBe(false)
    expect(canPayOrder({ ...ready, paymentStatus: 'DRAFT' })).toBe(false)
    expect(canPayOrder({ ...ready, quoteLunaAmount: undefined })).toBe(false)
  })

  it('converts NGN to luna with integer math, rounding up', () => {
    // Exact division stays exact: ₦1000 at ₦2000/NIM = 0.5 NIM = 50,000 luna.
    expect(calculateQuoteLuna('1000', '2000')).toBe(50_000n)
    // Fractional luna rounds UP so truncation never underpays the receiver.
    expect(calculateQuoteLuna('1000', '2431.27')).toBe(41_131n)
    expect(calculateQuoteLuna('1000', '2431.27') * 2431_27n).toBeGreaterThanOrEqual(1000_00n * 100_000n)
    expect(formatNimFromLunaBigint(50_000n)).toBe('0.5')
    expect(formatNimFromLunaBigint(100_000n)).toBe('1')
    expect(formatNimFromLunaBigint(41_131n)).toBe('0.41131')
    expect(() => calculateQuoteLuna('1000', '0')).toThrow()
    expect(() => calculateQuoteLuna('0', '2000')).toThrow()
    expect(() => calculateQuoteLuna('abc', '2000')).toThrow()
  })

  it('binds a deterministic compact memo to the order id', () => {
    expect(buildPaymentMemo('123e4567-e89b-12d3-a456-426614174000')).toBe('MNS:123e4567e89b')
    expect(buildPaymentMemo('123e4567-e89b-12d3-a456-426614174000'))
      .toBe(buildPaymentMemo('123E4567-E89B-12D3-A456-426614174000'))
    expect(() => buildPaymentMemo('short')).toThrow()
  })

  it('gates quoting on airtime NIM drafts and fresh quotes', () => {
    expect(canCreateQuote(draftOrder())).toBe(true)
    expect(canCreateQuote(draftOrder({ paymentStatus: 'READY_FOR_PAYMENT' }))).toBe(true)
    expect(canCreateQuote(draftOrder({ paymentStatus: 'PAID' }))).toBe(false)
    expect(canCreateQuote(draftOrder({ serviceType: 'DATA' }))).toBe(false)
    expect(canCreateQuote(draftOrder({ paymentAsset: 'USDT' }))).toBe(false)
    const fresh = draftOrder({
      quotedCryptoAmount: '0.5',
      quoteLunaAmount: '50000',
      quoteExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
    const stale = draftOrder({
      quotedCryptoAmount: '0.5',
      quoteLunaAmount: '50000',
      quoteExpiresAt: new Date(Date.now() - 1_000).toISOString(),
    })
    expect(isQuoteFresh(fresh)).toBe(true)
    expect(isQuoteFresh(stale)).toBe(false)
    expect(isQuoteFresh(draftOrder())).toBe(false)
  })
})
