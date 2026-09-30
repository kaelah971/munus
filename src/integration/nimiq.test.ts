import { describe, expect, it, vi } from 'vitest'
import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import {
  initializeNimiqPay,
  shortenNimiqAccount,
} from './nimiq'

describe('Nimiq Pay integration boundary', () => {
  it('lists the account only after a provider is initialized', async () => {
    const listAccounts = vi.fn().mockResolvedValue([
      'NQ12 3456 7890 1234 5678 9012 3456 7890 1234',
    ])
    const sendBasicTransaction = vi.fn()
    const provider = {
      listAccounts,
      sendBasicTransaction,
    } as unknown as NimiqProvider

    const state = await initializeNimiqPay({
      initialize: vi.fn().mockResolvedValue(provider),
    })

    expect(state.status).toBe('ready')
    expect(state.accounts).toEqual([
      'NQ12 3456 7890 1234 5678 9012 3456 7890 1234',
    ])
    expect(listAccounts).toHaveBeenCalledOnce()
    expect(sendBasicTransaction).not.toHaveBeenCalled()
  })

  it('explains an injected-provider timeout as unavailable', async () => {
    const state = await initializeNimiqPay({
      initialize: vi
        .fn()
        .mockRejectedValue(
          new Error('Nimiq provider was not injected. Are you running inside a Nimiq app?'),
        ),
    })

    expect(state).toEqual({ status: 'unavailable', accounts: [] })
  })

  it('keeps provider errors distinct from browser unavailability', async () => {
    const state = await initializeNimiqPay({
      initialize: vi.fn().mockRejectedValue(new Error('Wallet request was rejected.')),
    })

    expect(state.status).toBe('error')
    expect(state.error).toBe('Wallet request was rejected.')
  })

  it('shortens only the visual account label', () => {
    const account = 'NQ12 3456 7890 1234 5678 9012 3456 7890 1234'

    expect(shortenNimiqAccount(account)).toBe('NQ123456…901234')
  })
})
