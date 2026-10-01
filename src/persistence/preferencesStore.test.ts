import { beforeEach, describe, expect, it } from 'vitest'
import { LocalPreferencesStore } from './preferencesStore'

describe('balance visibility preferences', () => {
  beforeEach(() => localStorage.clear())

  it('defaults existing profiles to visible balances without losing other preferences', () => {
    localStorage.setItem('munus:preferences:ada', JSON.stringify({ userId: 'ada', notificationsEnabled: false, appLockEnabled: true }))
    expect(new LocalPreferencesStore(localStorage).get('ada')).toEqual({ userId: 'ada', notificationsEnabled: false, appLockEnabled: true, hideBalances: false })
  })

  it('persists balance visibility for one user only', () => {
    const store = new LocalPreferencesStore(localStorage)
    store.save({ ...store.get('ada'), hideBalances: true })
    expect(store.get('ada').hideBalances).toBe(true)
    expect(store.get('obi').hideBalances).toBe(false)
  })
})
