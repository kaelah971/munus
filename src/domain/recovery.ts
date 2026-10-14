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
  const noun = order.serviceType === 'DATA' ? 'data' : 'airtime'
  const nounUp = order.serviceType === 'DATA' ? 'Data' : 'Airtime'
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
        explanation: `Your NIM payment was confirmed, but the provider reported that the ${noun} delivery failed. Your payment is safe and recorded — retrying reuses the same provider reference, so you can never be charged twice for this order.`,
        canRefresh: true,
        canRetry: true,
      }
    case 'RECOVERY_REQUIRED':
      return {
        kind: 'attention',
        title: 'Payment confirmed',
        headline: `${nounUp} delivery needs attention`,
        explanation: `Your NIM payment was confirmed, but we have not confirmed the ${noun} delivery yet. Refreshing re-checks the provider; retrying reuses the same provider reference, so you can never be charged twice for this order.`,
        canRefresh: true,
        canRetry: true,
      }
    case 'NOT_STARTED':
      return {
        kind: 'not-started',
        title: 'Payment confirmed',
        headline: `${nounUp} delivery hasn't started`,
        explanation: `Your NIM payment was confirmed, but delivery hasn't started yet. Starting it reserves a single provider reference for this order.`,
        canRefresh: true,
        canRetry: true,
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
      explanation: `Your NIM payment was confirmed and the provider is working on your ${noun}, but it is taking longer than usual. Refreshing re-checks the provider without starting anything new.`,
      canRefresh: true,
      canRetry: false,
      retryBlockedReason: 'Delivery is still in progress with the provider. Refresh status instead of retrying.',
    }
  }
  return {
    kind: 'watch',
    title: 'Payment confirmed',
    headline: `Delivering your ${noun}`,
    explanation: `Your NIM payment was confirmed and the provider is working on your ${noun}. This usually completes within a few minutes — refresh to check.`,
    canRefresh: true,
    canRetry: false,
    retryBlockedReason: 'Delivery is still in progress with the provider. Refresh status instead of retrying.',
  }
}
