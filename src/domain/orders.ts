import type { SupportNetwork } from './support'

export const PAYMENT_SERVICE_TYPES = ['AIRTIME', 'DATA', 'CASH_OUT'] as const
export const PAYMENT_ASSETS = ['NIM', 'USDT'] as const

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

export interface PaymentOrder {
  id: string
  userId: string
  serviceType: PaymentServiceType
  paymentAsset: PaymentAsset
  recipientPhone: string
  recipientNetwork?: SupportNetwork
  recipientCountry: 'NG'
  requestedAmount: string
  requestedCurrency: 'NGN'
  quotedCryptoAmount?: string
  quoteExpiresAt?: string
  walletTxRef?: string
  providerRef?: string
  provider?: string
  paymentStatus: PaymentStatus
  fulfilmentStatus: FulfilmentStatus
  createdAt: string
  updatedAt: string
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
  recipientPhone: string
  recipientNetwork?: SupportNetwork
  requestedAmount: string
}

/**
 * Extension point for provider adapters (airtime, data, cash-out).
 * No adapter is wired in the order-foundation slice: orders are created as
 * DRAFT records with no quote, no wallet transaction, and no fulfilment.
 */
export interface PaymentProviderAdapter {
  readonly provider: string
  readonly serviceType: PaymentServiceType
}

export function isOrderQuoteAvailable(order: Pick<PaymentOrder, 'quotedCryptoAmount' | 'quoteExpiresAt'>, now = Date.now()): boolean {
  if (!order.quotedCryptoAmount) return false
  if (!order.quoteExpiresAt) return true
  return Date.parse(order.quoteExpiresAt) > now
}

/**
 * Payment is only possible once a live quote exists and the order is ready.
 * This guard stays false for every order in the foundation slice, so the UI
 * can never present a pay button before a real quote/payment path exists.
 */
export function canPayOrder(order: Pick<PaymentOrder, 'paymentStatus' | 'quotedCryptoAmount' | 'quoteExpiresAt'>, now = Date.now()): boolean {
  return order.paymentStatus === 'READY_FOR_PAYMENT' && isOrderQuoteAvailable(order, now)
}

export function describeOrderStage(order: Pick<PaymentOrder, 'paymentStatus' | 'fulfilmentStatus'>): string {
  if (order.paymentStatus === 'DRAFT') return 'Order saved · payment quote not created yet.'
  if (order.paymentStatus === 'QUOTE_PENDING') return 'Waiting for a live payment quote.'
  if (order.paymentStatus === 'READY_FOR_PAYMENT') return 'Quote ready · waiting for wallet approval.'
  if (order.paymentStatus === 'AWAITING_WALLET_APPROVAL') return 'Waiting for Nimiq Pay approval.'
  if (order.paymentStatus === 'ONCHAIN_PENDING') return 'Payment sent · waiting for confirmation.'
  if (order.paymentStatus === 'PAID') {
    if (order.fulfilmentStatus === 'DELIVERED') return 'Paid and delivered.'
    if (order.fulfilmentStatus === 'FULFILLING') return 'Paid · fulfilment in progress.'
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
    case 'RECOVERY_REQUIRED': return 'Needs recovery · see the Recovery Center when it opens.'
    case 'REFUNDED': return 'Refunded.'
    case 'RESOLVED': return 'Resolved.'
  }
}
