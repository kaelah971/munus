import { maskBankAccountNumber } from './cashout'
import { formatNgnAmount } from './funding'
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

export function describeActivityStatusCopy(
  status: ActivityStatus,
  serviceType?: PaymentServiceType,
): { label: string; tone: ActivityTone } {
  if (status === 'delivering' && serviceType === 'CASH_OUT') {
    return { label: 'Settling payout', tone: 'attention' }
  }
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
  if (fulfilment === 'REFUNDED') return 'needs-attention'
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
  if (provider === 'paycrest') return 'Paycrest'
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
  | 'serviceType'
  | 'paymentStatus'
  | 'fulfilmentStatus'
  | 'createdAt'
  | 'walletTxRef'
  | 'paymentVerifiedAt'
  | 'providerRequestId'
  | 'fulfilmentStartedAt'
  | 'fulfilledAt'
>): ReceiptTimelineStage[] {
  const isCashout = order.serviceType === 'CASH_OUT'
  const noun = order.serviceType === 'DATA' ? 'Data' : isCashout ? 'Payout' : 'Airtime'
  const paymentNoun = isCashout ? 'USDT transfer' : 'NIM payment'
  const sentLabel = isCashout ? 'Payout sent to provider' : `${noun} sent to provider`
  const deliveredLabel = isCashout ? 'Payout settled' : `${noun} delivered`
  const stages: ReceiptTimelineStage[] = [
    { id: 'created', label: 'Order created', state: 'done', at: order.createdAt },
  ]
  const paymentFailed = order.paymentStatus === 'PAYMENT_FAILED'
  if (order.walletTxRef) {
    stages.push({ id: 'submitted', label: `${paymentNoun} submitted`, state: 'done' })
  } else if (!paymentFailed && order.paymentStatus !== 'DRAFT') {
    stages.push({ id: 'submitted', label: `${paymentNoun} submitted`, state: 'idle' })
  }
  if (order.paymentVerifiedAt) {
    stages.push({ id: 'confirmed', label: `${paymentNoun} confirmed`, state: 'done', at: order.paymentVerifiedAt })
  } else if (!paymentFailed && (order.paymentStatus === 'ONCHAIN_PENDING' || order.paymentStatus === 'PAID')) {
    stages.push({ id: 'confirmed', label: `${paymentNoun} confirmed`, state: 'idle' })
  }
  if (order.providerRequestId || order.fulfilmentStartedAt) {
    stages.push({
      id: 'sent',
      label: sentLabel,
      state: 'done',
      ...(order.fulfilmentStartedAt ? { at: order.fulfilmentStartedAt } : {}),
    })
  } else if (order.paymentStatus === 'PAID' && (order.fulfilmentStatus === 'NOT_STARTED' || order.fulfilmentStatus === 'FULFILLING')) {
    stages.push({ id: 'sent', label: sentLabel, state: 'idle' })
  }
  if (order.fulfilmentStatus === 'DELIVERED') {
    stages.push({
      id: 'delivered',
      label: deliveredLabel,
      state: 'done',
      ...(order.fulfilledAt ? { at: order.fulfilledAt } : {}),
    })
  } else if (order.fulfilmentStatus === 'FULFILLING') {
    stages.push({ id: 'delivered', label: deliveredLabel, state: 'idle' })
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
  bundleLabel?: string
  dataAllowance?: string
  validity?: string
  asset: PaymentAsset
  nimAmount?: string
  lunaAmount?: string
  rate?: string
  rateAsset?: 'NIM' | 'USDT'
  usdtTotalAmount?: string
  payoutNgnAmount?: string
  cashoutFeeUsdt?: string
  cashoutRateNgnPerUsdt?: string
  bankName?: string
  bankAccountMasked?: string
  bankAccountName?: string
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
  const copy = describeActivityStatusCopy(activityStatus, order.serviceType)
  const isCashout = order.serviceType === 'CASH_OUT'
  return {
    orderId: order.id,
    receiptReference: buildReceiptReference(order.id),
    serviceLabel: describeServiceLabel(order.serviceType),
    network: order.recipientNetwork,
    recipientMasked: isCashout
      ? maskBankAccountNumber(order.bankAccountNumber ?? '')
      : maskPhone(order.recipientPhone ?? ''),
    localAmount: formatNgnAmount(order.requestedAmount),
    localCurrency: 'NGN',
    bundleLabel: order.planDisplayLabel,
    dataAllowance: order.planDataAllowance,
    validity: order.planValidity,
    asset: order.paymentAsset,
    nimAmount: isCashout ? undefined : order.quotedCryptoAmount,
    lunaAmount: order.quoteLunaAmount,
    rate: isCashout ? order.cashoutRate : order.quoteRateNgnPerNim,
    rateAsset: isCashout ? 'USDT' : 'NIM',
    usdtTotalAmount: order.usdtTotalAmount,
    payoutNgnAmount: order.payoutNgnAmount,
    cashoutFeeUsdt: order.cashoutFeeUsdt,
    cashoutRateNgnPerUsdt: order.cashoutRate,
    bankName: order.bankName,
    bankAccountMasked: order.bankAccountNumber ? maskBankAccountNumber(order.bankAccountNumber) : undefined,
    bankAccountName: order.bankAccountName,
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
    Boolean(order.quotedCryptoAmount ?? order.quoteLunaAmount) &&
    Boolean(order.provider) &&
    Boolean(order.fulfilledAt)
  )
}
