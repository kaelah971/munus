import { Address } from '@nimiq/core'
import { NIMIQ_MAINNET_NETWORK_ID } from '../src/domain/orders'

export interface ChainTransaction {
  hash: string
  from: string
  to: string
  /** Exact integer string in luna. */
  valueLuna: string
  networkId?: number
  blockNumber: number | null
  confirmations: number
  /** Raw candidate memo strings from the RPC payload. */
  dataFields: string[]
}

export interface NimiqChainReader {
  getTransaction(hash: string): Promise<ChainTransaction | null>
  getHeadBlockNumber(): Promise<number>
  /**
   * Confirmed account balance in integer luna (canonical decimal string).
   * Read-only; used for display fallback, never for payment proof.
   */
  getAccountBalance(address: string): Promise<string>
}

export type ChainReaderFetch = (url: string, body: string) => Promise<unknown>

export class NimiqChainError extends Error {
  constructor(message: string, readonly statusCode = 503) {
    super(message)
    this.name = 'NimiqChainError'
  }
}

/**
 * Nimiq JSON-RPC chain reader (`getTransactionByHash`, `getBlockNumber`)
 * against a configured node. Transport and RPC errors always throw — the
 * caller must treat them as retryable uncertainty, never as failure.
 */
export class RpcNimiqChainReader implements NimiqChainReader {
  constructor(
    private readonly rpcUrl: string,
    private readonly postJson: ChainReaderFetch = defaultPostJson,
  ) {
    if (!rpcUrl.trim()) throw new NimiqChainError('Nimiq RPC endpoint is not configured.')
  }

  async getTransaction(hash: string): Promise<ChainTransaction | null> {
    const result = await this.call('getTransactionByHash', [hash])
    if (result === null || result === undefined) return null
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new NimiqChainError('Nimiq chain returned an unreadable transaction.')
    }
    return parseChainTransaction(result as Record<string, unknown>)
  }

  async getHeadBlockNumber(): Promise<number> {
    const result = await this.call('getBlockNumber', [])
    if (typeof result !== 'number' || !Number.isSafeInteger(result) || result < 0) {
      throw new NimiqChainError('Nimiq chain returned an unreadable block number.')
    }
    return result
  }

  async getAccountBalance(address: string): Promise<string> {
    const result = await this.call('getAccountByAddress', [address])
    // call() already unwraps the observed { data, metadata } envelope for
    // payloads without a transaction hash; account objects carry none.
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new NimiqChainError('Nimiq chain returned an unreadable account.')
    }
    const balance = (result as Record<string, unknown>).balance
    if (typeof balance === 'number') {
      if (!Number.isSafeInteger(balance) || balance < 0) {
        throw new NimiqChainError('Nimiq chain returned an unreadable account.')
      }
      return String(balance)
    }
    if (typeof balance === 'string' && /^\d{1,24}$/.test(balance.trim())) {
      return balance.trim().replace(/^0+(?=\d)/, '')
    }
    throw new NimiqChainError('Nimiq chain returned an unreadable account.')
  }

  private async call(method: string, params: unknown[]): Promise<unknown> {
    let payload: unknown
    try {
      payload = await this.postJson(
        this.rpcUrl,
        JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      )
    } catch {
      throw new NimiqChainError('Nimiq chain is unreachable. Verification will retry.')
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new NimiqChainError('Nimiq chain returned an unreadable response.')
    }
    const body = payload as { error?: unknown; result?: unknown }
    if (body.error !== undefined && body.error !== null) {
      throw new NimiqChainError('Nimiq chain rejected the lookup. Verification will retry.')
    }
    return unwrapResultEnvelope(body.result) ?? null
  }
}

/**
 * Accepts the observed production envelope `{ data, metadata }` (e.g.
 * getBlockNumber answers `result.data`) while preserving bare scalars and
 * bare transaction objects. A bare transaction carries its memo in `data`
 * alongside `hash`, so anything with a string `hash` is never unwrapped.
 */
function unwrapResultEnvelope(result: unknown): unknown {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result
  const record = result as Record<string, unknown>
  if (!Object.hasOwn(record, 'data')) return result
  if (typeof record.hash === 'string') return result
  return record.data
}

function parseChainTransaction(record: Record<string, unknown>): ChainTransaction {
  const hash = typeof record.hash === 'string' ? record.hash : ''
  const from = typeof record.from === 'string' ? record.from : ''
  const to = typeof record.to === 'string' ? record.to : ''
  const valueLuna = toIntegerString(record.value)
  const hasBlockNumber = record.blockNumber !== null && record.blockNumber !== undefined
  const blockNumber = hasBlockNumber ? toSafeInteger(record.blockNumber) : null
  const confirmations = record.confirmations === undefined ? 0 : toSafeInteger(record.confirmations)
  const networkId = typeof record.networkId === 'number' && Number.isSafeInteger(record.networkId)
    ? record.networkId
    : undefined
  if (!isTransactionHash(hash) || !from || !to || valueLuna === null) {
    throw new NimiqChainError('Nimiq chain returned an unreadable transaction.')
  }
  if (hasBlockNumber && blockNumber === null) {
    throw new NimiqChainError('Nimiq chain returned an unreadable transaction.')
  }
  if (record.confirmations !== undefined && confirmations === null) {
    throw new NimiqChainError('Nimiq chain returned an unreadable transaction.')
  }
  return {
    hash: normalizeHash(hash),
    from,
    to,
    valueLuna,
    networkId,
    blockNumber,
    confirmations: confirmations ?? 0,
    dataFields: collectDataFields(record),
  }
}

function toIntegerString(value: unknown): string | null {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) return null
    return String(value)
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return value.trim().replace(/^0+(?=\d)/, '')
  return null
}

function toSafeInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return null
  return value
}

function collectDataFields(record: Record<string, unknown>): string[] {
  const fields: string[] = []
  for (const key of ['data', 'recipientData', 'senderData', 'extraData']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim() !== '') fields.push(value.trim())
    else if (value && typeof value === 'object' && !Array.isArray(value)) {
      const raw = (value as Record<string, unknown>).raw ?? (value as Record<string, unknown>).data
      if (typeof raw === 'string' && raw.trim() !== '') fields.push(raw.trim())
    }
  }
  return fields
}

async function defaultPostJson(url: string, body: string): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body,
    })
  } catch {
    throw new NimiqChainError('Nimiq chain is unreachable. Verification will retry.')
  }
  if (!response.ok) throw new NimiqChainError('Nimiq chain is unreachable. Verification will retry.')
  try {
    return (await response.json()) as unknown
  } catch {
    throw new NimiqChainError('Nimiq chain returned an unreadable response.')
  }
}

export function isTransactionHash(value: unknown): value is string {
  return typeof value === 'string' && /^(0x)?[0-9a-fA-F]{64}$/.test(value.trim())
}

export function normalizeHash(value: string): string {
  return value.trim().replace(/^0x/i, '').toLowerCase()
}

export function normalizeChainAddress(value: string): string {
  return Address.fromAny(value).toUserFriendlyAddress()
}

export interface NimPaymentExpectation {
  transactionHash: string
  receiver: string
  lunaAmount: string
  network: 'mainnet' | 'testnet'
  memo: string
}

export interface NimPaymentEvidence {
  transactionHash: string
  sender: string
  receiver: string
  lunaAmount: string
  blockNumber: string
  confirmations: number
}

export type ChainVerification =
  | { ok: true; evidence: NimPaymentEvidence }
  | { ok: false; reason: 'not-found' | 'pending' | 'wrong-network' | 'wrong-recipient' | 'wrong-amount' | 'wrong-memo' }

/**
 * Compares independent chain evidence against the quote expectation.
 * Affirmative mismatches fail the payment; anything uncertain (`not-found`,
 * `pending`) must stay retryable and must never become success.
 */
export function verifyNimPayment(
  transaction: ChainTransaction | null,
  headBlockNumber: number | null,
  expectation: NimPaymentExpectation,
): ChainVerification {
  if (!transaction) return { ok: false, reason: 'not-found' }

  if (
    expectation.network === 'mainnet' &&
    transaction.networkId !== undefined &&
    transaction.networkId !== NIMIQ_MAINNET_NETWORK_ID
  ) {
    return { ok: false, reason: 'wrong-network' }
  }

  let actualReceiver: string
  try {
    actualReceiver = normalizeChainAddress(transaction.to)
  } catch {
    return { ok: false, reason: 'pending' }
  }
  let expectedReceiver: string
  try {
    expectedReceiver = normalizeChainAddress(expectation.receiver)
  } catch {
    return { ok: false, reason: 'pending' }
  }
  if (actualReceiver !== expectedReceiver) return { ok: false, reason: 'wrong-recipient' }

  let actualLuna: bigint
  let expectedLuna: bigint
  try {
    actualLuna = BigInt(transaction.valueLuna)
    expectedLuna = BigInt(expectation.lunaAmount)
  } catch {
    return { ok: false, reason: 'pending' }
  }
  if (actualLuna !== expectedLuna) return { ok: false, reason: 'wrong-amount' }

  if (!memoMatches(transaction.dataFields, expectation.memo)) {
    return { ok: false, reason: 'wrong-memo' }
  }

  if (transaction.blockNumber === null) return { ok: false, reason: 'pending' }
  const confirmations = transaction.confirmations > 0
    ? transaction.confirmations
    : headBlockNumber !== null && headBlockNumber > transaction.blockNumber
      ? headBlockNumber - transaction.blockNumber
      : 0
  if (confirmations < 1) return { ok: false, reason: 'pending' }

  let sender: string
  try {
    sender = normalizeChainAddress(transaction.from)
  } catch {
    return { ok: false, reason: 'pending' }
  }
  return {
    ok: true,
    evidence: {
      transactionHash: normalizeHash(transaction.hash),
      sender,
      receiver: actualReceiver,
      lunaAmount: expectedLuna.toString(),
      blockNumber: String(transaction.blockNumber),
      confirmations,
    },
  }
}

function memoMatches(dataFields: string[], memo: string): boolean {
  // The client always sends the memo via sendBasicTransactionWithData, so an
  // absent data field means the binding is unverifiable — fail closed.
  if (dataFields.length === 0) return false
  const expectedUtf8 = memo.toLowerCase()
  const expectedHex = Buffer.from(memo, 'utf8').toString('hex')
  return dataFields.some((field) => {
    const candidate = field.replace(/^0x/i, '').toLowerCase()
    return candidate === expectedUtf8 || candidate === expectedHex
  })
}
