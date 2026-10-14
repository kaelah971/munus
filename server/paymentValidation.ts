import { normalizeMoney } from '../src/domain/planning'
import { normalizePhone, SUPPORT_NETWORKS } from '../src/domain/support'
import {
  PAYMENT_ASSETS,
  PAYMENT_SERVICE_TYPES,
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
