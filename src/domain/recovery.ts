import type { PaymentOrder } from './orders'

/**
 * Recovery is a read-only view over canonical PaymentOrder evidence.
 * Nothing here mutates state or invents truth: a blockchain success never
 * becomes a delivery claim, and a failed delivery never rewrites payment.
 */

/** Past this age, a FULFILLING order reads as taking longer than usual. */
export const RECOVERY_STALE_MS = 30 * 60 * 1000

export type RecoveryKind = 'not-started' | 'watch' | 'attention' | 'failed'

export interface RecoveryCase {
  kind: RecoveryKind
  /** Always 'Payment confirmed' — recovery never questions the chain. */
  title: string
  headline: string
  explanation: string
  canRefresh: boolean
  canRetry: boolean
  retryBlockedReason?: string
}

export interface PaymentRecoveryCase {
  headline: string
  explanation: string
}

/**
 * Payment re-verification for the proven false-failure class: a NIM
 * airtime/data order stuck PAYMENT_FAILED with reason wrong-network and
 * a bound wallet hash. Re-checking re-verifies THAT SAME transaction
 * against the configured chain — it never opens the wallet, never
 * requests another payment, and never touches the provider until PAID.
 * Affirmative mismatches (recipient/amount/memo) are never recoverable
 * here; anything without a bound hash has nothing to re-check.
 */
export function buildPaymentRecoveryCase(
  order: Pick<
    PaymentOrder,
    | 'serviceType'
    | 'paymentAsset'
    | 'paymentStatus'
    | 'paymentFailureReason'
    | 'walletTxRef'
  >,
): PaymentRecoveryCase | null {
  if (order.paymentAsset !== 'NIM') return null
  if (order.serviceType !== 'AIRTIME' && order.serviceType !== 'DATA') return null
  if (order.paymentStatus !== 'PAYMENT_FAILED') return null
  if (order.paymentFailureReason !== 'wrong-network') return null
  if (!order.walletTxRef) return null
  return {
    headline: 'Re-check existing payment',
    explanation:
      'This order already has a submitted wallet transaction. Verifying re-checks that same transaction on-chain — it never opens Nimiq Pay and never asks for another payment.',
  }
}

/**
 * Returns a recovery case for PAID orders whose delivery is unresolved,
 * or null when no recovery applies. Non-PAID orders are never fulfilment
 * recovery: a PAYMENT_FAILED order is a payment failure, and anything
 * DELIVERED/REFUNDED/RESOLVED is already resolved.
 */
export function buildRecoveryState(
  order: Pick<
    PaymentOrder,
    | 'serviceType'
    | 'paymentStatus'
    | 'fulfilmentStatus'
    | 'fulfilmentStartedAt'
    | 'paymentVerifiedAt'
    | 'createdAt'
  >,
  nowMs = Date.now(),
): RecoveryCase | null {
  if (order.paymentStatus !== 'PAID') return null
  const isCashout = order.serviceType === 'CASH_OUT'
  const noun = order.serviceType === 'DATA' ? 'data' : isCashout ? 'payout' : 'airtime'
  const nounUp = order.serviceType === 'DATA' ? 'Data' : isCashout ? 'Payout' : 'Airtime'
  const paymentNoun = isCashout ? 'USDT transfer' : 'NIM payment'
  // Cash out never re-purchases: the Paycrest order id is the single
  // purchase reference, so recovery only re-checks provider status.
  const cashoutRetryBlocked = 'Cash out never retries a purchase. Refresh status re-checks Paycrest instead.'
  switch (order.fulfilmentStatus) {
    case 'DELIVERED':
    case 'REFUNDED':
    case 'RESOLVED':
      return null
    case 'FULFILLMENT_FAILED':
      return {
        kind: 'failed',
        title: 'Payment confirmed',
        headline: `${nounUp} delivery failed`,
        explanation: isCashout
          ? `Your USDT transfer was confirmed, but Paycrest reported that the payout failed. Your transfer is safe and recorded — refreshing re-checks Paycrest without starting anything new.`
          : `Your NIM payment was confirmed, but the provider reported that the ${noun} delivery failed. Your payment is safe and recorded — retrying reuses the same provider reference, so you can never be charged twice for this order.`,
        canRefresh: true,
        canRetry: !isCashout,
        ...(isCashout ? { retryBlockedReason: cashoutRetryBlocked } : {}),
      }
    case 'RECOVERY_REQUIRED':
      return {
        kind: 'attention',
        title: 'Payment confirmed',
        headline: `${nounUp} delivery needs attention`,
        explanation: isCashout
          ? `Your USDT transfer was confirmed, but we have not confirmed the payout yet. Refreshing re-checks Paycrest; nothing is purchased twice for this order.`
          : `Your NIM payment was confirmed, but we have not confirmed the ${noun} delivery yet. Refreshing re-checks the provider; retrying reuses the same provider reference, so you can never be charged twice for this order.`,
        canRefresh: true,
        canRetry: !isCashout,
        ...(isCashout ? { retryBlockedReason: cashoutRetryBlocked } : {}),
      }
    case 'NOT_STARTED':
      return {
        kind: 'not-started',
        title: 'Payment confirmed',
        headline: `${nounUp} delivery hasn't started`,
        explanation: isCashout
          ? `Your USDT transfer was confirmed, but the payout hasn't started settling yet. Refreshing re-checks Paycrest for this order.`
          : `Your NIM payment was confirmed, but delivery hasn't started yet. Starting it reserves a single provider reference for this order.`,
        canRefresh: true,
        canRetry: !isCashout,
        ...(isCashout ? { retryBlockedReason: cashoutRetryBlocked } : {}),
      }
    case 'FULFILLING':
      break
  }
  const startedAt = order.fulfilmentStartedAt ?? order.paymentVerifiedAt ?? order.createdAt
  const startedMs = Date.parse(startedAt)
  if (!Number.isFinite(startedMs) || nowMs - startedMs > RECOVERY_STALE_MS) {
    return {
      kind: 'attention',
      title: 'Payment confirmed',
      headline: `${nounUp} delivery is taking longer than usual`,
      explanation: `Your ${paymentNoun} was confirmed and the provider is working on your ${noun}, but it is taking longer than usual. Refreshing re-checks the provider without starting anything new.`,
      canRefresh: true,
      canRetry: false,
      retryBlockedReason: isCashout ? cashoutRetryBlocked : 'Delivery is still in progress with the provider. Refresh status instead of retrying.',
    }
  }
  return {
    kind: 'watch',
    title: 'Payment confirmed',
    headline: `Delivering your ${noun}`,
    explanation: `Your ${paymentNoun} was confirmed and the provider is working on your ${noun}. This usually completes within a few minutes — refresh to check.`,
    canRefresh: true,
    canRetry: false,
    retryBlockedReason: isCashout ? cashoutRetryBlocked : 'Delivery is still in progress with the provider. Refresh status instead of retrying.',
  }
}
