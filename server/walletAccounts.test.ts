// @vitest-environment node
import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import {
  InMemoryWalletAccountStore,
  MAX_WALLET_ACCOUNTS,
  WalletAccountError,
  normalizeAccountSet,
} from './walletAccounts'

function address(): string {
  return KeyPair.generate().toAddress().toUserFriendlyAddress()
}

describe('wallet account set', () => {
  it('normalizes spelling and deduplicates host-exposed addresses', () => {
    const first = address()
    const compact = first.replace(/\s+/g, '')
    expect(normalizeAccountSet([first, compact.toLowerCase(), `  ${first}  `])).toEqual([first])
  })

  it('rejects non-lists, bad entries, oversized sets, and invalid addresses', () => {
    expect(() => normalizeAccountSet('nope')).toThrow(WalletAccountError)
    expect(() => normalizeAccountSet([])).not.toThrow()
    expect(() => normalizeAccountSet([''])).toThrow(WalletAccountError)
    expect(() => normalizeAccountSet(['not-an-address'])).toThrow(WalletAccountError)
    expect(() => normalizeAccountSet(new Array(MAX_WALLET_ACCOUNTS + 1).fill(address()))).toThrow(
      WalletAccountError,
    )
  })

  it('scopes each set to its canonical user and replaces atomically', async () => {
    const store = new InMemoryWalletAccountStore()
    const first = address()
    const second = address()
    await expect(store.replaceAccounts('user-a', [first, second])).resolves.toEqual([first, second])
    await expect(store.listAccounts('user-a')).resolves.toEqual([first, second])
    await expect(store.listAccounts('user-b')).resolves.toEqual([])
    await expect(store.replaceAccounts('user-a', [second])).resolves.toEqual([second])
    await expect(store.listAccounts('user-a')).resolves.toEqual([second])
  })
})
