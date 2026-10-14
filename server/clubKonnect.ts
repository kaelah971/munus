import type {
  AirtimeProviderAdapter,
  AirtimeProviderOutcome,
  AirtimePurchaseInput,
  AirtimePurchaseReceipt,
  AirtimeQueryInput,
  AirtimeQueryRecord,
  DataProviderAdapter,
  DataPurchaseInput,
} from '../src/domain/orders'
import type { SupportNetwork } from '../src/domain/support'

export const CLUBKONNECT_PROVIDER_ID = 'clubkonnect'
export const CLUBKONNECT_BASE_URL = 'https://www.nellobytesystems.com'
export const CLUBKONNECT_AIRTIME_PATH = '/APIAirtimeV1.asp'
/** Purchase endpoint assumption: confirm against authenticated ClubKonnect docs before live use. */
export const CLUBKONNECT_DATA_PURCHASE_PATH = '/APIDatabundleV1.asp'
export const CLUBKONNECT_QUERY_PATH = '/APIQueryV1.asp'
export const CLUBKONNECT_CALLBACK_PATH = '/provider-callback/clubkonnect'

export const AIRTIME_MIN_NGN = 50
export const AIRTIME_MAX_NGN = 200000

/**
 * Munus network name → ClubKonnect MobileNetwork code. Provider codes never
 * leave this module: callers and UI only use Munus network names.
 */
const CLUBKONNECT_NETWORK_CODES: Record<SupportNetwork, string> = {
  MTN: '01',
  Glo: '02',
  '9mobile': '03',
  Airtel: '04',
}

export function clubKonnectNetworkCode(network: SupportNetwork): string {
  const code = CLUBKONNECT_NETWORK_CODES[network]
  if (!code) throw new ClubKonnectError('Mobile network is not supported by the airtime provider.', 400)
  return code
}

/**
 * One stable provider RequestID per Munus order, derived from the order
 * identity. Retries reuse it, so the provider de-duplicates and Munus never
 * double-purchases for the same logical fulfilment attempt.
 */
export function deriveProviderRequestId(orderId: string): string {
  const hex = orderId.replace(/[^0-9a-fA-F]/g, '')
  if (hex.length < 12) throw new ClubKonnectError('Payment order cannot be sent to the airtime provider.', 400)
  return hex
}

/** Whole-naira provider amount within the documented airtime bounds. */
export function toProviderAmount(requestedAmount: string): string {
  if (!/^\d+$/.test(requestedAmount)) {
    throw new ClubKonnectError(`Airtime amount must be whole naira from ₦${AIRTIME_MIN_NGN} to ₦${AIRTIME_MAX_NGN}.`, 400)
  }
  const amount = Number(requestedAmount)
  if (!Number.isSafeInteger(amount) || amount < AIRTIME_MIN_NGN || amount > AIRTIME_MAX_NGN) {
    throw new ClubKonnectError(`Airtime amount must be whole naira from ₦${AIRTIME_MIN_NGN} to ₦${AIRTIME_MAX_NGN}.`, 400)
  }
  return String(amount)
}

/** Digits-only MSISDN for the provider MobileNumber parameter. */
export function toProviderMsisdn(recipientPhone: string): string {
  const digits = recipientPhone.replace(/\D/g, '')
  if (digits.length < 10 || digits.length > 15) {
    throw new ClubKonnectError('Recipient phone number cannot be sent to the airtime provider.', 400)
  }
  return digits
}

export class ClubKonnectError extends Error {
  constructor(message: string, readonly statusCode = 502) {
    super(message)
    this.name = 'ClubKonnectError'
  }
}

export interface ClubKonnectCredentials {
  userId: string
  apiKey: string
}

/**
 * Minimal fetch boundary so tests can deterministically stub provider
 * responses. Implementations must resolve response JSON and reject on
 * transport or HTTP errors; the adapter sanitizes everything it surfaces.
 */
export type ClubKonnectFetchJson = (url: string) => Promise<unknown>

export interface ClubKonnectAdapterOptions {
  credentials: ClubKonnectCredentials
  baseUrl?: string
  fetchJson?: ClubKonnectFetchJson
}

export class ClubKonnectAirtimeProvider implements AirtimeProviderAdapter {
  readonly provider = CLUBKONNECT_PROVIDER_ID
  readonly serviceType = 'AIRTIME' as const
  private readonly credentials: ClubKonnectCredentials
  private readonly baseUrl: string
  private readonly fetchJson: ClubKonnectFetchJson

  constructor(options: ClubKonnectAdapterOptions) {
    if (!options.credentials.userId || !options.credentials.apiKey) {
      throw new ClubKonnectError('Airtime provider credentials are not configured.', 503)
    }
    this.credentials = options.credentials
    this.baseUrl = (options.baseUrl ?? CLUBKONNECT_BASE_URL).replace(/\/$/, '')
    this.fetchJson = options.fetchJson ?? defaultFetchJson
  }

  deriveRequestId(orderId: string): string {
    return deriveProviderRequestId(orderId)
  }

  networkCode(network: SupportNetwork): string {
    return clubKonnectNetworkCode(network)
  }

  buildPurchaseParams(input: AirtimePurchaseInput): Record<string, string> {
    if (!input.network) throw new ClubKonnectError('Mobile network is required for airtime fulfilment.', 400)
    return {
      UserID: this.credentials.userId,
      APIKey: this.credentials.apiKey,
      MobileNetwork: clubKonnectNetworkCode(input.network),
      Amount: toProviderAmount(input.amountNgn),
      MobileNumber: toProviderMsisdn(input.mobileNumber),
      RequestID: requiredField(input.requestId, 'RequestID'),
      CallBackURL: requiredField(input.callbackUrl, 'CallBackURL'),
    }
  }

  buildQueryParams(input: AirtimeQueryInput): Record<string, string> {
    if (!input.requestId && !input.providerOrderId) {
      throw new ClubKonnectError('A provider RequestID or OrderID is required to query airtime status.', 400)
    }
    const params: Record<string, string> = {
      UserID: this.credentials.userId,
      APIKey: this.credentials.apiKey,
    }
    if (input.requestId) params.RequestID = input.requestId
    if (input.providerOrderId) params.OrderID = input.providerOrderId
    return params
  }

  async purchase(input: AirtimePurchaseInput): Promise<AirtimePurchaseReceipt> {
    const url = withParams(`${this.baseUrl}${CLUBKONNECT_AIRTIME_PATH}`, this.buildPurchaseParams(input))
    const body = await this.requestJson(url)
    const statusCode = requiredField(pickField(body, ['statuscode']), 'provider status')
    const status = requiredField(pickField(body, ['status']), 'provider status')
    return {
      providerOrderId: pickField(body, ['orderid']),
      statusCode,
      status,
      remark: pickField(body, ['remark']),
    }
  }

  async query(input: AirtimeQueryInput): Promise<AirtimeQueryRecord> {
    const url = withParams(`${this.baseUrl}${CLUBKONNECT_QUERY_PATH}`, this.buildQueryParams(input))
    const body = await this.requestJson(url)
    const statusCode = pickField(body, ['statuscode'])
    const status = pickField(body, ['status'])
    if (!statusCode && !status) return { statusCode: '', status: '', outcome: 'not-found' }
    return {
      providerOrderId: pickField(body, ['orderid']),
      requestId: pickField(body, ['requestid']),
      statusCode: statusCode ?? '',
      status: status ?? '',
      remark: pickField(body, ['remark', 'orderremark', 'orderstatus']),
      amountCharged: pickField(body, ['amountcharged']),
      outcome: classifyOutcome(statusCode, status),
    }
  }

  private async requestJson(url: string): Promise<Record<string, unknown>> {
    let payload: unknown
    try {
      payload = await this.fetchJson(url)
    } catch {
      // Never surface raw URLs (they carry credentials as GET params).
      throw new ClubKonnectError('Airtime provider request failed. No airtime was confirmed.')
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new ClubKonnectError('Airtime provider returned an unreadable response. No airtime was confirmed.')
    }
    return payload as Record<string, unknown>
  }
}

/**
 * DATA fulfilment behind the same provider architecture as airtime:
 * deterministic RequestID, reserve-before-purchase, query-before-repurchase,
 * and the shared status query + outcome mapping. Only the purchase payload
 * differs (provider plan id instead of a naira amount).
 */
export class ClubKonnectDataProvider implements DataProviderAdapter {
  readonly provider = CLUBKONNECT_PROVIDER_ID
  readonly serviceType = 'DATA' as const
  private readonly credentials: ClubKonnectCredentials
  private readonly baseUrl: string
  private readonly fetchJson: ClubKonnectFetchJson

  constructor(options: ClubKonnectAdapterOptions) {
    if (!options.credentials.userId || !options.credentials.apiKey) {
      throw new ClubKonnectError('Data provider credentials are not configured.', 503)
    }
    this.credentials = options.credentials
    this.baseUrl = (options.baseUrl ?? CLUBKONNECT_BASE_URL).replace(/\/$/, '')
    this.fetchJson = options.fetchJson ?? defaultFetchJson
  }

  deriveRequestId(orderId: string): string {
    return deriveProviderRequestId(orderId)
  }

  networkCode(network: SupportNetwork): string {
    return clubKonnectNetworkCode(network)
  }

  buildPurchaseParams(input: DataPurchaseInput): Record<string, string> {
    if (!input.network) throw new ClubKonnectError('Mobile network is required for data fulfilment.', 400)
    return {
      UserID: this.credentials.userId,
      APIKey: this.credentials.apiKey,
      MobileNetwork: clubKonnectNetworkCode(input.network),
      DataPlan: requiredField(input.providerPlanId, 'DataPlan'),
      MobileNumber: toProviderMsisdn(input.mobileNumber),
      RequestID: requiredField(input.requestId, 'RequestID'),
      CallBackURL: requiredField(input.callbackUrl, 'CallBackURL'),
    }
  }

  buildQueryParams(input: AirtimeQueryInput): Record<string, string> {
    if (!input.requestId && !input.providerOrderId) {
      throw new ClubKonnectError('A provider RequestID or OrderID is required to query data status.', 400)
    }
    const params: Record<string, string> = {
      UserID: this.credentials.userId,
      APIKey: this.credentials.apiKey,
    }
    if (input.requestId) params.RequestID = input.requestId
    if (input.providerOrderId) params.OrderID = input.providerOrderId
    return params
  }

  async purchase(input: DataPurchaseInput): Promise<AirtimePurchaseReceipt> {
    const url = withParams(`${this.baseUrl}${CLUBKONNECT_DATA_PURCHASE_PATH}`, this.buildPurchaseParams(input))
    const body = await this.requestJson(url)
    const statusCode = requiredField(pickField(body, ['statuscode']), 'provider status')
    const status = requiredField(pickField(body, ['status']), 'provider status')
    return {
      providerOrderId: pickField(body, ['orderid']),
      statusCode,
      status,
      remark: pickField(body, ['remark']),
    }
  }

  async query(input: AirtimeQueryInput): Promise<AirtimeQueryRecord> {
    const url = withParams(`${this.baseUrl}${CLUBKONNECT_QUERY_PATH}`, this.buildQueryParams(input))
    const body = await this.requestJson(url)
    const statusCode = pickField(body, ['statuscode'])
    const status = pickField(body, ['status'])
    if (!statusCode && !status) return { statusCode: '', status: '', outcome: 'not-found' }
    return {
      providerOrderId: pickField(body, ['orderid']),
      requestId: pickField(body, ['requestid']),
      statusCode: statusCode ?? '',
      status: status ?? '',
      remark: pickField(body, ['remark', 'orderremark', 'orderstatus']),
      amountCharged: pickField(body, ['amountcharged']),
      outcome: classifyOutcome(statusCode, status),
    }
  }

  private async requestJson(url: string): Promise<Record<string, unknown>> {
    let payload: unknown
    try {
      payload = await this.fetchJson(url)
    } catch {
      // Never surface raw URLs (they carry credentials as GET params).
      throw new ClubKonnectError('Data provider request failed. No bundle was confirmed.')
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new ClubKonnectError('Data provider returned an unreadable response. No bundle was confirmed.')
    }
    return payload as Record<string, unknown>
  }
}

/**
 * Conservative outcome mapping from documented provider states. Anything
 * outside the documented ORDER_RECEIVED / ORDER_COMPLETED shapes is
 * `unknown` (needs human recovery) rather than a guessed failure, except
 * explicit failure language which ends the attempt.
 */
export function classifyOutcome(statusCode?: string, status?: string): AirtimeProviderOutcome {
  const code = (statusCode ?? '').trim()
  const normalized = (status ?? '').trim().toUpperCase()
  if (code === '200' || normalized === 'ORDER_COMPLETED') return 'completed'
  if (code === '100' || normalized === 'ORDER_RECEIVED' || normalized.includes('PENDING') || normalized.includes('PROCESS')) return 'pending'
  if (normalized.includes('FAIL') || normalized.includes('ERROR') || normalized.includes('REJECT') || normalized.includes('CANCEL')) return 'failed'
  return 'unknown'
}

function withParams(base: string, params: Record<string, string>): string {
  const url = new URL(base)
  for (const [key, value] of Object.entries(params)) url.searchParams.append(key, value)
  return url.toString()
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

function requiredField(value: string | undefined, field: string): string {
  if (!value) throw new ClubKonnectError(`Airtime provider response is missing ${field}. No airtime was confirmed.`)
  return value
}

async function defaultFetchJson(url: string): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url)
  } catch {
    throw new ClubKonnectError('Airtime provider request failed. No airtime was confirmed.')
  }
  if (!response.ok) throw new ClubKonnectError('Airtime provider is unavailable. No airtime was confirmed.')
  try {
    return (await response.json()) as unknown
  } catch {
    throw new ClubKonnectError('Airtime provider returned an unreadable response. No airtime was confirmed.')
  }
}
