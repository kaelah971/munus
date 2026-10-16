// @vitest-environment node
import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import {
  isTransactionHash,
  NimiqChainError,
  normalizeHash,
  RpcNimiqChainReader,
  verifyNimPayment,
  type ChainTransaction,
  type NimPaymentExpectation,
} from './nimiqChain'

function address(): string {
  return KeyPair.generate().toAddress().toUserFriendlyAddress()
}

const RECEIVER = address()
const SENDER = address()
const HASH = 'ab'.repeat(32)

function transaction(overrides: Partial<ChainTransaction> = {}): ChainTransaction {
  return {
    hash: HASH,
    from: SENDER,
    to: RECEIVER,
    valueLuna: '250000000',
    networkId: 42,
    blockNumber: 100,
    confirmations: 3,
    dataFields: ['MNS:9a6b18d778a6'],
    ...overrides,
  }
}

function expectation(overrides: Partial<NimPaymentExpectation> = {}): NimPaymentExpectation {
  return {
    transactionHash: HASH,
    receiver: RECEIVER,
    lunaAmount: '250000000',
    network: 'mainnet',
    memo: 'MNS:9a6b18d778a6',
    ...overrides,
  }
}

describe('Nimiq chain verification', () => {
  it('accepts an exact verified transaction with chain-derived evidence', () => {
    const result = verifyNimPayment(transaction(), 103, expectation())

    expect(result).toEqual({
      ok: true,
      evidence: {
        transactionHash: HASH,
        sender: SENDER,
        receiver: RECEIVER,
        lunaAmount: '250000000',
        blockNumber: '100',
        confirmations: 3,
      },
    })
  })

  it('accepts hex-encoded memo form and derives confirmations from the head', () => {
    const hexMemo = Buffer.from('MNS:9a6b18d778a6', 'utf8').toString('hex')
    const result = verifyNimPayment(
      transaction({ dataFields: [`0x${hexMemo}`], confirmations: 0 }),
      105,
      expectation(),
    )

    expect(result).toEqual(expect.objectContaining({ ok: true }))
    if (result.ok) expect(result.evidence.confirmations).toBe(5)
  })

  it('keeps missing and unconfirmed transactions pending, never failed', () => {
    expect(verifyNimPayment(null, 103, expectation())).toEqual({ ok: false, reason: 'not-found' })
    expect(verifyNimPayment(transaction({ blockNumber: null }), 103, expectation()))
      .toEqual({ ok: false, reason: 'pending' })
    expect(verifyNimPayment(transaction({ blockNumber: 103, confirmations: 0 }), 103, expectation()))
      .toEqual({ ok: false, reason: 'pending' })
    // Head unavailable: uncertainty stays pending, never success.
    expect(verifyNimPayment(transaction({ confirmations: 0 }), null, expectation()))
      .toEqual({ ok: false, reason: 'pending' })
  })

  it('rejects wrong receiver, amount, and memo affirmatively', () => {
    expect(verifyNimPayment(transaction({ to: address() }), 103, expectation()))
      .toEqual({ ok: false, reason: 'wrong-recipient' })
    expect(verifyNimPayment(transaction({ valueLuna: '250000001' }), 103, expectation()))
      .toEqual({ ok: false, reason: 'wrong-amount' })
    expect(verifyNimPayment(transaction({ dataFields: ['MNS:deadbeef1234'] }), 103, expectation()))
      .toEqual({ ok: false, reason: 'wrong-memo' })
    // Absent memo data cannot bind the payment: fail closed.
    expect(verifyNimPayment(transaction({ dataFields: [] }), 103, expectation()))
      .toEqual({ ok: false, reason: 'wrong-memo' })
  })

  it('accepts a chain-confirmed transaction regardless of its wallet-origin networkId', () => {
    // Production proof (2026-10-16): a transaction confirmed on mainnet
    // (block + confirmations from the mainnet RPC, exact recipient,
    // amount, and memo) carried networkId 24 from its signing wallet.
    // Chain membership is the network oracle — the label must never
    // strand real funds. A genuinely foreign submission is simply
    // absent from this chain (not-found → pending, never PAID).
    const foreign = verifyNimPayment(transaction({ networkId: 24 }), 103, expectation())
    expect(foreign).toEqual({
      ok: true,
      evidence: expect.objectContaining({ receiver: RECEIVER, lunaAmount: '250000000' }),
    })
    const unlabeled = verifyNimPayment(transaction({ networkId: undefined }), 103, expectation())
    expect(unlabeled).toEqual(expect.objectContaining({ ok: true }))
  })

  it('reads raw RPC payloads into normalized chain evidence', async () => {
    const calls: string[] = []
    const reader = new RpcNimiqChainReader('https://rpc.example', async (url, body) => {
      calls.push(`${url} ${body}`)
      const request = JSON.parse(body) as { method: string; params: unknown[] }
      if (request.method === 'getTransactionByHash') {
        return {
          jsonrpc: '2.0',
          id: 1,
          result: {
            hash: HASH,
            from: SENDER,
            to: RECEIVER,
            value: 250000000,
            networkId: 42,
            blockNumber: 100,
            confirmations: 3,
            data: 'MNS:9a6b18d778a6',
          },
        }
      }
      return { jsonrpc: '2.0', id: 1, result: 103 }
    })

    expect(await reader.getTransaction(HASH)).toEqual({
      hash: HASH,
      from: SENDER,
      to: RECEIVER,
      valueLuna: '250000000',
      networkId: 42,
      blockNumber: 100,
      confirmations: 3,
      dataFields: ['MNS:9a6b18d778a6'],
    })
    expect(await reader.getHeadBlockNumber()).toBe(103)
    expect(calls[0]).toContain('getTransactionByHash')
    expect(calls).toHaveLength(2)
  })

  it('accepts the production { data, metadata } result envelope', async () => {
    // Observed live (getBlockNumber): result is an object whose payload
    // sits under `data`, not a bare scalar.
    const blockReader = new RpcNimiqChainReader('https://rpc.example', async () => ({
      jsonrpc: '2.0',
      id: 1,
      result: { data: 64262141, metadata: { source: 'node' } },
    }))
    expect(await blockReader.getHeadBlockNumber()).toBe(64262141)
    // Same envelope around a transaction: unwrapped, memo `data` intact.
    const txReader = new RpcNimiqChainReader('https://rpc.example', async () => ({
      jsonrpc: '2.0',
      id: 1,
      result: {
        data: {
          hash: HASH,
          from: SENDER,
          to: RECEIVER,
          value: 250000000,
          blockNumber: 100,
          confirmations: 3,
          data: 'MNS:9a6b18d778a6',
        },
        metadata: { source: 'node' },
      },
    }))
    expect(await txReader.getTransaction(HASH)).toMatchObject({
      hash: HASH,
      valueLuna: '250000000',
      dataFields: ['MNS:9a6b18d778a6'],
    })
  })

  it('treats missing, error, and transport RPC results as retryable', async () => {
    const missing = new RpcNimiqChainReader('https://rpc.example', async () => ({ jsonrpc: '2.0', id: 1, result: null }))
    expect(await missing.getTransaction(HASH)).toBeNull()
    const rpcError = new RpcNimiqChainReader('https://rpc.example', async () => ({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'invalid' } }))
    await expect(rpcError.getTransaction(HASH)).rejects.toBeInstanceOf(NimiqChainError)
    const down = new RpcNimiqChainReader('https://rpc.example', async () => { throw new Error('reset') })
    await expect(down.getHeadBlockNumber()).rejects.toBeInstanceOf(NimiqChainError)
    const malformed = new RpcNimiqChainReader('https://rpc.example', async () => ({ jsonrpc: '2.0', id: 1, result: { hash: HASH } }))
    await expect(malformed.getTransaction(HASH)).rejects.toBeInstanceOf(NimiqChainError)
  })

  it('reads account balances through the observed RPC envelope', async () => {
    // Observed live: getAccountByAddress answers
    // { result: { data: { address, balance, type }, metadata } }.
    const reader = new RpcNimiqChainReader('https://rpc.example', async () => ({
      jsonrpc: '2.0',
      id: 1,
      result: { data: { address: 'NQ12 3456', balance: 22100000, type: 'basic' }, metadata: { source: 'node' } },
    }))
    expect(await reader.getAccountBalance('NQ12 3456')).toBe('22100000')
    const zeroed = new RpcNimiqChainReader('https://rpc.example', async () => ({
      jsonrpc: '2.0',
      id: 1,
      result: { data: { address: 'NQ12 3456', balance: 0, type: 'basic' }, metadata: {} },
    }))
    expect(await zeroed.getAccountBalance('NQ12 3456')).toBe('0')
  })

  it('rejects unreadable account payloads without inventing zero', async () => {
    const cases: unknown[] = [
      { jsonrpc: '2.0', id: 1, result: null },
      { jsonrpc: '2.0', id: 1, result: { data: { address: 'NQ12', type: 'basic' }, metadata: {} } },
      { jsonrpc: '2.0', id: 1, result: { data: { address: 'NQ12', balance: -5, type: 'basic' }, metadata: {} } },
      { jsonrpc: '2.0', id: 1, result: { data: { address: 'NQ12', balance: 'many', type: 'basic' }, metadata: {} } },
      { jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'invalid' } },
    ]
    for (const payload of cases) {
      const reader = new RpcNimiqChainReader('https://rpc.example', async () => payload)
      await expect(reader.getAccountBalance('NQ12')).rejects.toBeInstanceOf(NimiqChainError)
    }
  })

  it('validates transaction hash shape', () => {
    expect(isTransactionHash(HASH)).toBe(true)
    expect(isTransactionHash(`0x${HASH}`)).toBe(true)
    expect(isTransactionHash('xyz')).toBe(false)
    expect(isTransactionHash('')).toBe(false)
    expect(normalizeHash(`0X${HASH.toUpperCase()}`)).toBe(HASH)
  })
})
