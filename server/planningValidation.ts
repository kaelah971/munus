import {
  compareMoney,
  normalizeMoney,
  POCKET_TYPES,
  SPEND_RULE_CATEGORIES,
  type PocketAllocationDraft,
  type PocketDraft,
  type ReminderDraft,
  type ReminderStatus,
  type SpendRuleDraft,
} from '../src/domain/planning'
import type { Pocket, Reminder, SpendRule } from '../src/domain/planning'

export class PlanningValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlanningValidationError'
  }
}

export function parsePocketDraft(value: unknown): PocketDraft {
  const input = asRecord(value, 'Pocket body')
  const name = requiredString(input.name, 'name')
  const type = enumValue(input.type, POCKET_TYPES, 'type')
  const unit = enumValue(input.unit, ['NIM', 'NGN'] as const, 'unit')
  const targetAmount = positiveMoney(input.targetAmount, 'targetAmount')
  const deadline = optionalDate(input.deadline, 'deadline')

  if (name.length < 2 || name.length > 80) {
    throw new PlanningValidationError('Pocket name must be between 2 and 80 characters.')
  }

  return { name, type, unit, targetAmount, deadline }
}

export function parsePocketUpdate(value: unknown, current: Pocket): PocketDraft {
  const input = asRecord(value, 'Pocket body')
  const draft = parsePocketDraft({
    name: input.name ?? current.name,
    type: input.type ?? current.type,
    unit: input.unit ?? current.unit,
    targetAmount: input.targetAmount ?? current.targetAmount,
    deadline: input.deadline ?? current.deadline ?? '',
  })
  if (draft.unit !== current.unit && compareMoney(current.plannedAmount, '0') !== 0) {
    throw new PlanningValidationError('A pocket with planned amount cannot change unit.')
  }
  return draft
}

export function parseAllocation(value: unknown): PocketAllocationDraft {
  const input = asRecord(value, 'Allocation body')
  const note = optionalString(input.note, 'note')
  if (note.length > 240) throw new PlanningValidationError('Allocation note is too long.')

  return {
    amount: positiveMoney(input.amount, 'amount'),
    direction: enumValue(input.direction ?? 'allocation', ['allocation', 'reduction'] as const, 'direction'),
    note,
  }
}

export function parseReminderDraft(value: unknown, current?: Reminder): ReminderDraft {
  const input = asRecord(value, 'Reminder body')
  const linkedObjectType = enumValue(
    input.linkedObjectType ?? current?.linkedObjectType ?? 'standalone',
    ['pocket', 'standalone'] as const,
    'linkedObjectType',
  )
  const linkedObjectId = optionalString(input.linkedObjectId ?? current?.linkedObjectId, 'linkedObjectId')
  if (linkedObjectType === 'pocket' && !linkedObjectId) {
    throw new PlanningValidationError('Pocket reminders need a linked pocket.')
  }

  const title = requiredString(input.title ?? current?.title, 'title')
  if (title.length < 2 || title.length > 120) {
    throw new PlanningValidationError('Reminder title must be between 2 and 120 characters.')
  }

  const dueAt = requiredDate(input.dueAt ?? current?.dueAt, 'dueAt')
  const repeatRule = optionalString(input.repeatRule ?? current?.repeatRule, 'repeatRule')
  if (repeatRule && repeatRule !== 'weekly' && repeatRule !== 'monthly') {
    throw new PlanningValidationError('Repeat rule must be weekly, monthly, or blank.')
  }

  return { linkedObjectType, linkedObjectId, title, dueAt, repeatRule }
}

export function parseReminderStatus(value: unknown): ReminderStatus {
  return enumValue(value, ['open', 'done', 'dismissed'] as const, 'status')
}

export function parseSpendRuleDraft(value: unknown, current?: SpendRule): SpendRuleDraft {
  const input = asRecord(value, 'Spend rule body')
  return {
    category: enumValue(
      input.category ?? current?.category,
      SPEND_RULE_CATEGORIES,
      'category',
    ),
    limitAmount: positiveMoney(input.limitAmount ?? current?.limitAmount, 'limitAmount'),
    unit: enumValue(input.unit ?? current?.unit ?? 'NGN', ['NIM', 'NGN'] as const, 'unit'),
    period: enumValue(input.period ?? current?.period ?? 'monthly', ['weekly', 'monthly'] as const, 'period'),
    warningThreshold: integerRange(
      input.warningThreshold ?? current?.warningThreshold ?? 80,
      'warningThreshold',
      0,
      100,
    ),
    enabled: booleanValue(input.enabled ?? current?.enabled ?? true, 'enabled'),
  }
}

function positiveMoney(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new PlanningValidationError(`${field} must be a decimal string.`)
  try {
    return normalizeMoney(value, false)
  } catch (error) {
    throw new PlanningValidationError(error instanceof Error ? `${field}: ${error.message}` : `${field} is invalid.`)
  }
}

function optionalDate(value: unknown, field: string): string {
  if (value === undefined || value === null || value === '') return ''
  return requiredDate(value, field)
}

function requiredDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new PlanningValidationError(`${field} must be a valid date.`)
  }
  return new Date(value).toISOString()
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PlanningValidationError(`${field} is required.`)
  }
  return value.trim()
}

function optionalString(value: unknown, field: string): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new PlanningValidationError(`${field} must be a string.`)
  return value.trim()
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new PlanningValidationError(`${field} must be a boolean.`)
  return value
}

function integerRange(value: unknown, field: string, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new PlanningValidationError(`${field} must be an integer from ${min} to ${max}.`)
  }
  return value as number
}

function enumValue<T extends readonly string[]>(value: unknown, values: T, field: string): T[number] {
  if (typeof value !== 'string' || !values.includes(value)) {
    throw new PlanningValidationError(`${field} is not supported.`)
  }
  return value as T[number]
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PlanningValidationError(`${label} must be an object.`)
  }
  return value as Record<string, unknown>
}
