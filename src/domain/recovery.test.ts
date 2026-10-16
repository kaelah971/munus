import { describe, expect, it } from 'vitest'
import { buildPaymentRecoveryCase, buildRecoveryState, RECOVERY_STALE_MS } from './recovery'
import type { PaymentOrder } from './orders'

function order(overrides: Partial<PaymentOrder> = {}): PaymentOrder {
  return {
    id: 'order-1',
    userId: 'user-a',
    serviceType: 'AIRTIME',
    paymentAsset: 'NIM',
    recipientPhone: '08012345678',
    recipientCountry: 'NG',
    requestedAmount: '1000',
    requestedCurrency: 'NGN',
    paymentStatus: 'PAID',
    fulfilmentStatus: 'NOT_STARTED',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const NOW = Date.parse('2026-06-01T12:00:00.000Z')

describe('recovery cases', () => {
  it('returns no case for resolved or non-paid orders', () => {
    expect(buildRecoveryState(order({ fulfilmentStatus: 'DELIVERED' }), NOW)).toBeNull()
    expect(buildRecoveryState(order({ fulfilmentStatus: 'REFUNDED' }), NOW)).toBeNull()
    expect(buildRecoveryState(order({ fulfilmentStatus: 'RESOLVED' }), NOW)).toBeNull()
    expect(buildRecoveryState(order({ paymentStatus: 'PAYMENT_FAILED', fulfilmentStatus: 'NOT_STARTED' }), NOW)).toBeNull()
    expect(buildRecoveryState(order({ paymentStatus: 'DRAFT', fulfilmentStatus: 'NOT_STARTED' }), NOW)).toBeNull()
    expect(buildRecoveryState(order({ paymentStatus: 'ONCHAIN_PENDING', fulfilmentStatus: 'NOT_STARTED' }), NOW)).toBeNull()
  })

  it('flags failed and ambiguous delivery as retryable', () => {
    const failed = buildRecoveryState(order({ fulfilmentStatus: 'FULFILLMENT_FAILED' }), NOW)
    expect(failed?.kind).toBe('failed')
    expect(failed?.canRefresh).toBe(true)
    expect(failed?.canRetry).toBe(true)
    expect(failed?.title).toBe('Payment confirmed')

    const attention = buildRecoveryState(order({ fulfilmentStatus: 'RECOVERY_REQUIRED' }), NOW)
    expect(attention?.kind).toBe('attention')
    expect(attention?.canRefresh).toBe(true)
    expect(attention?.canRetry).toBe(true)
  })

  it('allows a safe start when delivery never began', () => {
    const started = buildRecoveryState(order({ fulfilmentStatus: 'NOT_STARTED' }), NOW)
    expect(started?.kind).toBe('not-started')
    expect(started?.canRefresh).toBe(true)
    expect(started?.canRetry).toBe(true)
  })

  it('watches fresh fulfilment but flags stale fulfilment without allowing retry', () => {
    const fresh = buildRecoveryState(
      order({ fulfilmentStatus: 'FULFILLING', fulfilmentStartedAt: new Date(NOW - 5 * 60 * 1000).toISOString() }),
      NOW,
    )
    expect(fresh?.kind).toBe('watch')
    expect(fresh?.canRefresh).toBe(true)
    expect(fresh?.canRetry).toBe(false)
    expect(fresh?.retryBlockedReason).toMatch(/in progress/)

    const stale = buildRecoveryState(
      order({ fulfilmentStatus: 'FULFILLING', fulfilmentStartedAt: new Date(NOW - RECOVERY_STALE_MS - 1000).toISOString() }),
      NOW,
    )
    expect(stale?.kind).toBe('attention')
    expect(stale?.canRetry).toBe(false)
  })

  it('uses service-aware wording without leaking internals', () => {
    const data = buildRecoveryState(order({ serviceType: 'DATA', fulfilmentStatus: 'FULFILLMENT_FAILED' }), NOW)
    expect(data?.headline).toBe('Data delivery failed')
    expect(JSON.stringify(data)).not.toMatch(/provider_ref|walletTxRef|RequestID/)
  })

  it('exposes payment re-verification only for bound wrong-network failures', () => {
    const failed = {
      paymentStatus: 'PAYMENT_FAILED' as const,
      paymentFailureReason: 'wrong-network',
      walletTxRef: 'ab'.repeat(32),
    }
    const recoverable = buildPaymentRecoveryCase(order(failed))
    expect(recoverable).not.toBeNull()
    expect(JSON.stringify(recoverable)).not.toMatch(/pay again|Pay again/)
    // Affirmative mismatches, hashless failures, non-NIM rails, and paid
    // orders are never payment-recoverable here.
    expect(buildPaymentRecoveryCase(order({ ...failed, paymentFailureReason: 'wrong-amount' }))).toBeNull()
    expect(buildPaymentRecoveryCase(order({ ...failed, paymentFailureReason: 'wrong-memo' }))).toBeNull()
    expect(buildPaymentRecoveryCase(order({ ...failed, walletTxRef: undefined }))).toBeNull()
    expect(buildPaymentRecoveryCase(order({ ...failed, paymentStatus: 'ONCHAIN_PENDING' }))).toBeNull()
    expect(buildPaymentRecoveryCase(order({ ...failed, paymentStatus: 'PAID' }))).toBeNull()
    expect(buildPaymentRecoveryCase(order({ ...failed, paymentAsset: 'USDT' as const, serviceType: 'CASH_OUT' as const }))).toBeNull()
  })

  it('keeps cash-out recovery refresh-only with payout wording', () => {
    const base = {
      serviceType: 'CASH_OUT' as const,
      paymentAsset: 'USDT' as const,
      requestedCurrency: 'USDT' as const,
    }
    const attention = buildRecoveryState(order({ ...base, fulfilmentStatus: 'RECOVERY_REQUIRED' }), NOW)
    expect(attention?.kind).toBe('attention')
    expect(attention?.headline).toBe('Payout delivery needs attention')
    expect(attention?.canRefresh).toBe(true)
    expect(attention?.canRetry).toBe(false)
    expect(attention?.retryBlockedReason).toMatch(/Refresh status/)
    expect(JSON.stringify(attention)).toMatch(/USDT/)
    expect(JSON.stringify(attention)).not.toMatch(/NIM/)

    const failed = buildRecoveryState(order({ ...base, fulfilmentStatus: 'FULFILLMENT_FAILED' }), NOW)
    expect(failed?.kind).toBe('failed')
    expect(failed?.headline).toBe('Payout delivery failed')
    expect(failed?.canRetry).toBe(false)

    const watching = buildRecoveryState(order({
      ...base,
      fulfilmentStatus: 'FULFILLING',
      fulfilmentStartedAt: new Date(NOW - 60_000).toISOString(),
    }), NOW)
    expect(watching?.kind).toBe('watch')
    expect(watching?.headline).toBe('Delivering your payout')
  })
})
