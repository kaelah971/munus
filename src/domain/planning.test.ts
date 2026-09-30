import { describe, expect, it } from 'vitest'
import {
  addMoney,
  calculatePocketProgress,
  calculatePocketStatus,
  advanceReminderDueAt,
  calculateSpendWarning,
  compareMoney,
  isDueSoon,
  normalizeMoney,
  subtractMoney,
} from './planning'

describe('Munus planning arithmetic', () => {
  it('keeps exact decimal allocation math without floats', () => {
    expect(normalizeMoney('001.230000')).toBe('1.23')
    expect(addMoney('0.1', '0.2')).toBe('0.3')
    expect(subtractMoney('10.00', '0.75')).toBe('9.25')
    expect(compareMoney('1.20', '1.2')).toBe(0)
    expect(() => subtractMoney('1', '1.01')).toThrow(/cannot become negative/i)
  })

  it('calculates target progress and completion', () => {
    expect(calculatePocketProgress('100', '25')).toBe(25)
    expect(calculatePocketProgress('100', '120')).toBe(100)
    expect(calculatePocketStatus({ status: 'active', targetAmount: '100', plannedAmount: '100' })).toBe('completed')
    expect(calculatePocketStatus({ status: 'archived', targetAmount: '100', plannedAmount: '100' })).toBe('archived')
  })

  it('calculates soft spend warnings from planned amounts only', () => {
    const rule = { limitAmount: '100', warningThreshold: 80, enabled: true }
    expect(calculateSpendWarning(rule, '79')).toBe('none')
    expect(calculateSpendWarning(rule, '80')).toBe('warning')
    expect(calculateSpendWarning(rule, '100')).toBe('limit')
    expect(calculateSpendWarning({ ...rule, enabled: false }, '1000')).toBe('none')
  })

  it('advances repeating reminders deterministically', () => {
    expect(advanceReminderDueAt('2026-01-01T00:00:00.000Z', 'weekly')).toBe('2026-01-08T00:00:00.000Z')
    expect(advanceReminderDueAt('2026-01-01T00:00:00.000Z', 'monthly')).toBe('2026-02-01T00:00:00.000Z')
  })

  it('recognizes reminders due in the next seven days', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z')
    expect(isDueSoon('2026-01-05T12:00:00.000Z', now)).toBe(true)
    expect(isDueSoon('2026-01-10T00:00:00.000Z', now)).toBe(false)
    expect(isDueSoon('2025-12-31T00:00:00.000Z', now)).toBe(false)
  })
})
