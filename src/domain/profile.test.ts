import { beforeEach, describe, expect, it } from 'vitest'
import {
  createProfile,
  DEFAULT_PROFILE_DRAFT,
  updateProfile,
  validateProfileDraft,
} from './profile'
import { LocalProfileStore } from '../persistence/profileStore'

describe('Munus profile foundation', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('validates and persists the minimum profile context', () => {
    const profile = createProfile(
      'user-1',
      {
        ...DEFAULT_PROFILE_DRAFT,
        displayName: 'Ada',
        defaultPhone: '08012345678',
        defaultNetwork: 'MTN',
      },
      '2026-01-01T00:00:00.000Z',
    )
    const store = new LocalProfileStore(window.localStorage)
    store.save(profile)

    expect(store.get('user-1')).toEqual(profile)
    expect(profile.preferredPaymentAsset).toBe('NIM')
  })

  it('rejects unnecessary or malformed profile input and supports edits', () => {
    expect(validateProfileDraft({ ...DEFAULT_PROFILE_DRAFT, displayName: 'A' })).toMatch(/two characters/)
    expect(validateProfileDraft({ ...DEFAULT_PROFILE_DRAFT, displayName: 'Ada', defaultPhone: 'not-phone' })).toMatch(/valid phone/)

    const profile = createProfile('user-1', { ...DEFAULT_PROFILE_DRAFT, displayName: 'Ada' })
    const updated = updateProfile(
      profile,
      { ...DEFAULT_PROFILE_DRAFT, displayName: 'Ada N.' },
      '2026-01-01T00:00:01.000Z',
    )
    expect(updated.displayName).toBe('Ada N.')
    expect(updated.createdAt).toBe(profile.createdAt)
    expect(updated.updatedAt).not.toBe(profile.updatedAt)
  })
})
