import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Paycrest Sender API v2 integration for USDT → NGN cash-out.
 *
 * Endpoint shapes below are ASSUMPTIONS drawn from the Paycrest v2
 * concepts (sender orders, rates, verify-account, HMAC webhooks). They
 * are isolated behind this module's injectable fetch boundary and must
 * be confirmed against current Paycrest docs before any live movement.
 * Fixtures define behavior until then; no live funds move in tests.
 */
export const PAYCREST_BASE_URL = 'https://api.paycrest.io'
export const PAYCREST_ORDERS_PATH = '/v2/sender/orders'
export const PAYCREST_INSTITUTIONS_PATH = '/v2/institutions/NGN'
export const PAYCREST_VERIFY_ACCOUNT_PATH = '/v2/verify-account'
export const PAYCREST_WEBHOOK_SIGNATURE_HEADER = 'x-paycrest-signature'

export class PaycrestError extends Error {
  constructor(message: string, readonly statusCode = 502) {
    super(message)
    this.name = 'PaycrestError'
  }
}

export interface PaycrestCredentials {
  apiKey: string
  apiSecret: string
}

export interface PaycrestFetchInit {
  method: string
  body?: string
  headers?: Record<string, string>
}

export type PaycrestFetchJson = (url: string, init: PaycrestFetchInit) => Promise<unknown>

export interface PaycrestInstitution {
  code: string
  name: string
}

export interface PaycrestRatePreview {
  rateNgnPerUsdt: string
  source: string
  observedAt: string
}

export interface PaycrestCreateOrderInput {
  reference: string
  refundAddress: string
  institution: string
  accountNumber: string
  accountName: string
  amountUsdt: string
}

export interface PaycrestCreatedOrder {
  paycrestOrderId: string
  receiveAddress: string
  validUntil: string
  amountUsdt: string
  senderFeeUsdt: string
  transactionFeeUsdt: string
  totalUsdt: string
  /** Authoritative NGN payout from the create response, when provided. */
  payoutNgnAmount?: string
  status: string
}

export type PaycrestOutcome =
  | 'pending'
  | 'processing'
  | 'settled'
  | 'refunded'
  | 'expired'
  | 'failed'
  | 'unknown'

export interface PaycrestOrderRecord {
  paycrestOrderId: string
  status: string
  outcome: PaycrestOutcome
}

export interface PaycrestClientOptions {
  credentials: PaycrestCredentials
  baseUrl?: string
  fetchJson?: PaycrestFetchJson
  now?: () => number
}

export class PaycrestClient {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly fetchJson: PaycrestFetchJson
  private readonly now: () => number

  constructor(options: PaycrestClientOptions) {
    if (!options.credentials.apiKey) {
      throw new PaycrestError('Paycrest credentials are not configured.', 503)
    }
    this.apiKey = options.credentials.apiKey
    this.baseUrl = (options.baseUrl ?? PAYCREST_BASE_URL).replace(/\/$/, '')
    this.fetchJson = options.fetchJson ?? defaultFetchJson
    this.now = options.now ?? Date.now
  }

  async listInstitutions(): Promise<PaycrestInstitution[]> {
    const body = await this.requestJson('GET', `${this.baseUrl}${PAYCREST_INSTITUTIONS_PATH}`)
    return normalizeInstitutions(extractArray(body, ['institutions', 'banks', 'data', 'result']))
  }

  async verifyAccount(input: { institution: string; accountNumber: string }): Promise<{ accountName: string }> {
    const body = await this.requestJson('POST', `${this.baseUrl}${PAYCREST_VERIFY_ACCOUNT_PATH}`, {
      institution: input.institution,
      accountIdentifier: input.accountNumber,
    })
    const record = asRecord(body, 'verify-account')
    // A canonical name is required: an "OK"-style result without a name
    // cannot bind this order to a verified recipient, so fail closed.
    const nested = record.data && typeof record.data === 'object' && !Array.isArray(record.data)
      ? (record.data as Record<string, unknown>)
      : null
    const accountName = (nested ? pickField(nested, ['accountName', 'account_name', 'name']) : null)
      ?? pickField(record, ['accountName', 'account_name', 'data', 'name'])
    if (!accountName) {
      throw new PaycrestError('Bank account could not be verified. No cash-out order was created.')
    }
    return { accountName }
  }

  async getSellRate(usdtAmount: string): Promise<PaycrestRatePreview> {
    const body = await this.requestJson(
      'GET',
      `${this.baseUrl}/v2/rates/polygon/usdt/${encodeURIComponent(usdtAmount)}/ngn`,
    )
    const record = asRecord(body, 'rate preview')
    const rate = pickNumber(record, ['rate', 'price', 'sellRate', 'sell_rate'])
    if (!rate || !(Number(rate) > 0)) {
      throw new PaycrestError('Live cash-out rate is unavailable. No quote was created.')
    }
    return { rateNgnPerUsdt: String(rate), source: 'paycrest', observedAt: new Date(this.now()).toISOString() }
  }

  async createOrder(input: PaycrestCreateOrderInput): Promise<PaycrestCreatedOrder> {
    const body = await this.requestJson('POST', `${this.baseUrl}${PAYCREST_ORDERS_PATH}`, {
      reference: input.reference,
      refundAddress: input.refundAddress,
      source: { type: 'crypto', currency: 'USDT', network: 'polygon' },
      destination: {
        type: 'fiat',
        currency: 'NGN',
        recipient: {
          institution: input.institution,
          accountIdentifier: input.accountNumber,
          accountName: input.accountName,
        },
      },
      amount: input.amountUsdt,
    })
    const record = asRecord(body, 'create order')
    // The final wallet transfer amount comes from this response only:
    // an explicit total, else the exact sum of provider components.
    const total = pickField(record, ['totalAmount', 'total', 'amountToSend', 'amount_to_send'])
      ?? sumExact([
        pickField(record, ['amount', 'sourceAmount', 'source_amount']),
        pickField(record, ['senderFee', 'sender_fee', 'fee']),
        pickField(record, ['transactionFee', 'transaction_fee', 'networkFee', 'network_fee']),
      ])
    const paycrestOrderId = pickField(record, ['id', 'orderId', 'orderID'])
    const receiveAddress = pickField(record, ['receiveAddress', 'receivingAddress', 'depositAddress', 'address'])
    const validUntil = pickField(record, ['validUntil', 'valid_until', 'expiresAt', 'expires_at'])
    if (!paycrestOrderId || !receiveAddress || !validUntil || !total) {
      throw new PaycrestError('Paycrest order is incomplete. No cash-out order was created.')
    }
    const destination = record.destination && typeof record.destination === 'object' && !Array.isArray(record.destination)
      ? (record.destination as Record<string, unknown>)
      : null
    return {
      paycrestOrderId,
      receiveAddress,
      validUntil,
      amountUsdt: pickField(record, ['amount', 'sourceAmount', 'source_amount']) ?? input.amountUsdt,
      senderFeeUsdt: pickField(record, ['senderFee', 'sender_fee', 'fee']) ?? '0',
      transactionFeeUsdt: pickField(record, ['transactionFee', 'transaction_fee', 'networkFee', 'network_fee']) ?? '0',
      totalUsdt: total,
      payoutNgnAmount: destination ? pickField(destination, ['amount', 'fiatAmount', 'fiat_amount', 'ngnAmount']) : undefined,
      status: pickField(record, ['status', 'orderStatus']) ?? 'initiated',
    }
  }

  async getOrder(paycrestOrderId: string): Promise<PaycrestOrderRecord> {
    const body = await this.requestJson('GET', `${this.baseUrl}${PAYCREST_ORDERS_PATH}/${encodeURIComponent(paycrestOrderId)}`)
    const record = asRecord(body, 'order lookup')
    // Providers often nest the order under data/order; accept both.
    const nested = record.data && typeof record.data === 'object' && !Array.isArray(record.data)
      ? (record.data as Record<string, unknown>)
      : record
    const status = pickField(nested, ['status', 'orderStatus', 'state']) ?? pickField(record, ['status', 'orderStatus', 'state']) ?? ''
    const id = pickField(nested, ['id', 'orderId', 'orderID']) ?? paycrestOrderId
    return { paycrestOrderId: id, status, outcome: classifyPaycrestOutcome(status) }
  }

  private async requestJson(method: string, url: string, body?: Record<string, unknown>): Promise<unknown> {
    let payload: unknown
    try {
      payload = await this.fetchJson(url, {
        method,
        // Auth scheme assumption: Bearer API key header. Confirm against
        // current Paycrest docs before live use; header auth keeps secrets
        // out of URLs and logs either way.
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch (error) {
      if (error instanceof PaycrestError) throw error
      // Never surface raw URLs, keys, or provider internals.
      throw new PaycrestError('Paycrest request failed. No cash-out state changed.')
    }
    return payload
  }
}

/**
 * Conservative status mapping. Anything outside the documented shapes is
 * `unknown` (keep waiting / needs attention), never success and never a
 * fabricated refund.
 */
export function classifyPaycrestOutcome(status: string | undefined): PaycrestOutcome {
  const normalized = (status ?? '').trim().toLowerCase()
  if (normalized === 'settled') return 'settled'
  if (normalized === 'refunded') return 'refunded'
  if (normalized === 'expired') return 'expired'
  if (normalized === 'failed' || normalized === 'failure' || normalized === 'cancelled') return 'failed'
  if (normalized === 'validated' || normalized === 'processing' || normalized === 'confirmed') return 'processing'
  if (normalized === 'initiated' || normalized === 'pending' || normalized === '') return 'pending'
  return 'unknown'
}

export interface PaycrestWebhookEvent {
  paycrestOrderId: string
  status: string
}

/**
 * Extracts the order reference from a webhook payload. Lenient about
 * nesting (top-level or under data/order); strict about presence — an
 * unrecognized payload reconciles nothing.
 */
export function parsePaycrestWebhookEvent(body: unknown): PaycrestWebhookEvent | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const record = body as Record<string, unknown>
  const nested = record.data && typeof record.data === 'object' && !Array.isArray(record.data)
    ? (record.data as Record<string, unknown>)
    : null
  const paycrestOrderId = pickField(nested ?? {}, ['id', 'orderId', 'orderID'])
    ?? pickField(record, ['id', 'orderId', 'orderID', 'reference'])
  const status = pickField(nested ?? {}, ['status', 'orderStatus', 'state'])
    ?? pickField(record, ['status', 'orderStatus', 'state', 'event'])
  if (!paycrestOrderId || !status) return null
  return { paycrestOrderId, status }
}

/**
 * Verifies a Paycrest webhook HMAC-SHA256 signature computed over the RAW
 * request body. Any failure — missing secret, missing/garbled signature,
 * length mismatch — rejects without mutating anything.
 */
export function verifyPaycrestWebhookSignature(input: {
  rawBody: string | Buffer
  signatureHeader: string | number | string[] | undefined
  apiSecret: string
}): boolean {
  if (!input.apiSecret) return false
  const presented = Array.isArray(input.signatureHeader) ? input.signatureHeader[0] : input.signatureHeader
  if (typeof presented !== 'string' || presented.trim() === '') return false
  try {
    const expected = createHmac('sha256', input.apiSecret).update(input.rawBody).digest('hex').toLowerCase()
    const actual = presented.trim().toLowerCase().replace(/^0x/, '')
    if (expected.length !== actual.length) return false
    return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(actual, 'utf8'))
  } catch {
    return false
  }
}

function sumExact(parts: Array<string | undefined>): string | undefined {
  let scale = 0
  const parsed: Array<{ digits: bigint; scale: number } | null> = parts.map((part) => {
    if (part === undefined) return null
    const match = /^(\d+)(?:\.(\d+))?$/.exec(part.trim())
    if (!match) return null
    return { digits: BigInt(match[1] + (match[2] ?? '')), scale: (match[2] ?? '').length }
  })
  if (parsed.some((part) => part === null)) return undefined
  for (const part of parsed) scale = Math.max(scale, (part as { scale: number }).scale)
  let total = 0n
  for (const part of parsed) {
    const known = part as { digits: bigint; scale: number }
    total += known.digits * 10n ** BigInt(scale - known.scale)
  }
  if (scale === 0) return total.toString()
  const raw = total.toString().padStart(scale + 1, '0')
  const whole = raw.slice(0, -scale)
  const fraction = raw.slice(-scale).replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PaycrestError(`Paycrest ${label} is unreadable. No cash-out state changed.`)
  }
  return value as Record<string, unknown>
}

function extractArray(body: unknown, keys: string[]): unknown[] {
  if (Array.isArray(body)) return body
  if (!body || typeof body !== 'object') {
    throw new PaycrestError('Paycrest response is unreadable. No cash-out state changed.')
  }
  const lower = new Map(Object.entries(body).map(([key, value]) => [key.toLowerCase(), value]))
  for (const key of keys) {
    const value = lower.get(key.toLowerCase())
    if (Array.isArray(value)) return value
  }
  throw new PaycrestError('Paycrest response is unreadable. No cash-out state changed.')
}

function normalizeInstitutions(entries: unknown[]): PaycrestInstitution[] {
  const institutions: PaycrestInstitution[] = []
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    const code = pickField(record, ['code', 'bankCode', 'bank_code', 'id'])
    const name = pickField(record, ['name', 'bankName', 'bank_name', 'label'])
    if (!code || !name) continue
    if (institutions.some((item) => item.code === code)) continue
    institutions.push({ code, name })
  }
  return institutions
}

function pickField(body: Record<string, unknown>, names: string[]): string | undefined {
  const lower = new Map(Object.entries(body).map(([key, value]) => [key.toLowerCase(), value]))
  for (const name of names) {
    const value = lower.get(name.toLowerCase())
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return undefined
}

function pickNumber(body: Record<string, unknown>, names: string[]): number | undefined {
  const lower = new Map(Object.entries(body).map(([key, value]) => [key.toLowerCase(), value]))
  for (const name of names) {
    const value = lower.get(name.toLowerCase())
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value.trim()))) {
      return Number(value.trim())
    }
  }
  return undefined
}

async function defaultFetchJson(url: string, init: PaycrestFetchInit): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
    })
  } catch {
    throw new PaycrestError('Paycrest request failed. No cash-out state changed.')
  }
  if (!response.ok) throw new PaycrestError('Paycrest request failed. No cash-out state changed.')
  try {
    return (await response.json()) as unknown
  } catch {
    throw new PaycrestError('Paycrest response is unreadable. No cash-out state changed.')
  }
}
