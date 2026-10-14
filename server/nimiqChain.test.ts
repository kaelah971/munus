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

  it('rejects wrong receiver, amount, network, and memo affirmatively', () => {
    expect(verifyNimPayment(transaction({ to: address() }), 103, expectation()))
      .toEqual({ ok: false, reason: 'wrong-recipient' })
    expect(verifyNimPayment(transaction({ valueLuna: '250000001' }), 103, expectation()))
      .toEqual({ ok: false, reason: 'wrong-amount' })
    expect(verifyNimPayment(transaction({ networkId: 53 }), 103, expectation()))
      .toEqual({ ok: false, reason: 'wrong-network' })
    expect(verifyNimPayment(transaction({ dataFields: ['MNS:deadbeef1234'] }), 103, expectation()))
      .toEqual({ ok: false, reason: 'wrong-memo' })
    // Absent memo data cannot bind the payment: fail closed.
    expect(verifyNimPayment(transaction({ dataFields: [] }), 103, expectation()))
      .toEqual({ ok: false, reason: 'wrong-memo' })
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

  it('validates transaction hash shape', () => {
    expect(isTransactionHash(HASH)).toBe(true)
    expect(isTransactionHash(`0x${HASH}`)).toBe(true)
    expect(isTransactionHash('xyz')).toBe(false)
    expect(isTransactionHash('')).toBe(false)
    expect(normalizeHash(`0X${HASH.toUpperCase()}`)).toBe(HASH)
  })
})
