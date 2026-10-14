import { describe, expect, it } from 'vitest'
import {
  canPayOrder,
  canStartFulfilment,
  describeFulfilmentStage,
  describeOrderStage,
  fulfilmentStatusForOutcome,
  isFulfilmentTerminal,
  isOrderQuoteAvailable,
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
      quoteExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
    const expired = draftOrder({
      paymentStatus: 'READY_FOR_PAYMENT',
      quotedCryptoAmount: '12.5',
      quoteExpiresAt: new Date(Date.now() - 60_000).toISOString(),
    })

    expect(canPayOrder(ready)).toBe(true)
    expect(canPayOrder(expired)).toBe(false)
    expect(canPayOrder({ ...ready, paymentStatus: 'DRAFT' })).toBe(false)
  })
})
