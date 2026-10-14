import type { SupportNetwork } from './support'

export const PAYMENT_SERVICE_TYPES = ['AIRTIME', 'DATA', 'CASH_OUT'] as const
export const PAYMENT_ASSETS = ['NIM', 'USDT'] as const

export const LUNA_PER_NIM = 100_000n
/** Short bounded quote TTL so a volatile rate cannot go stale. */
export const DEFAULT_QUOTE_TTL_MS = 120_000
/** Nimiq mainnet network ID (protocol-established). Testnet IDs are never guessed. */
export const NIMIQ_MAINNET_NETWORK_ID = 42

export const PAYMENT_STATUSES = [
  'DRAFT',
  'QUOTE_PENDING',
  'READY_FOR_PAYMENT',
  'AWAITING_WALLET_APPROVAL',
  'ONCHAIN_PENDING',
  'PAID',
  'PAYMENT_FAILED',
] as const

export const FULFILMENT_STATUSES = [
  'NOT_STARTED',
  'FULFILLING',
  'DELIVERED',
  'FULFILLMENT_FAILED',
  'RECOVERY_REQUIRED',
  'REFUNDED',
  'RESOLVED',
] as const

export type PaymentServiceType = (typeof PAYMENT_SERVICE_TYPES)[number]
export type PaymentAsset = (typeof PAYMENT_ASSETS)[number]
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]
export type FulfilmentStatus = (typeof FULFILMENT_STATUSES)[number]

export type NimiqPaymentNetwork = 'mainnet' | 'testnet'

export interface NimQuote {
  rateNgnPerNim: string
  nimAmount: string
  lunaAmount: string
  source: string
  observedAt: string
  expiresAt: string
  network: NimiqPaymentNetwork
  receiver: string
  memo: string
}

export interface PaymentOrder {
  id: string
  userId: string
  serviceType: PaymentServiceType
  paymentAsset: PaymentAsset
  recipientPhone?: string
  recipientNetwork?: SupportNetwork
  recipientCountry: 'NG'
  requestedAmount: string
  requestedCurrency: 'NGN' | 'USDT'
  providerPlanId?: string
  planDisplayLabel?: string
  planDataAllowance?: string
  planValidity?: string
  essentialRequestId?: string
  quotedCryptoAmount?: string
  quoteExpiresAt?: string
  paymentNetwork?: NimiqPaymentNetwork
  quoteRateNgnPerNim?: string
  quoteLunaAmount?: string
  quoteSource?: string
  quoteObservedAt?: string
  paymentMemo?: string
  paymentReceiver?: string
  paymentSender?: string
  paymentBlockNumber?: string
  paymentConfirmations?: number
  paymentVerifiedAt?: string
  paymentFailureReason?: string
  walletTxRef?: string
  providerRef?: string
  provider?: string
  providerRequestId?: string
  providerStatusCode?: string
  providerStatus?: string
  providerAmountCharged?: string
  providerRemark?: string
  fulfilmentStartedAt?: string
  fulfilledAt?: string
  lastReconciledAt?: string
  paymentStatus: PaymentStatus
  fulfilmentStatus: FulfilmentStatus
  createdAt: string
  updatedAt: string
  bankCode?: string
  bankName?: string
  bankAccountNumber?: string
  bankAccountName?: string
  paycrestReceiveAddress?: string
  paycrestStatus?: string
  paycrestValidUntil?: string
  payoutNgnAmount?: string
  cashoutFeeUsdt?: string
  usdtTotalAmount?: string
  cashoutRate?: string
}

export interface PaymentOrderDraft {
  serviceType: PaymentServiceType
  paymentAsset: PaymentAsset
  recipientPhone: string
  recipientNetwork: SupportNetwork | ''
  requestedAmount: string
}

export interface ValidatedPaymentOrderDraft {
  serviceType: PaymentServiceType
  paymentAsset: PaymentAsset
  recipientPhone?: string
  recipientNetwork?: SupportNetwork
  requestedAmount: string
  requestedCurrency?: 'NGN' | 'USDT'
  providerPlanId?: string
  planDisplayLabel?: string
  planDataAllowance?: string
  planValidity?: string
  essentialRequestId?: string
  bankCode?: string
  bankName?: string
  bankAccountNumber?: string
  bankAccountName?: string
  paycrestReceiveAddress?: string
  paycrestStatus?: string
  paycrestValidUntil?: string
  payoutNgnAmount?: string
  cashoutFeeUsdt?: string
  usdtTotalAmount?: string
  cashoutRate?: string
}

export interface DataOrderDraft {
  providerPlanId: string
  recipientPhone: string
  recipientNetwork: SupportNetwork
  paymentAsset: 'NIM'
}

/**
 * Provider-neutral data bundle. Allowance/validity come from structured
 * provider fields when present; otherwise the original provider label is
 * preserved as displayName and the structured fields stay undefined.
 */
export interface DataPlan {
  providerPlanId: string
  network: SupportNetwork
  displayName: string
  dataAllowance?: string
  validity?: string
  planType?: string
  localPriceNgn: string
  available: boolean
  provider: string
}

export interface DataNetwork {
  network: SupportNetwork
  label: string
}

/**
 * Extension point for provider adapters (airtime, data, cash-out).
 * Adapters own provider-specific translation and never leak provider codes
 * into the general payment domain or UI.
 */
export interface PaymentProviderAdapter {
  readonly provider: string
  readonly serviceType: PaymentServiceType
}

export interface AirtimePurchaseInput {
  network: SupportNetwork
  amountNgn: string
  mobileNumber: string
  requestId: string
  callbackUrl: string
}

export interface AirtimePurchaseReceipt {
  providerOrderId?: string
  statusCode: string
  status: string
  remark?: string
}

export interface AirtimeQueryInput {
  requestId?: string
  providerOrderId?: string
}

export type AirtimeProviderOutcome =
  | 'completed'
  | 'pending'
  | 'failed'
  | 'unknown'
  | 'not-found'

export interface AirtimeQueryRecord {
  providerOrderId?: string
  requestId?: string
  statusCode: string
  status: string
  remark?: string
  amountCharged?: string
  outcome: AirtimeProviderOutcome
}

export interface AirtimeProviderAdapter extends PaymentProviderAdapter {
  readonly serviceType: 'AIRTIME'
  /** Stable request identifier for one logical fulfilment attempt. */
  deriveRequestId(orderId: string): string
  /** Pure provider-param construction; throws before any network contact. */
  buildPurchaseParams(input: AirtimePurchaseInput): Record<string, string>
  purchase(input: AirtimePurchaseInput): Promise<AirtimePurchaseReceipt>
  query(input: AirtimeQueryInput): Promise<AirtimeQueryRecord>
}

export interface DataPurchaseInput {
  network: SupportNetwork
  providerPlanId: string
  mobileNumber: string
  requestId: string
  callbackUrl: string
}

export interface DataProviderAdapter extends PaymentProviderAdapter {
  readonly serviceType: 'DATA'
  /** Stable request identifier for one logical fulfilment attempt. */
  deriveRequestId(orderId: string): string
  /** Pure provider-param construction; throws before any network contact. */
  buildPurchaseParams(input: DataPurchaseInput): Record<string, string>
  purchase(input: DataPurchaseInput): Promise<AirtimePurchaseReceipt>
  query(input: AirtimeQueryInput): Promise<AirtimeQueryRecord>
}

/**
 * Deterministic compact order reference bound into the on-chain transaction
 * memo, e.g. `MNS:9a6b18d778a6`. Recomputed from the order id on both
 * sides, so it is never trusted from client input.
 */
export function buildPaymentMemo(orderId: string): string {
  const hex = orderId.replace(/[^0-9a-fA-F]/g, '').toLowerCase()
  if (hex.length < 12) throw new Error('Payment order cannot be bound to a wallet transaction.')
  return `MNS:${hex.slice(0, 12)}`
}

interface DecimalParts {
  digits: bigint
  scale: number
}

function parseDecimal(value: string): DecimalParts {
  const match = /^\d+(?:\.(\d+))?$/.exec(value.trim())
  if (!match) throw new Error('Amount must be a non-negative decimal string.')
  const fraction = match[1] ?? ''
  return { digits: BigInt(`${value.trim().split('.')[0]}${fraction}`), scale: fraction.length }
}

/**
 * Exact NGN → luna conversion with integer arithmetic, rounding UP to the
 * nearest luna so decimal truncation can never underpay the receiver.
 * `rateNgnPerNim` is NGN per 1 NIM (e.g. `"2450.5"`).
 */
export function calculateQuoteLuna(requestedNgn: string, rateNgnPerNim: string): bigint {
  const ngn = parseDecimal(requestedNgn)
  const rate = parseDecimal(rateNgnPerNim)
  if (rate.digits <= 0n) throw new Error('Rate must be greater than zero.')
  if (ngn.digits <= 0n) throw new Error('Amount must be greater than zero.')
  const numerator = ngn.digits * LUNA_PER_NIM * 10n ** BigInt(rate.scale)
  const denominator = rate.digits * 10n ** BigInt(ngn.scale)
  return (numerator + denominator - 1n) / denominator
}

export function formatNimFromLunaBigint(luna: bigint): string {
  if (luna < 0n) throw new Error('Luna must be a non-negative integer.')
  const whole = luna / LUNA_PER_NIM
  const fraction = luna % LUNA_PER_NIM
  if (fraction === 0n) return `${whole}`
  return `${whole}.${fraction.toString().padStart(5, '0').replace(/0+$/, '')}`
}

export function isQuoteFresh(order: Pick<PaymentOrder, 'quotedCryptoAmount' | 'quoteExpiresAt' | 'quoteLunaAmount'>, now = Date.now()): boolean {
  // Rail-aware: NIM quotes carry luna alongside the crypto amount, while
  // USDT cash-out quotes carry the USDT total only. Freshness is the quoted
  // amount plus a live expiry on either rail.
  if (!order.quotedCryptoAmount) return false
  if (!order.quoteExpiresAt) return false
  return Date.parse(order.quoteExpiresAt) > now
}

/** A new quote is allowed for untouched drafts or payable orders whose quote lapsed. */
export function canCreateQuote(order: Pick<PaymentOrder, 'serviceType' | 'paymentAsset' | 'paymentStatus'>, now = Date.now()): boolean {
  void now
  if (order.serviceType !== 'AIRTIME' || order.paymentAsset !== 'NIM') return false
  return order.paymentStatus === 'DRAFT' || order.paymentStatus === 'READY_FOR_PAYMENT'
}

/**
 * A DATA order may enter provider fulfilment only when PAID, mainnet-bound
 * exclusions aside, with a snapshotted bundle and no fulfilment started.
 * Kept separate from canStartFulfilment so airtime guards never drift.
 */
export function canStartDataFulfilment(
  order: Pick<PaymentOrder, 'serviceType' | 'paymentStatus' | 'fulfilmentStatus' | 'providerPlanId'>,
): boolean {
  return (
    order.serviceType === 'DATA' &&
    order.paymentStatus === 'PAID' &&
    order.fulfilmentStatus === 'NOT_STARTED' &&
    Boolean(order.providerPlanId)
  )
}

/**
 * A DATA order is quotable only as NIM, from DRAFT/READY, with a
 * snapshotted bundle. The snapshot (never client input) prices the quote.
 */
export function canCreateDataQuote(
  order: Pick<PaymentOrder, 'serviceType' | 'paymentAsset' | 'paymentStatus' | 'providerPlanId'>,
): boolean {
  if (order.serviceType !== 'DATA' || order.paymentAsset !== 'NIM') return false
  if (!order.providerPlanId) return false
  return order.paymentStatus === 'DRAFT' || order.paymentStatus === 'READY_FOR_PAYMENT'
}

/**
 * Only a legitimately PAID airtime order waiting for fulfilment may enter
 * real provider fulfilment. DRAFT (and every other payment state) is
 * rejected before any provider contact.
 */
export function canStartFulfilment(
  order: Pick<PaymentOrder, 'serviceType' | 'paymentStatus' | 'fulfilmentStatus'>,
): boolean {
  return (
    order.serviceType === 'AIRTIME' &&
    order.paymentStatus === 'PAID' &&
    order.fulfilmentStatus === 'NOT_STARTED'
  )
}

export function isFulfilmentTerminal(status: FulfilmentStatus): boolean {
  return status === 'DELIVERED' || status === 'REFUNDED' || status === 'RESOLVED'
}

/**
 * Maps a reconciled provider outcome onto fulfilment state. `pending` and
 * `not-found` carry no delivery evidence, so the caller must leave state
 * unchanged for those (null). Explicit failure ends the attempt; an
 * ambiguous provider response requires human recovery, never a guess.
 */
export function fulfilmentStatusForOutcome(
  outcome: AirtimeProviderOutcome,
): FulfilmentStatus | null {
  if (outcome === 'completed') return 'DELIVERED'
  if (outcome === 'failed') return 'FULFILLMENT_FAILED'
  if (outcome === 'unknown') return 'RECOVERY_REQUIRED'
  return null
}

export function isOrderQuoteAvailable(order: Pick<PaymentOrder, 'quotedCryptoAmount' | 'quoteExpiresAt'>, now = Date.now()): boolean {
  if (!order.quotedCryptoAmount) return false
  if (!order.quoteExpiresAt) return true
  return Date.parse(order.quoteExpiresAt) > now
}

/**
 * Payment is only possible once a live quote with an exact integer luna
 * amount exists, is fresh, and the order is ready. The UI can never present
 * a pay button before a real quote path exists.
 */
export function canPayOrder(order: Pick<PaymentOrder, 'paymentStatus' | 'quotedCryptoAmount' | 'quoteExpiresAt' | 'quoteLunaAmount'>, now = Date.now()): boolean {
  return order.paymentStatus === 'READY_FOR_PAYMENT' && isQuoteFresh(order, now)
}

export function describeOrderStage(order: Pick<PaymentOrder, 'paymentStatus' | 'fulfilmentStatus' | 'serviceType'>): string {
  const wallet = order.serviceType === 'CASH_OUT' ? 'your wallet' : 'Nimiq Pay'
  if (order.paymentStatus === 'DRAFT') return 'Order saved · payment quote not created yet.'
  if (order.paymentStatus === 'QUOTE_PENDING') return 'Waiting for a live payment quote.'
  if (order.paymentStatus === 'READY_FOR_PAYMENT') return 'Quote ready · waiting for wallet approval.'
  if (order.paymentStatus === 'AWAITING_WALLET_APPROVAL') return `Waiting for ${wallet} approval.`
  if (order.paymentStatus === 'ONCHAIN_PENDING') return 'Payment sent · waiting for confirmation.'
  if (order.paymentStatus === 'PAID') {
    if (order.fulfilmentStatus === 'DELIVERED') return 'Paid and delivered.'
    if (order.fulfilmentStatus === 'FULFILLING') return 'Paid · fulfilment in progress.'
    if (order.fulfilmentStatus === 'FULFILLMENT_FAILED' || order.fulfilmentStatus === 'RECOVERY_REQUIRED') {
      return 'Paid · fulfilment needs recovery.'
    }
    return 'Paid · waiting for fulfilment.'
  }
  if (order.paymentStatus === 'PAYMENT_FAILED') return 'Payment failed · no money moved.'
  return 'Order saved.'
}

export function describeFulfilmentStage(status: FulfilmentStatus): string {
  switch (status) {
    case 'NOT_STARTED': return 'Not sent to a provider yet.'
    case 'FULFILLING': return 'Provider is fulfilling this order.'
    case 'DELIVERED': return 'Provider confirmed delivery.'
    case 'FULFILLMENT_FAILED': return 'Provider could not fulfil this order.'
    case 'RECOVERY_REQUIRED': return 'Needs recovery · open Recovery Center from Activity or Pay.'
    case 'REFUNDED': return 'Refunded.'
    case 'RESOLVED': return 'Resolved.'
  }
}
