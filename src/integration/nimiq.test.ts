import { describe, expect, it, vi } from 'vitest'
import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import {
  formatNimFromLuna,
  initializeNimiqPay,
  loadNimiqWallet,
  requestNimiqSignature,
  shortenNimiqAccount,
} from './nimiq'

describe('Nimiq Pay integration boundary', () => {
  it('lists the account only after a provider is initialized', async () => {
    const listAccounts = vi.fn().mockResolvedValue([
      'NQ12 3456 7890 1234 5678 9012 3456 7890 1234',
    ])
    const provider = { listAccounts } as unknown as NimiqProvider

    const state = await initializeNimiqPay({
      initialize: vi.fn().mockResolvedValue(provider),
    })

    expect(state.status).toBe('ready')
    expect(state.accounts).toEqual([
      'NQ12 3456 7890 1234 5678 9012 3456 7890 1234',
    ])
    expect(listAccounts).toHaveBeenCalledOnce()
  })

  it('keeps browser/provider failures truthful', async () => {
    const unavailable = await initializeNimiqPay({
      initialize: vi
        .fn()
        .mockRejectedValue(
          new Error('Nimiq provider was not injected. Are you running inside a Nimiq app?'),
        ),
    })
    const error = await initializeNimiqPay({
      initialize: vi.fn().mockRejectedValue(new Error('Wallet request was rejected.')),
    })

    expect(unavailable).toEqual({ status: 'unavailable', accounts: [] })
    expect(error).toMatchObject({ status: 'error', error: 'Wallet request was rejected.' })
  })

  it('loads a real zero balance distinctly from a positive balance', async () => {
    const address = 'NQ12 3456 7890 1234 5678 9012 3456 7890 1234'
    const provider = {
      getBalance: vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(123456),
    } as unknown as NimiqProvider
    const connection = { accounts: [address], provider, status: 'ready' as const }

    const zero = await loadNimiqWallet(connection)
    const available = await loadNimiqWallet(connection)

    expect(zero).toMatchObject({ status: 'zero', address, lunaBalance: 0, nimBalance: '0' })
    expect(available).toMatchObject({
      status: 'available',
      address,
      lunaBalance: 123456,
      nimBalance: '1.23456',
    })
  })

  it('returns an error state when balance retrieval fails', async () => {
    const provider = {
      getBalance: vi.fn().mockRejectedValue(new Error('consensus unavailable')),
    } as unknown as NimiqProvider

    const state = await loadNimiqWallet({
      accounts: ['NQ01'],
      provider,
      status: 'ready',
    })

    expect(state).toMatchObject({ status: 'error', error: 'consensus unavailable' })
  })

  it('does not sign without a ready account', async () => {
    await expect(
      requestNimiqSignature({ accounts: [], status: 'unavailable' }, 'Munus login'),
    ).rejects.toThrow(/connect a nimiq pay account/i)
  })

  it('surfaces a resolved Mini App ErrorResponse instead of accepting it as a signature', async () => {
    const provider = {
      sign: vi.fn().mockResolvedValue({
        error: { type: 'PERMISSION_DENIED', message: 'Signing was cancelled in Nimiq Pay.' },
      }),
    } as unknown as NimiqProvider

    await expect(
      requestNimiqSignature({ accounts: ['NQ01'], provider, status: 'ready' }, 'Munus login'),
    ).rejects.toThrow('Signing was cancelled in Nimiq Pay.')
  })

  it('preserves provider cancellation/rejection truthfully', async () => {
    const provider = {
      sign: vi.fn().mockRejectedValue(new Error('User cancelled the Nimiq Pay request.')),
    } as unknown as NimiqProvider

    await expect(
      requestNimiqSignature({ accounts: ['NQ01'], provider, status: 'ready' }, 'Munus login'),
    ).rejects.toThrow('User cancelled the Nimiq Pay request.')
  })

  it('formats luna without floating-point conversion', () => {
    expect(formatNimFromLuna(100_000)).toBe('1')
    expect(formatNimFromLuna(1)).toBe('0.00001')
    expect(shortenNimiqAccount('NQ12 3456 7890 1234 5678 9012 3456 7890 1234')).toBe(
      'NQ123456…901234',
    )
  })
})
