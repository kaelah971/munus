import { normalizeMoney } from '../src/domain/planning'
import { normalizePhone, SUPPORT_NETWORKS } from '../src/domain/support'
import {
  PAYMENT_ASSETS,
  PAYMENT_SERVICE_TYPES,
  type DataOrderDraft,
  type ValidatedPaymentOrderDraft,
} from '../src/domain/orders'

export class PaymentValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PaymentValidationError'
  }
}

export function parsePaymentOrderDraft(value: unknown): ValidatedPaymentOrderDraft {
  const input = asRecord(value, 'Payment order body')
  const serviceType = enumValue(input.serviceType, PAYMENT_SERVICE_TYPES, 'serviceType')
  const paymentAsset = enumValue(input.paymentAsset ?? 'NIM', PAYMENT_ASSETS, 'paymentAsset')
  const recipientPhone = normalizePhoneValue(input.recipientPhone)
  const network = enumOptional(input.recipientNetwork, SUPPORT_NETWORKS, 'recipientNetwork')
  const requestedAmount = positiveMoney(input.requestedAmount, 'requestedAmount')

  return {
    serviceType,
    paymentAsset,
    recipientPhone,
    recipientNetwork: network || undefined,
    requestedAmount,
  }
}

/**
 * DATA orders carry no user-supplied amount: the price always comes from
 * the server-resolved catalog snapshot, so arbitrary NGN input can never
 * override the bundle price.
 */
export function parseDataOrderDraft(value: unknown): DataOrderDraft {
  const input = asRecord(value, 'Data order body')
  const providerPlanId = requiredPlanId(input.providerPlanId)
  if (providerPlanId.length > 128) {
    throw new PaymentValidationError('providerPlanId is too long.')
  }
  const network = input.recipientNetwork
  if (typeof network !== 'string' || !(SUPPORT_NETWORKS as readonly string[]).includes(network)) {
    throw new PaymentValidationError('recipientNetwork is not supported.')
  }
  const paymentAsset = input.paymentAsset ?? 'NIM'
  if (paymentAsset !== 'NIM') {
    throw new PaymentValidationError('Data orders can only be paid with NIM.')
  }
  return {
    providerPlanId,
    recipientPhone: normalizePhoneValue(input.recipientPhone),
    recipientNetwork: network as DataOrderDraft['recipientNetwork'],
    paymentAsset: 'NIM',
  }
}

import type { CashoutOrderInput } from '../src/domain/cashout'

export type { CashoutOrderInput }

/**
 * CASH_OUT carries no user-supplied NGN price and no recipient phone: the
 * payout comes from the Paycrest order response, and the bank snapshot is
 * pinned server-side after account verification.
 */
export function parseCashoutOrderDraft(value: unknown): CashoutOrderInput {
  const input = asRecord(value, 'Cash-out order body')
  const serviceType = input.serviceType ?? 'CASH_OUT'
  if (serviceType !== 'CASH_OUT') {
    throw new PaymentValidationError('Use the cash-out flow for USDT bank payouts.')
  }
  const paymentAsset = input.paymentAsset ?? 'USDT'
  if (paymentAsset !== 'USDT') {
    throw new PaymentValidationError('Cash out can only be paid with USDT.')
  }
  if (typeof input.usdtAmount !== 'string') {
    throw new PaymentValidationError('usdtAmount must be a decimal string.')
  }
  const bankCode = requiredString(input.bankCode, 'bankCode')
  if (bankCode.length > 64) {
    throw new PaymentValidationError('bankCode is too long.')
  }
  return {
    usdtAmount: input.usdtAmount,
    bankCode,
    accountNumber: normalizeBankAccount(input.accountNumber),
  }
}

function normalizeBankAccount(value: unknown): string {
  if (typeof value !== 'string') throw new PaymentValidationError('accountNumber is required.')
  const digits = value.replace(/[\s-]/g, '')
  if (!/^\d{10}$/.test(digits)) {
    throw new PaymentValidationError('accountNumber must be exactly 10 digits.')
  }
  return digits
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PaymentValidationError(`${field} is required.`)
  }
  return value.trim()
}

function requiredPlanId(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PaymentValidationError('providerPlanId is required.')
  }
  return value.trim()
}

function normalizePhoneValue(value: unknown): string {
  if (typeof value !== 'string') throw new PaymentValidationError('recipientPhone is required.')
  try {
    return normalizePhone(value)
  } catch (error) {
    throw new PaymentValidationError(error instanceof Error ? error.message : 'recipientPhone is invalid.')
  }
}

function positiveMoney(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new PaymentValidationError(`${field} must be a decimal string.`)
  try {
    return normalizeMoney(value, false)
  } catch (error) {
    throw new PaymentValidationError(error instanceof Error ? `${field}: ${error.message}` : `${field} is invalid.`)
  }
}

function enumOptional<T extends readonly string[]>(value: unknown, values: T, field: string): T[number] | '' {
  if (value === undefined || value === null || value === '') return ''
  return enumValue(value, values, field)
}

function enumValue<T extends readonly string[]>(value: unknown, values: T, field: string): T[number] {
  if (typeof value !== 'string' || !values.includes(value)) throw new PaymentValidationError(`${field} is not supported.`)
  return value as T[number]
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PaymentValidationError(`${label} must be an object.`)
  return value as Record<string, unknown>
}
