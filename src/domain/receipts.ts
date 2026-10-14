import { maskPhone } from './support'
import type { FulfilmentStatus, PaymentAsset, PaymentOrder, PaymentServiceType } from './orders'

/**
 * Receipts are a read-only projection over canonical PaymentOrder evidence.
 * Nothing here is persisted and nothing here invents transaction truth: a
 * blockchain transaction alone never becomes a completed service receipt.
 */

export type ActivityStatus =
  | 'draft'
  | 'ready'
  | 'awaiting-approval'
  | 'confirming'
  | 'payment-confirmed'
  | 'delivering'
  | 'delivered'
  | 'delivery-failed'
  | 'needs-attention'
  | 'payment-failed'

export type ActivityTone = 'quiet' | 'ready' | 'attention'

export type ActivityFilter = 'all' | 'completed' | 'in-progress' | 'attention'

export const ACTIVITY_FILTERS: readonly { id: ActivityFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'completed', label: 'Completed' },
  { id: 'in-progress', label: 'In progress' },
  { id: 'attention', label: 'Needs attention' },
]

const ACTIVITY_STATUS_COPY: Record<ActivityStatus, { label: string; tone: ActivityTone }> = {
  draft: { label: 'Draft', tone: 'quiet' },
  ready: { label: 'Ready to pay', tone: 'quiet' },
  'awaiting-approval': { label: 'Awaiting approval', tone: 'quiet' },
  confirming: { label: 'Confirming payment', tone: 'attention' },
  'payment-confirmed': { label: 'Payment confirmed', tone: 'ready' },
  delivering: { label: 'Delivering airtime', tone: 'attention' },
  delivered: { label: 'Delivered', tone: 'ready' },
  'delivery-failed': { label: 'Delivery failed', tone: 'attention' },
  'needs-attention': { label: 'Needs attention', tone: 'attention' },
  'payment-failed': { label: 'Payment failed', tone: 'attention' },
}

export function describeActivityStatusCopy(status: ActivityStatus): { label: string; tone: ActivityTone } {
  return ACTIVITY_STATUS_COPY[status]
}

/**
 * Single shared mapping from the separate payment + fulfilment states into
 * one consumer-readable label. Presentation only — persistence keeps both
 * state machines distinct.
 */
export function describeActivityStatus(
  order: Pick<PaymentOrder, 'paymentStatus' | 'fulfilmentStatus'>,
): ActivityStatus {
  if (order.paymentStatus === 'PAYMENT_FAILED') return 'payment-failed'
  if (order.paymentStatus === 'DRAFT') return 'draft'
  if (order.paymentStatus === 'QUOTE_PENDING' || order.paymentStatus === 'READY_FOR_PAYMENT') return 'ready'
  if (order.paymentStatus === 'AWAITING_WALLET_APPROVAL') return 'awaiting-approval'
  if (order.paymentStatus === 'ONCHAIN_PENDING') return 'confirming'
  const fulfilment = order.fulfilmentStatus satisfies FulfilmentStatus
  if (fulfilment === 'DELIVERED') return 'delivered'
  if (fulfilment === 'FULFILLING') return 'delivering'
  if (fulfilment === 'FULFILLMENT_FAILED') return 'delivery-failed'
  if (fulfilment === 'RECOVERY_REQUIRED') return 'needs-attention'
  return 'payment-confirmed'
}

export function matchesActivityFilter(status: ActivityStatus, filter: ActivityFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'completed') return status === 'delivered'
  if (filter === 'attention') {
    return status === 'needs-attention' || status === 'delivery-failed' || status === 'payment-failed'
  }
  return (
    status === 'ready' ||
    status === 'awaiting-approval' ||
    status === 'confirming' ||
    status === 'payment-confirmed' ||
    status === 'delivering'
  )
}

export function describeServiceLabel(serviceType: PaymentServiceType): string {
  if (serviceType === 'AIRTIME') return 'Airtime'
  if (serviceType === 'DATA') return 'Data'
  return 'Cash out'
}

export function describeProviderName(provider: string): string {
  if (provider === 'clubkonnect') return 'ClubKonnect'
  return provider
}

export function describePaymentNetwork(network: PaymentOrder['paymentNetwork']): string | undefined {
  if (network === 'mainnet') return 'Nimiq mainnet'
  if (network === 'testnet') return 'Nimiq testnet'
  return undefined
}

export function describePaymentFailureReason(reason?: string): string {
  switch (reason) {
    case 'wrong-recipient': return 'The confirmed transaction did not pay the Munus receiver.'
    case 'wrong-amount': return 'The confirmed transaction did not match the quoted amount.'
    case 'wrong-network': return 'The confirmed transaction was on the wrong Nimiq network.'
    case 'wrong-memo': return 'The confirmed transaction was missing this order\u2019s payment reference.'
    default: return 'The wallet transaction could not be verified as this order\u2019s payment.'
  }
}

/**
 * Deterministic receipt reference derived from the order identity, e.g.
 * `MNS-9A6B18D7`. Newest-first activity and receipt screens show this
 * instead of raw internal ids.
 */
export function buildReceiptReference(orderId: string): string {
  const hex = orderId.replace(/[^0-9a-fA-F]/g, '').toUpperCase()
  if (hex.length < 8) throw new Error('Payment order cannot be referenced as a receipt.')
  return `MNS-${hex.slice(0, 8)}`
}

export function shortenReference(value: string): string {
  const compact = value.replace(/\s+/g, '')
  if (compact.length <= 18) return value
  return `${compact.slice(0, 8)}…${compact.slice(-6)}`
}

export function formatActivityDate(iso: string): string {
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return ''
  return new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function sortOrdersNewestFirst<T extends Pick<PaymentOrder, 'createdAt'>>(orders: readonly T[]): T[] {
  return [...orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export type ReceiptTimelineState = 'done' | 'idle' | 'attention'

export interface ReceiptTimelineStage {
  id: string
  label: string
  state: ReceiptTimelineState
  at?: string
}

/**
 * Proof timeline rendered only from persisted evidence. Stages without
 * evidence are shown as idle while the flow is still open, and omitted once
 * a terminal payment failure closes them. Timestamps are never fabricated.
 */
export function buildProofTimeline(order: Pick<PaymentOrder,
  | 'paymentStatus'
  | 'fulfilmentStatus'
  | 'createdAt'
  | 'walletTxRef'
  | 'paymentVerifiedAt'
  | 'providerRequestId'
  | 'fulfilmentStartedAt'
  | 'fulfilledAt'
>): ReceiptTimelineStage[] {
  const stages: ReceiptTimelineStage[] = [
    { id: 'created', label: 'Order created', state: 'done', at: order.createdAt },
  ]
  const paymentFailed = order.paymentStatus === 'PAYMENT_FAILED'
  if (order.walletTxRef) {
    stages.push({ id: 'submitted', label: 'NIM payment submitted', state: 'done' })
  } else if (!paymentFailed && order.paymentStatus !== 'DRAFT') {
    stages.push({ id: 'submitted', label: 'NIM payment submitted', state: 'idle' })
  }
  if (order.paymentVerifiedAt) {
    stages.push({ id: 'confirmed', label: 'NIM payment confirmed', state: 'done', at: order.paymentVerifiedAt })
  } else if (!paymentFailed && (order.paymentStatus === 'ONCHAIN_PENDING' || order.paymentStatus === 'PAID')) {
    stages.push({ id: 'confirmed', label: 'NIM payment confirmed', state: 'idle' })
  }
  if (order.providerRequestId || order.fulfilmentStartedAt) {
    stages.push({
      id: 'sent',
      label: 'Airtime sent to provider',
      state: 'done',
      ...(order.fulfilmentStartedAt ? { at: order.fulfilmentStartedAt } : {}),
    })
  } else if (order.paymentStatus === 'PAID' && (order.fulfilmentStatus === 'NOT_STARTED' || order.fulfilmentStatus === 'FULFILLING')) {
    stages.push({ id: 'sent', label: 'Airtime sent to provider', state: 'idle' })
  }
  if (order.fulfilmentStatus === 'DELIVERED') {
    stages.push({
      id: 'delivered',
      label: 'Airtime delivered',
      state: 'done',
      ...(order.fulfilledAt ? { at: order.fulfilledAt } : {}),
    })
  } else if (order.fulfilmentStatus === 'FULFILLING') {
    stages.push({ id: 'delivered', label: 'Airtime delivered', state: 'idle' })
  } else if (order.fulfilmentStatus === 'FULFILLMENT_FAILED' || order.fulfilmentStatus === 'RECOVERY_REQUIRED') {
    stages.push({ id: 'delivered', label: 'Provider delivery', state: 'attention' })
  }
  return stages
}

export interface MunusReceipt {
  orderId: string
  receiptReference: string
  serviceLabel: string
  network?: PaymentOrder['recipientNetwork']
  recipientMasked: string
  localAmount: string
  localCurrency: 'NGN'
  asset: PaymentAsset
  nimAmount?: string
  lunaAmount?: string
  rate?: string
  paymentNetworkLabel?: string
  isTestnet: boolean
  walletTxShort?: string
  /** Full hash stays in the owner-only view-model for the explicit copy action. */
  walletTxFull?: string
  senderShort?: string
  receiverShort?: string
  paymentTime?: string
  deliveryTime?: string
  providerName?: string
  providerRef?: string
  providerStatusText?: string
  amountCharged?: string
  activityStatus: ActivityStatus
  statusLabel: string
  statusTone: ActivityTone
  completed: boolean
  failureDetail?: string
  timeline: ReceiptTimelineStage[]
}

export function buildReceipt(order: PaymentOrder): MunusReceipt {
  const activityStatus = describeActivityStatus(order)
  const copy = describeActivityStatusCopy(activityStatus)
  return {
    orderId: order.id,
    receiptReference: buildReceiptReference(order.id),
    serviceLabel: describeServiceLabel(order.serviceType),
    network: order.recipientNetwork,
    recipientMasked: maskPhone(order.recipientPhone),
    localAmount: order.requestedAmount,
    localCurrency: 'NGN',
    asset: order.paymentAsset,
    nimAmount: order.quotedCryptoAmount,
    lunaAmount: order.quoteLunaAmount,
    rate: order.quoteRateNgnPerNim,
    paymentNetworkLabel: describePaymentNetwork(order.paymentNetwork),
    isTestnet: order.paymentNetwork === 'testnet',
    walletTxShort: order.walletTxRef ? shortenReference(order.walletTxRef) : undefined,
    walletTxFull: order.walletTxRef,
    senderShort: order.paymentSender ? shortenReference(order.paymentSender) : undefined,
    receiverShort: order.paymentReceiver ? shortenReference(order.paymentReceiver) : undefined,
    paymentTime: order.paymentVerifiedAt,
    deliveryTime: order.fulfilledAt,
    providerName: order.provider ? describeProviderName(order.provider) : undefined,
    providerRef: order.providerRef,
    providerStatusText: order.providerStatus
      ? `${order.providerStatus} (${order.providerStatusCode ?? 'no code'})`
      : undefined,
    amountCharged: order.providerAmountCharged,
    activityStatus,
    statusLabel: copy.label,
    statusTone: copy.tone,
    completed: isCompletedReceipt(order),
    failureDetail: order.paymentStatus === 'PAYMENT_FAILED'
      ? describePaymentFailureReason(order.paymentFailureReason)
      : undefined,
    timeline: buildProofTimeline(order),
  }
}

/**
 * A completed receipt requires the full evidence chain: verified on-chain
 * payment plus confirmed provider delivery. Anything less is an order
 * detail, never labeled a receipt.
 */
export function isCompletedReceipt(order: Pick<PaymentOrder,
  | 'fulfilmentStatus'
  | 'walletTxRef'
  | 'paymentVerifiedAt'
  | 'quotedCryptoAmount'
  | 'quoteLunaAmount'
  | 'provider'
  | 'fulfilledAt'
>): boolean {
  return (
    order.fulfilmentStatus === 'DELIVERED' &&
    Boolean(order.walletTxRef) &&
    Boolean(order.paymentVerifiedAt) &&
    Boolean(order.quotedCryptoAmount) &&
    Boolean(order.quoteLunaAmount) &&
    Boolean(order.provider) &&
    Boolean(order.fulfilledAt)
  )
}
