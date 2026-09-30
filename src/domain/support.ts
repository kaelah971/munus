import {
  compareMoney,
  normalizeMoney,
  type PlanningUnit,
} from './planning'

export const SUPPORT_CATEGORIES = [
  'Airtime',
  'Data',
  'Electricity',
  'School',
  'Medical',
  'Transport',
  'Other essential',
] as const

export const SUPPORT_NETWORKS = ['MTN', 'Airtel', 'Glo', '9mobile'] as const
export const SUPPORT_RULE_PERIODS = ['weekly', 'monthly'] as const

export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number]
export type SupportNetwork = (typeof SUPPORT_NETWORKS)[number]
export type SupportRulePeriod = (typeof SUPPORT_RULE_PERIODS)[number]
export type SupportRequestStatus =
  | 'pending'
  | 'approved'
  | 'declined'
  | 'cancelled'
  | 'expired'
  | 'prepared'
export type SupportDraftSource = 'manual' | 'contact' | 'request'
export type SupportDraftStatus = 'draft' | 'reviewed' | 'cancelled'

export interface Contact {
  id: string
  userId: string
  displayName: string
  relationship?: string
  phone: string
  network?: SupportNetwork
  country: 'NG'
  usualProductType?: SupportCategory
  usualAmount?: string
  notes?: string
  archivedAt?: string
  createdAt: string
  updatedAt: string
}

export interface ContactDraft {
  displayName: string
  relationship: string
  phone: string
  network: SupportNetwork | ''
  country: 'NG'
  usualProductType: SupportCategory | ''
  usualAmount: string
  notes: string
}

export interface SupportRule {
  id: string
  userId: string
  contactId?: string
  category: SupportCategory
  period: SupportRulePeriod
  softLimitAmount: string
  unit: PlanningUnit
  warningThreshold: number
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface SupportRuleDraft {
  contactId: string
  category: SupportCategory
  period: SupportRulePeriod
  softLimitAmount: string
  unit: PlanningUnit
  warningThreshold: number
  enabled: boolean
}

export interface SupportRequest {
  id: string
  requesterUserId?: string
  recipientUserId?: string
  ownerUserId: string
  contactId?: string
  publicRequestId: string
  category: SupportCategory
  requestedAmount: string
  requestedProduct: string
  phone?: string
  network?: SupportNetwork
  country: 'NG'
  message?: string
  status: SupportRequestStatus
  expiresAt?: string
  createdAt: string
  updatedAt: string
}

export interface SupportRequestDraft {
  contactId: string
  category: SupportCategory
  requestedAmount: string
  requestedProduct: string
  phone: string
  network: SupportNetwork | ''
  country: 'NG'
  message: string
  expiresAt: string
}

export interface SupportDraft {
  id: string
  userId: string
  source: SupportDraftSource
  contactId?: string
  requestId?: string
  category: SupportCategory
  recipientName: string
  recipientPhone: string
  recipientNetwork?: SupportNetwork
  recipientCountry: 'NG'
  amount: string
  unit: PlanningUnit
  productDetails: string
  status: SupportDraftStatus
  createdAt: string
  updatedAt: string
}

export interface SupportDraftInput {
  source: SupportDraftSource
  contactId: string
  requestId: string
  category: SupportCategory
  recipientName: string
  recipientPhone: string
  recipientNetwork: SupportNetwork | ''
  recipientCountry: 'NG'
  amount: string
  unit: PlanningUnit
  productDetails: string
}

export interface PublicSupportRequest {
  publicRequestId: string
  requesterLabel: string
  category: SupportCategory
  requestedAmount: string
  requestedProduct: string
  phone?: string
  network?: SupportNetwork
  country: 'NG'
  message?: string
  status: Extract<SupportRequestStatus, 'pending' | 'approved'>
  expiresAt?: string
}

export function maskPhone(phone: string): string {
  const normalized = phone.replace(/\s+/g, '')
  if (normalized.length <= 4) return '••••'
  return `${normalized.slice(0, 3)}•••${normalized.slice(-4)}`
}

export function normalizePhone(phone: string): string {
  const normalized = phone.replace(/[\s-]/g, '')
  if (!/^\+?\d{10,15}$/.test(normalized)) {
    throw new Error('Use a valid phone number with 10 to 15 digits.')
  }
  return normalized
}

export function calculateSupportWarning(
  rule: Pick<SupportRule, 'softLimitAmount' | 'warningThreshold' | 'enabled'>,
  plannedAmount: string,
): 'none' | 'warning' | 'limit' {
  if (!rule.enabled) return 'none'
  const planned = normalizeMoney(plannedAmount)
  if (compareMoney(planned, rule.softLimitAmount) >= 0) return 'limit'
  const threshold = normalizeMoney(
    multiplyMoney(rule.softLimitAmount, rule.warningThreshold, 100),
  )
  return compareMoney(planned, threshold) >= 0 ? 'warning' : 'none'
}

export function canTransitionSupportRequest(
  current: SupportRequestStatus,
  next: SupportRequestStatus,
): boolean {
  if (current === next) return true
  if (current === 'pending') return ['approved', 'declined', 'cancelled', 'expired'].includes(next)
  if (current === 'approved') return ['prepared', 'cancelled'].includes(next)
  return false
}

export function isProviderBackedCategory(category: SupportCategory): boolean {
  return category === 'Airtime' || category === 'Data'
}

function multiplyMoney(value: string, numerator: number, denominator: number): string {
  const normalized = normalizeMoney(value)
  const [whole, fraction = ''] = normalized.split('.')
  const scale = fraction.length
  const digits = BigInt(`${whole}${fraction}`)
  const result = (digits * BigInt(numerator)) / BigInt(denominator)
  if (result === 0n) return '0'
  const raw = result.toString().padStart(scale + 1, '0')
  if (scale === 0) return raw
  const resultWhole = raw.slice(0, -scale) || '0'
  const resultFraction = raw.slice(-scale).replace(/0+$/, '')
  return resultFraction ? `${resultWhole}.${resultFraction}` : resultWhole
}
