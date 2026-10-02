import { describe, expect, it, vi } from 'vitest'
import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import {
  formatNimFromLuna,
  initializeNimiqPay,
  loadNimiqWallet,
  requestNimiqAccounts,
  requestNimiqSignature,
  shortenNimiqAccount,
} from './nimiq'

describe('Nimiq Pay integration boundary', () => {
  it('initializes a provider without requesting account permission', async () => {
    const listAccounts = vi.fn().mockResolvedValue([
      'NQ12 3456 7890 1234 5678 9012 3456 7890 1234',
    ])
    const provider = { listAccounts } as unknown as NimiqProvider

    const state = await initializeNimiqPay({
      initialize: vi.fn().mockResolvedValue(provider),
    })

    expect(state.status).toBe('ready')
    expect(state.accounts).toEqual([])
    expect(listAccounts).not.toHaveBeenCalled()
  })

  it('requests accounts only through the explicit account operation', async () => {
    const account = 'NQ12 3456 7890 1234 5678 9012 3456 7890 1234'
    const listAccounts = vi.fn().mockResolvedValue([account])
    const provider = { listAccounts } as unknown as NimiqProvider
    const connection = { accounts: [], provider, status: 'ready' as const }

    await expect(requestNimiqAccounts(connection)).resolves.toEqual([account])
    expect(listAccounts).toHaveBeenCalledOnce()
  })

  it('surfaces account permission rejection without retrying', async () => {
    const listAccounts = vi.fn().mockRejectedValue(new Error('User cancelled the Nimiq Pay connection.'))
    const provider = { listAccounts } as unknown as NimiqProvider

    await expect(
      requestNimiqAccounts({ accounts: [], provider, status: 'ready' }),
    ).rejects.toThrow('User cancelled the Nimiq Pay connection.')
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

  it('loads the verified wallet address instead of the first connected account', async () => {
    const walletA = 'NQ01 wallet A'
    const walletB = 'NQ02 wallet B'
    const provider = {
      getBalance: vi.fn().mockResolvedValue(123456),
    } as unknown as NimiqProvider

    const state = await loadNimiqWallet({
      accounts: [walletA],
      provider,
      status: 'ready',
    }, walletB)

    expect(provider.getBalance).toHaveBeenCalledWith(walletB)
    expect(state).toMatchObject({ status: 'available', address: walletB, nimBalance: '1.23456' })
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

  it('rejects a malformed provider signature response', async () => {
    const provider = {
      sign: vi.fn().mockResolvedValue({ publicKey: 'public-key' }),
    } as unknown as NimiqProvider

    await expect(
      requestNimiqSignature({ accounts: ['NQ01'], provider, status: 'ready' }, 'Munus login'),
    ).rejects.toThrow('Nimiq Pay did not return a usable challenge signature.')
  })

  it('can sign with a ready provider before account state is stored', async () => {
    const result = { publicKey: 'public-key', signature: 'signature' }
    const provider = { sign: vi.fn().mockResolvedValue(result) } as unknown as NimiqProvider

    await expect(
      requestNimiqSignature({ accounts: [], provider, status: 'ready' }, 'Munus login'),
    ).resolves.toEqual(result)
  })

  it('does not sign without a ready provider', async () => {
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
