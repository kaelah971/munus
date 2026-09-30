import { describe, expect, it } from 'vitest'
import {
  calculateSupportWarning,
  canTransitionSupportRequest,
  maskPhone,
  normalizePhone,
} from './support'

describe('Munus support semantics', () => {
  it('normalizes phones and masks public contact data', () => {
    expect(normalizePhone('080 1234 5678')).toBe('08012345678')
    expect(maskPhone('08012345678')).toBe('080•••5678')
    expect(maskPhone('+2348012345678')).toBe('+23•••5678')
  })

  it('warns from planned support amounts without inventing spend', () => {
    const rule = { softLimitAmount: '1000', warningThreshold: 80, enabled: true }
    expect(calculateSupportWarning(rule, '700')).toBe('none')
    expect(calculateSupportWarning(rule, '800')).toBe('warning')
    expect(calculateSupportWarning(rule, '1000')).toBe('limit')
  })

  it('keeps request lifecycle transitions truthful', () => {
    expect(canTransitionSupportRequest('pending', 'approved')).toBe(true)
    expect(canTransitionSupportRequest('pending', 'cancelled')).toBe(true)
    expect(canTransitionSupportRequest('approved', 'prepared')).toBe(true)
    expect(canTransitionSupportRequest('prepared', 'pending')).toBe(false)
    expect(canTransitionSupportRequest('declined', 'approved')).toBe(false)
  })
})
