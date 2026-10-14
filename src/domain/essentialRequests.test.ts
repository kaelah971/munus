import { describe, expect, it } from 'vitest'
import {
  buildEssentialShareText,
  canTransitionEssential,
  describeEssentialNeed,
  describeEssentialStatusCopy,
  displayEssentialStatus,
  isClaimableEssential,
  isEssentialExpired,
  isEssentialTerminal,
  toPublicEssentialRequest,
  type EssentialRequest,
} from './essentialRequests'

function row(overrides: Partial<EssentialRequest> = {}): EssentialRequest {
  return {
    id: 'req-1',
    ownerUserId: 'user-a',
    publicRequestId: 'pub-1',
    serviceType: 'AIRTIME',
    network: 'MTN',
    requestedAmount: '1000',
    recipientPhone: '08012345678',
    essentialStatus: 'OPEN',
    expiresAt: '2099-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('essential request domain', () => {
  it('guards the social lifecycle without duplicating payment states', () => {
    expect(canTransitionEssential('OPEN', 'PAYMENT_IN_PROGRESS')).toBe(true)
    expect(canTransitionEssential('OPEN', 'PAID')).toBe(true)
    expect(canTransitionEssential('OPEN', 'COMPLETED')).toBe(false)
    expect(canTransitionEssential('PAYMENT_IN_PROGRESS', 'PAID')).toBe(true)
    expect(canTransitionEssential('PAYMENT_IN_PROGRESS', 'OPEN')).toBe(true)
    expect(canTransitionEssential('PAYMENT_IN_PROGRESS', 'COMPLETED')).toBe(false)
    expect(canTransitionEssential('PAID', 'FULFILLING')).toBe(true)
    expect(canTransitionEssential('PAID', 'COMPLETED')).toBe(false)
    expect(canTransitionEssential('FULFILLING', 'COMPLETED')).toBe(true)
    expect(canTransitionEssential('FULFILLING', 'NEEDS_ATTENTION')).toBe(true)
    expect(canTransitionEssential('NEEDS_ATTENTION', 'COMPLETED')).toBe(true)
    expect(canTransitionEssential('NEEDS_ATTENTION', 'PAID')).toBe(false)
    expect(canTransitionEssential('COMPLETED', 'OPEN')).toBe(false)
    expect(canTransitionEssential('CANCELLED', 'OPEN')).toBe(false)
    expect(canTransitionEssential('OPEN', 'OPEN')).toBe(true)
    expect(isEssentialTerminal('COMPLETED')).toBe(true)
    expect(isEssentialTerminal('CANCELLED')).toBe(true)
    expect(isEssentialTerminal('EXPIRED')).toBe(true)
    expect(isEssentialTerminal('OPEN')).toBe(false)
  })

  it('reads expiry without mutating rows', () => {
    const expired = row({ expiresAt: '2020-01-01T00:00:00.000Z' })
    expect(displayEssentialStatus(expired, Date.parse('2026-01-01T00:00:00.000Z'))).toBe('EXPIRED')
    expect(displayEssentialStatus(row(), Date.parse('2026-01-01T00:00:00.000Z'))).toBe('OPEN')
    expect(isEssentialExpired(expired, Date.parse('2026-01-01T00:00:00.000Z'))).toBe(true)
  })

  it('admits exactly one live claim at a time', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z')
    expect(isClaimableEssential(row(), now)).toBe(true)
    expect(isClaimableEssential(row({ expiresAt: '2020-01-01T00:00:00.000Z' }), now)).toBe(false)
    expect(isClaimableEssential(row({
      essentialStatus: 'PAYMENT_IN_PROGRESS',
      paymentOrderId: 'ord-1',
      claimExpiresAt: '2026-01-01T00:05:00.000Z',
    }), now)).toBe(false)
    expect(isClaimableEssential(row({
      essentialStatus: 'PAYMENT_IN_PROGRESS',
      paymentOrderId: 'ord-1',
      claimExpiresAt: '2025-12-31T00:00:00.000Z',
    }), now)).toBe(true)
    expect(isClaimableEssential(row({ essentialStatus: 'COMPLETED' }), now)).toBe(false)
  })

  it('summarizes needs and labels statuses for humans', () => {
    expect(describeEssentialNeed(row())).toBe('₦1000 MTN airtime')
    expect(describeEssentialNeed(row({
      serviceType: 'DATA',
      planDataAllowance: '1.5 GB',
      planValidity: '7 days',
    }))).toBe('1.5 GB MTN data (₦1000 · 7 days)')
    expect(describeEssentialStatusCopy('NEEDS_ATTENTION')).toEqual({ label: 'Needs attention', tone: 'attention' })
  })

  it('projects only privacy-safe fields and shares without secrets', () => {
    const projection = toPublicEssentialRequest(
      row({ message: 'Need airtime for work', paymentOrderId: 'ord-1', ownerUserId: 'user-secret' }),
      'Kaelah',
    )
    expect(projection).toMatchObject({
      publicRequestId: 'pub-1',
      requesterLabel: 'Kaelah',
      recipientMasked: '080•••5678',
      message: 'Need airtime for work',
    })
    const serialized = JSON.stringify(projection)
    expect(serialized).not.toContain('08012345678')
    expect(serialized).not.toContain('user-secret')
    expect(serialized).not.toContain('ord-1')
    const share = buildEssentialShareText({ needSummary: describeEssentialNeed(row()), linkUrl: 'https://munus.example/request/pub-1' })
    expect(share).toContain('https://munus.example/request/pub-1')
    expect(share).not.toContain('08012345678')
  })
})
