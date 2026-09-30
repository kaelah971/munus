export const POCKET_TYPES = [
  'Data',
  'Light bill',
  'Rent',
  'School',
  'Medical',
  'Emergency',
  'Transport',
  'Family support',
  'Business',
  'Subscription',
  'Custom',
] as const

export const SPEND_RULE_CATEGORIES = [
  'Data',
  'Family support',
  'Subscriptions',
  'Transport',
  'General essentials',
] as const

export type PocketType = (typeof POCKET_TYPES)[number]
export type SpendRuleCategory = (typeof SPEND_RULE_CATEGORIES)[number]
export type PlanningUnit = 'NIM' | 'NGN'
export type PocketStatus = 'active' | 'completed' | 'archived'
export type PocketEntryDirection = 'allocation' | 'reduction'
export type ReminderStatus = 'open' | 'done' | 'dismissed'
export type ReminderLinkType = 'pocket' | 'standalone'
export type SpendRulePeriod = 'weekly' | 'monthly'
export type SpendWarningState = 'none' | 'warning' | 'limit'

export interface Pocket {
  id: string
  userId: string
  name: string
  type: PocketType
  unit: PlanningUnit
  targetAmount: string
  plannedAmount: string
  deadline?: string
  status: PocketStatus
  archivedAt?: string
  createdAt: string
  updatedAt: string
}

export interface PocketDraft {
  name: string
  type: PocketType
  unit: PlanningUnit
  targetAmount: string
  deadline: string
}

export interface PocketEntry {
  id: string
  pocketId: string
  userId: string
  amount: string
  direction: PocketEntryDirection
  note?: string
  createdAt: string
}

export interface PocketAllocationDraft {
  amount: string
  direction: PocketEntryDirection
  note: string
}

export interface Reminder {
  id: string
  userId: string
  linkedObjectType: ReminderLinkType
  linkedObjectId?: string
  title: string
  dueAt: string
  repeatRule?: string
  status: ReminderStatus
  createdAt: string
  updatedAt: string
}

export interface ReminderDraft {
  linkedObjectType: ReminderLinkType
  linkedObjectId: string
  title: string
  dueAt: string
  repeatRule: string
}

export interface SpendRule {
  id: string
  userId: string
  category: SpendRuleCategory
  limitAmount: string
  unit: PlanningUnit
  period: SpendRulePeriod
  warningThreshold: number
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface SpendRuleDraft {
  category: SpendRuleCategory
  limitAmount: string
  unit: PlanningUnit
  period: SpendRulePeriod
  warningThreshold: number
  enabled: boolean
}

export interface PlanningData {
  pockets: Pocket[]
  reminders: Reminder[]
  spendRules: SpendRule[]
}

const MAX_DECIMAL_SCALE = 8

export function normalizeMoney(value: string, allowZero = true): string {
  const parsed = parseMoney(value)
  if (!allowZero && parsed.digits === 0n) {
    throw new Error('Amount must be greater than zero.')
  }
  return formatParsedMoney(parsed)
}

export function compareMoney(left: string, right: string): number {
  const a = parseMoney(left)
  const b = parseMoney(right)
  const scale = Math.max(a.scale, b.scale)
  const leftDigits = a.digits * 10n ** BigInt(scale - a.scale)
  const rightDigits = b.digits * 10n ** BigInt(scale - b.scale)
  return leftDigits === rightDigits ? 0 : leftDigits > rightDigits ? 1 : -1
}

export function addMoney(left: string, right: string): string {
  const a = parseMoney(left)
  const b = parseMoney(right)
  const scale = Math.max(a.scale, b.scale)
  return formatParsedMoney({
    digits:
      a.digits * 10n ** BigInt(scale - a.scale) +
      b.digits * 10n ** BigInt(scale - b.scale),
    scale,
  })
}

export function subtractMoney(left: string, right: string): string {
  if (compareMoney(left, right) < 0) {
    throw new Error('Planned amount cannot become negative.')
  }

  const a = parseMoney(left)
  const b = parseMoney(right)
  const scale = Math.max(a.scale, b.scale)
  return formatParsedMoney({
    digits:
      a.digits * 10n ** BigInt(scale - a.scale) -
      b.digits * 10n ** BigInt(scale - b.scale),
    scale,
  })
}

export function calculatePocketProgress(targetAmount: string, plannedAmount: string): number {
  if (compareMoney(targetAmount, '0') <= 0) return 0
  const target = parseMoney(targetAmount)
  const planned = parseMoney(plannedAmount)
  const scale = Math.max(target.scale, planned.scale)
  const targetDigits = target.digits * 10n ** BigInt(scale - target.scale)
  const plannedDigits = planned.digits * 10n ** BigInt(scale - planned.scale)
  const basisPoints = (plannedDigits * 10_000n) / targetDigits
  return Math.min(100, Number(basisPoints) / 100)
}

export function calculatePocketStatus(pocket: Pick<Pocket, 'status' | 'targetAmount' | 'plannedAmount'>): PocketStatus {
  if (pocket.status === 'archived') return 'archived'
  return compareMoney(pocket.plannedAmount, pocket.targetAmount) >= 0 ? 'completed' : 'active'
}

export function getPocketNextAction(pocket: Pick<Pocket, 'targetAmount' | 'plannedAmount' | 'status'>): string {
  const status = calculatePocketStatus(pocket)
  if (status === 'completed') return 'Review your plan'
  if (compareMoney(pocket.plannedAmount, '0') === 0) return 'Add allocation'
  return 'Keep planning'
}

export function advanceReminderDueAt(dueAt: string, repeatRule?: string): string {
  const date = new Date(dueAt)
  if (Number.isNaN(date.getTime()) || !repeatRule) return dueAt
  if (repeatRule === 'weekly') date.setUTCDate(date.getUTCDate() + 7)
  if (repeatRule === 'monthly') date.setUTCMonth(date.getUTCMonth() + 1)
  return date.toISOString()
}

export function isDueSoon(dueAt: string, now = Date.now(), windowDays = 7): boolean {
  const due = Date.parse(dueAt)
  if (!Number.isFinite(due)) return false
  return due >= now && due <= now + windowDays * 24 * 60 * 60 * 1000
}

export function calculateSpendWarning(
  rule: Pick<SpendRule, 'limitAmount' | 'warningThreshold' | 'enabled'>,
  plannedAmount: string,
): SpendWarningState {
  if (!rule.enabled) return 'none'
  const planned = normalizeMoney(plannedAmount)
  if (compareMoney(planned, rule.limitAmount) >= 0) return 'limit'

  const threshold = normalizeMoney(
    multiplyMoney(rule.limitAmount, rule.warningThreshold, 100),
  )
  return compareMoney(planned, threshold) >= 0 ? 'warning' : 'none'
}

export function formatPlanningAmount(amount: string, unit: PlanningUnit): string {
  return `${normalizeMoney(amount)} ${unit}`
}

function multiplyMoney(value: string, numerator: number, denominator: number): string {
  const parsed = parseMoney(value)
  return formatParsedMoney({
    digits: (parsed.digits * BigInt(numerator)) / BigInt(denominator),
    scale: parsed.scale,
  })
}

function parseMoney(value: string): { digits: bigint; scale: number } {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value.trim())) {
    throw new Error('Amount must be a non-negative decimal string.')
  }

  const [whole, fraction = ''] = value.trim().split('.')
  if (fraction.length > MAX_DECIMAL_SCALE) {
    throw new Error(`Amount cannot have more than ${MAX_DECIMAL_SCALE} decimal places.`)
  }

  return {
    digits: BigInt(`${whole}${fraction}`),
    scale: fraction.length,
  }
}

function formatParsedMoney(value: { digits: bigint; scale: number }): string {
  if (value.digits === 0n) return '0'
  const raw = value.digits.toString().padStart(value.scale + 1, '0')
  if (value.scale === 0) return raw

  const whole = raw.slice(0, -value.scale) || '0'
  const fraction = raw.slice(-value.scale).replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole
}
