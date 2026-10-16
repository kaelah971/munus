import { describe, expect, it, vi } from 'vitest'
import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import {
  formatNimFromLuna,
  initializeNimiqPay,
  loadNimiqWallet,
  requestNimiqAccounts,
  requestNimiqSignature,
  requestNimPayment,
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

  it('surfaces provider error objects with their message instead of a generic failure', async () => {
    const provider = {
      getBalance: vi.fn().mockResolvedValue({ error: { type: 'Address', message: 'Invalid address format.' } }),
    } as unknown as NimiqProvider

    const state = await loadNimiqWallet({
      accounts: ['NQ01'],
      provider,
      status: 'ready',
    })

    expect(state).toMatchObject({ status: 'error', address: 'NQ01', error: 'Invalid address format.' })
  })

  it('retries the compact address spelling after a verbatim failure and records it', async () => {
    const getBalance = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('Invalid address format.'), { type: 'Address' }))
      .mockResolvedValueOnce(22100000)
    const provider = { getBalance } as unknown as NimiqProvider

    const state = await loadNimiqWallet({
      accounts: ['NQ00 other account'],
      provider,
      status: 'ready',
    }, 'NQ47 1234 5678')

    expect(getBalance).toHaveBeenCalledTimes(2)
    expect(getBalance).toHaveBeenNthCalledWith(1, 'NQ47 1234 5678')
    expect(getBalance).toHaveBeenNthCalledWith(2, 'NQ4712345678')
    expect(state).toMatchObject({ status: 'available', nimBalance: '221', address: 'NQ47 1234 5678' })
    expect(state.debug).toMatchObject({ ok: true, addressVariant: 'compact', addressSource: 'session', addressSuffix: '5678', balanceType: 'number' })
  })

  it('captures thrown provider error type, message, and code for diagnostics', async () => {
    const thrown = Object.assign(new Error('Unknown request.'), { name: 'NimiqProviderError', type: 'UNKNOWN_REQUEST', code: 4200 })
    const provider = { getBalance: vi.fn().mockRejectedValue(thrown) } as unknown as NimiqProvider

    const state = await loadNimiqWallet({
      accounts: ['NQ47 1234'],
      provider,
      status: 'ready',
    }, 'NQ471234')

    expect(state).toMatchObject({ status: 'error', error: 'Unknown request.' })
    expect(state.debug).toMatchObject({
      ok: false,
      addressVariant: 'none',
      errorName: 'UNKNOWN_REQUEST',
      errorMessage: 'Unknown request.',
      errorCode: 4200,
      hostNetworkPresent: false,
    })
  })

  it('rejects unreadable balance envelopes without inventing a value', async () => {
    const provider = { getBalance: vi.fn().mockResolvedValue({ data: 22100000 }) } as unknown as NimiqProvider

    const state = await loadNimiqWallet({
      accounts: ['NQ47 1234'],
      provider,
      status: 'ready',
    }, 'NQ471234')

    expect(state.status).toBe('error')
    expect(state).not.toHaveProperty('lunaBalance')
    expect(state.debug).toMatchObject({ ok: false, balanceType: 'object' })
  })

  it('uses RPC fallback without a ready provider when the session wallet is known', async () => {
    const getBalance = vi.fn()
    const fetchRpcBalance = vi.fn().mockResolvedValue({ lunaBalance: 500, nimBalance: '0.005', network: 'mainnet' as const })

    const state = await loadNimiqWallet(
      { accounts: [], status: 'unavailable' as const },
      'NQ47 1234 5678',
      fetchRpcBalance,
    )

    expect(getBalance).not.toHaveBeenCalled()
    expect(fetchRpcBalance).toHaveBeenCalledOnce()
    expect(state).toMatchObject({
      status: 'available',
      address: 'NQ47 1234 5678',
      lunaBalance: 500,
      nimBalance: '0.005',
      network: 'mainnet',
      balanceSource: 'rpc',
    })
    expect(state.debug).toMatchObject({ ok: true, balanceSource: 'rpc', rpcOk: true })
  })

  it('stays unavailable without a provider when no RPC fallback exists', async () => {
    const state = await loadNimiqWallet(
      { accounts: [], status: 'unavailable' as const },
      'NQ47 1234 5678',
    )

    expect(state).toMatchObject({ status: 'unavailable' })
    expect(state).not.toHaveProperty('lunaBalance')
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

  it('sends the exact quoted luna to the receiver with the order memo', async () => {
    const sendBasicTransactionWithData = vi.fn().mockResolvedValue('ab'.repeat(32))
    const provider = { sendBasicTransactionWithData } as unknown as NimiqProvider
    const intent = {
      receiver: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000',
      lunaAmount: '50000',
      memo: 'MNS:abc123def456',
    }

    await expect(
      requestNimPayment({ accounts: [], provider, status: 'ready' }, intent, 'mainnet'),
    ).resolves.toBe('ab'.repeat(32))
    expect(sendBasicTransactionWithData).toHaveBeenCalledOnce()
    expect(sendBasicTransactionWithData).toHaveBeenCalledWith({
      recipient: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000',
      value: 50000,
      data: 'MNS:abc123def456',
    })
  })

  it('never opens the wallet without a ready provider or a valid intent', async () => {
    const sendBasicTransactionWithData = vi.fn()
    const provider = { sendBasicTransactionWithData } as unknown as NimiqProvider
    const intent = { receiver: 'NQ07', lunaAmount: '50000', memo: 'MNS:abc123def456' }

    await expect(requestNimPayment({ accounts: [], status: 'unavailable' }, intent)).rejects.toThrow()
    await expect(requestNimPayment({ accounts: [], provider, status: 'ready' }, { ...intent, lunaAmount: '50.5' }, 'mainnet')).rejects.toThrow()
    await expect(requestNimPayment({ accounts: [], provider, status: 'ready' }, { ...intent, memo: '' }, 'mainnet')).rejects.toThrow()
    expect(sendBasicTransactionWithData).not.toHaveBeenCalled()
  })

  it('leaves rejection and malformed results without a usable hash', async () => {
    const rejected = {
      sendBasicTransactionWithData: vi.fn().mockRejectedValue(new Error('User cancelled the Nimiq Pay request.')),
    } as unknown as NimiqProvider
    await expect(
      requestNimPayment(
        { accounts: [], provider: rejected, status: 'ready' },
        { receiver: 'NQ07', lunaAmount: '50000', memo: 'MNS:abc123def456' },
        'mainnet',
      ),
    ).rejects.toThrow('User cancelled the Nimiq Pay request.')

    const errorResult = {
      sendBasicTransactionWithData: vi.fn().mockResolvedValue({
        error: { type: 'TRANSACTION_REJECTED', message: 'Payment was declined in Nimiq Pay.' },
      }),
    } as unknown as NimiqProvider
    await expect(
      requestNimPayment(
        { accounts: [], provider: errorResult, status: 'ready' },
        { receiver: 'NQ07', lunaAmount: '50000', memo: 'MNS:abc123def456' },
        'mainnet',
      ),
    ).rejects.toThrow('Payment was declined in Nimiq Pay.')

    const malformed = {
      sendBasicTransactionWithData: vi.fn().mockResolvedValue({ hash: 'ab'.repeat(32) }),
    } as unknown as NimiqProvider
    await expect(
      requestNimPayment(
        { accounts: [], provider: malformed, status: 'ready' },
        { receiver: 'NQ07', lunaAmount: '50000', memo: 'MNS:abc123def456' },
        'mainnet',
      ),
    ).rejects.toThrow(/usable transaction reference/)
  })

  it('refuses to open wallet approval unless the host network is provably mainnet', async () => {
    const sendBasicTransactionWithData = vi.fn()
    const provider = { sendBasicTransactionWithData } as unknown as NimiqProvider
    const intent = { receiver: 'NQ07', lunaAmount: '50000', memo: 'MNS:abc123def456' }
    // Testnet host: fail closed before any wallet prompt.
    await expect(
      requestNimPayment({ accounts: [], provider, status: 'ready' }, intent, 'testnet'),
    ).rejects.toThrow(/must be on Mainnet/)
    // Unprovable host network: also fail closed.
    await expect(
      requestNimPayment({ accounts: [], provider, status: 'ready' }, intent, 'unknown'),
    ).rejects.toThrow(/must be on Mainnet/)
    expect(sendBasicTransactionWithData).not.toHaveBeenCalled()
  })

  it('formats luna without floating-point conversion', () => {
    expect(formatNimFromLuna(100_000)).toBe('1')
    expect(formatNimFromLuna(1)).toBe('0.00001')
    expect(shortenNimiqAccount('NQ12 3456 7890 1234 5678 9012 3456 7890 1234')).toBe(
      'NQ123456…901234',
    )
  })
})
