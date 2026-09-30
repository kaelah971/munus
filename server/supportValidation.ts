import { normalizeMoney } from '../src/domain/planning'
import {
  normalizePhone,
  SUPPORT_CATEGORIES,
  SUPPORT_NETWORKS,
  SUPPORT_RULE_PERIODS,
  type Contact,
  type ContactDraft,
  type SupportDraft,
  type SupportDraftInput,
  type SupportRequest,
  type SupportRequestDraft,
  type SupportRule,
  type SupportRuleDraft,
} from '../src/domain/support'

export class SupportValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SupportValidationError'
  }
}

export function parseContactDraft(value: unknown, current?: Contact): ContactDraft {
  const input = asRecord(value, 'Contact body')
  const displayName = requiredString(input.displayName ?? current?.displayName, 'displayName')
  const phone = normalizePhoneValue(input.phone ?? current?.phone)
  const relationship = optionalString(input.relationship ?? current?.relationship, 'relationship')
  const network = enumOptional(input.network ?? current?.network, SUPPORT_NETWORKS, 'network')
  const usualProductType = enumOptional(input.usualProductType ?? current?.usualProductType, SUPPORT_CATEGORIES, 'usualProductType')
  const usualAmount = optionalMoney(input.usualAmount ?? current?.usualAmount, 'usualAmount')
  const notes = optionalString(input.notes ?? current?.notes, 'notes')
  if (displayName.length > 80 || relationship.length > 80 || notes.length > 500) {
    throw new SupportValidationError('Contact text is too long.')
  }
  return { displayName, relationship, phone, network, country: 'NG', usualProductType, usualAmount, notes }
}

export function parseSupportRuleDraft(value: unknown, current?: SupportRule): SupportRuleDraft {
  const input = asRecord(value, 'Support rule body')
  return {
    contactId: optionalString(input.contactId ?? current?.contactId, 'contactId'),
    category: enumValue(input.category ?? current?.category, SUPPORT_CATEGORIES, 'category'),
    period: enumValue(input.period ?? current?.period ?? 'monthly', SUPPORT_RULE_PERIODS, 'period'),
    softLimitAmount: positiveMoney(input.softLimitAmount ?? current?.softLimitAmount, 'softLimitAmount'),
    unit: enumValue(input.unit ?? current?.unit ?? 'NGN', ['NIM', 'NGN'] as const, 'unit'),
    warningThreshold: integerRange(input.warningThreshold ?? current?.warningThreshold ?? 80, 'warningThreshold', 0, 100),
    enabled: booleanValue(input.enabled ?? current?.enabled ?? true, 'enabled'),
  }
}

export function parseSupportRequestDraft(value: unknown, current?: SupportRequest): SupportRequestDraft {
  const input = asRecord(value, 'Support request body')
  const requestedProduct = requiredString(input.requestedProduct ?? current?.requestedProduct, 'requestedProduct')
  if (requestedProduct.length > 160) throw new SupportValidationError('Request details are too long.')
  const message = optionalString(input.message ?? current?.message, 'message')
  if (message.length > 500) throw new SupportValidationError('Request message is too long.')
  return {
    contactId: optionalString(input.contactId ?? current?.contactId, 'contactId'),
    category: enumValue(input.category ?? current?.category, SUPPORT_CATEGORIES, 'category'),
    requestedAmount: positiveMoney(input.requestedAmount ?? current?.requestedAmount, 'requestedAmount'),
    requestedProduct,
    phone: input.phone === undefined && current?.phone === undefined ? '' : normalizePhoneValue(input.phone ?? current?.phone),
    network: enumOptional(input.network ?? current?.network, SUPPORT_NETWORKS, 'network'),
    country: 'NG',
    message,
    expiresAt: optionalDate(input.expiresAt ?? current?.expiresAt, 'expiresAt'),
  }
}

export function parseSupportDraftInput(value: unknown, current?: SupportDraft): SupportDraftInput {
  const input = asRecord(value, 'Support draft body')
  const productDetails = requiredString(input.productDetails ?? current?.productDetails, 'productDetails')
  if (productDetails.length > 160) throw new SupportValidationError('Support details are too long.')
  return {
    source: enumValue(input.source ?? current?.source, ['manual', 'contact', 'request'] as const, 'source'),
    contactId: optionalString(input.contactId ?? current?.contactId, 'contactId'),
    requestId: optionalString(input.requestId ?? current?.requestId, 'requestId'),
    category: enumValue(input.category ?? current?.category, SUPPORT_CATEGORIES, 'category'),
    recipientName: requiredString(input.recipientName ?? current?.recipientName, 'recipientName'),
    recipientPhone: normalizePhoneValue(input.recipientPhone ?? current?.recipientPhone),
    recipientNetwork: enumOptional(input.recipientNetwork ?? current?.recipientNetwork, SUPPORT_NETWORKS, 'recipientNetwork'),
    recipientCountry: 'NG',
    amount: positiveMoney(input.amount ?? current?.amount, 'amount'),
    unit: enumValue(input.unit ?? current?.unit ?? 'NGN', ['NIM', 'NGN'] as const, 'unit'),
    productDetails,
  }
}

export function parseRequestStatus(value: unknown): SupportRequest['status'] {
  return enumValue(value, ['pending', 'approved', 'declined', 'cancelled', 'expired', 'prepared'] as const, 'status')
}

function normalizePhoneValue(value: unknown): string {
  if (typeof value !== 'string') throw new SupportValidationError('Phone is required.')
  try {
    return normalizePhone(value)
  } catch (error) {
    throw new SupportValidationError(error instanceof Error ? error.message : 'Phone is invalid.')
  }
}

function positiveMoney(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new SupportValidationError(`${field} must be a decimal string.`)
  try {
    return normalizeMoney(value, false)
  } catch (error) {
    throw new SupportValidationError(error instanceof Error ? `${field}: ${error.message}` : `${field} is invalid.`)
  }
}

function optionalMoney(value: unknown, field: string): string {
  if (value === undefined || value === null || value === '') return ''
  return positiveMoney(value, field)
}

function optionalDate(value: unknown, field: string): string {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new SupportValidationError(`${field} must be a valid date.`)
  return new Date(value).toISOString()
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new SupportValidationError(`${field} is required.`)
  return value.trim()
}

function optionalString(value: unknown, field: string): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new SupportValidationError(`${field} must be a string.`)
  return value.trim()
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new SupportValidationError(`${field} must be a boolean.`)
  return value
}

function integerRange(value: unknown, field: string, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw new SupportValidationError(`${field} must be an integer from ${min} to ${max}.`)
  return value as number
}

function enumOptional<T extends readonly string[]>(value: unknown, values: T, field: string): T[number] | '' {
  if (value === undefined || value === null || value === '') return ''
  return enumValue(value, values, field)
}

function enumValue<T extends readonly string[]>(value: unknown, values: T, field: string): T[number] {
  if (typeof value !== 'string' || !values.includes(value)) throw new SupportValidationError(`${field} is not supported.`)
  return value as T[number]
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SupportValidationError(`${label} must be an object.`)
  return value as Record<string, unknown>
}
