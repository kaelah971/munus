import { describe, expect, it, beforeEach } from 'vitest'
import {
  clearHostAccounts,
  normalizeHostAddress,
  readHostAccounts,
  saveHostAccounts,
} from './hostAccounts'

describe('host account persistence', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('round-trips the exposed set per user without touching auth state', () => {
    expect(readHostAccounts('user-1')).toBeNull()
    saveHostAccounts('user-1', ['NQ47 1111', 'NQ48 2222'])
    expect(readHostAccounts('user-1')).toMatchObject({
      userId: 'user-1',
      addresses: ['NQ47 1111', 'NQ48 2222'],
    })
    expect(readHostAccounts('user-2')).toBeNull()
  })

  it('overwrites on fresh Connect and clears on sign-out', () => {
    saveHostAccounts('user-1', ['NQ47 1111'])
    saveHostAccounts('user-1', ['NQ48 2222'])
    expect(readHostAccounts('user-1')?.addresses).toEqual(['NQ48 2222'])
    clearHostAccounts('user-1')
    expect(readHostAccounts('user-1')).toBeNull()
  })

  it('tolerates corrupt storage without throwing', () => {
    window.localStorage.setItem('munus:host-accounts', 'not-json{')
    expect(readHostAccounts('user-1')).toBeNull()
    saveHostAccounts('user-1', ['NQ47 1111'])
    expect(readHostAccounts('user-1')?.addresses).toEqual(['NQ47 1111'])
  })

  it('normalizes addresses for comparison only', () => {
    expect(normalizeHostAddress('NQ47 1111 2222')).toBe('NQ4711112222')
    expect(normalizeHostAddress('nq47 1111')).toBe('NQ471111')
  })
})
