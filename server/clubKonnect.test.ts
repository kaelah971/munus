// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  AIRTIME_MAX_NGN,
  AIRTIME_MIN_NGN,
  CLUBKONNECT_AIRTIME_PATH,
  CLUBKONNECT_BASE_URL,
  CLUBKONNECT_QUERY_PATH,
  ClubKonnectAirtimeProvider,
  ClubKonnectError,
  classifyOutcome,
  clubKonnectNetworkCode,
  deriveProviderRequestId,
  toProviderAmount,
  toProviderMsisdn,
} from './clubKonnect'

const credentials = { userId: 'fixture-user', apiKey: 'fixture-key' }

function provider(fetchJson: (url: string) => Promise<unknown> = async () => ({})) {
  return new ClubKonnectAirtimeProvider({ credentials, fetchJson })
}

const purchaseInput = {
  network: 'MTN' as const,
  amountNgn: '1000',
  mobileNumber: '08012345678',
  requestId: 'abc123',
  callbackUrl: 'https://munus.example/provider-callback/clubkonnect',
}

describe('ClubKonnect airtime adapter', () => {
  it('maps every Munus network to its documented provider code', () => {
    expect(clubKonnectNetworkCode('MTN')).toBe('01')
    expect(clubKonnectNetworkCode('Glo')).toBe('02')
    expect(clubKonnectNetworkCode('9mobile')).toBe('03')
    expect(clubKonnectNetworkCode('Airtel')).toBe('04')
  })

  it('builds the documented airtime request parameters', () => {
    const params = provider().buildPurchaseParams(purchaseInput)

    expect(params).toMatchObject({
      UserID: 'fixture-user',
      APIKey: 'fixture-key',
      MobileNetwork: '01',
      Amount: '1000',
      MobileNumber: '08012345678',
      RequestID: 'abc123',
      CallBackURL: 'https://munus.example/provider-callback/clubkonnect',
    })
  })

  it('builds query parameters by RequestID or OrderID', () => {
    expect(provider().buildQueryParams({ requestId: 'req-1' })).toMatchObject({ RequestID: 'req-1' })
    expect(provider().buildQueryParams({ providerOrderId: 'ord-1' })).toMatchObject({ OrderID: 'ord-1' })
    expect(() => provider().buildQueryParams({})).toThrow(ClubKonnectError)
  })

  it('derives one stable RequestID per order', () => {
    const first = deriveProviderRequestId('123e4567-e89b-12d3-a456-426614174000')
    expect(deriveProviderRequestId('123e4567-e89b-12d3-a456-426614174000')).toBe(first)
    expect(first).toBe('123e4567e89b12d3a456426614174000')
    expect(deriveProviderRequestId('223e4567-e89b-12d3-a456-426614174000')).not.toBe(first)
    expect(() => deriveProviderRequestId('short')).toThrow(ClubKonnectError)
  })

  it(`enforces whole-naira amounts from ₦${AIRTIME_MIN_NGN} to ₦${AIRTIME_MAX_NGN}`, () => {
    expect(toProviderAmount('50')).toBe('50')
    expect(toProviderAmount('200000')).toBe('200000')
    expect(() => toProviderAmount('49')).toThrow(ClubKonnectError)
    expect(() => toProviderAmount('200001')).toThrow(ClubKonnectError)
    expect(() => toProviderAmount('99.5')).toThrow(ClubKonnectError)
    expect(() => toProviderAmount('0')).toThrow(ClubKonnectError)
    expect(toProviderMsisdn('080 1234 5678')).toBe('08012345678')
    expect(() => toProviderMsisdn('123')).toThrow(ClubKonnectError)
  })

  it('parses ORDER_RECEIVED and ORDER_COMPLETED without provider wallet data', async () => {
    const urls: string[] = []
    const adapter = provider(async (url) => {
      urls.push(url)
      if (url.startsWith(`${CLUBKONNECT_BASE_URL}${CLUBKONNECT_AIRTIME_PATH}`)) {
        return { orderid: 'ord-9', statuscode: '100', status: 'ORDER_RECEIVED' }
      }
      return {
        orderid: 'ord-9',
        requestid: 'abc123',
        statuscode: '200',
        status: 'ORDER_COMPLETED',
        remark: 'Successful',
        mobilenetwork: '01',
        mobilenumber: '08012345678',
        amountcharged: '1000',
        walletbalance: '999999',
      }
    })

    const receipt = await adapter.purchase(purchaseInput)
    expect(receipt).toMatchObject({ providerOrderId: 'ord-9', statusCode: '100', status: 'ORDER_RECEIVED' })

    const record = await adapter.query({ requestId: 'abc123' })
    expect(record).toMatchObject({
      providerOrderId: 'ord-9',
      requestId: 'abc123',
      statusCode: '200',
      status: 'ORDER_COMPLETED',
      remark: 'Successful',
      amountCharged: '1000',
      outcome: 'completed',
    })
    expect(record).not.toHaveProperty('walletbalance')
    expect(urls).toHaveLength(2)
    expect(urls[1]).toContain(CLUBKONNECT_QUERY_PATH)
  })

  it('treats an empty query response as not-found', async () => {
    const record = await provider(async () => ({})).query({ requestId: 'missing' })
    expect(record.outcome).toBe('not-found')
  })

  it('classifies documented and failure provider states conservatively', () => {
    expect(classifyOutcome('100', 'ORDER_RECEIVED')).toBe('pending')
    expect(classifyOutcome('', 'ORDER_RECEIVED')).toBe('pending')
    expect(classifyOutcome('200', 'ORDER_COMPLETED')).toBe('completed')
    expect(classifyOutcome('', 'ORDER_COMPLETED')).toBe('completed')
    expect(classifyOutcome('400', 'ORDER_FAILED')).toBe('failed')
    expect(classifyOutcome('', 'ERROR_INVALID_NUMBER')).toBe('failed')
    expect(classifyOutcome('300', 'SOME_NEW_STATUS')).toBe('unknown')
  })

  it('never exposes credentials or request URLs in errors', async () => {
    const failing = provider(async () => {
      throw new Error(`boom ${credentials.apiKey} https://secret`)
    })
    const malformed = provider(async () => 'not-json' as unknown)
    const httpError = provider(async () => {
      throw Object.assign(new Error('HTTP 500'), { status: 500 })
    })

    for (const adapter of [failing, malformed, httpError]) {
      await expect(adapter.purchase(purchaseInput)).rejects.toSatisfy((error: unknown) => {
        const message = error instanceof Error ? error.message : ''
        return !message.includes('fixture-key') && !message.includes('fixture-user') && !message.includes('http')
      })
      await expect(adapter.query({ requestId: 'x' })).rejects.toSatisfy((error: unknown) => {
        const message = error instanceof Error ? error.message : ''
        return !message.includes('fixture-key') && !message.includes('http')
      })
    }
  })

  it('requires credentials and validates purchase input before any fetch', async () => {
    expect(() => new ClubKonnectAirtimeProvider({ credentials: { userId: '', apiKey: '' } })).toThrow(
      expect.objectContaining({ statusCode: 503 }),
    )
    const fetchJson = vi.fn(async () => ({}))
    const adapter = new ClubKonnectAirtimeProvider({ credentials, fetchJson })
    await expect(adapter.purchase({ ...purchaseInput, amountNgn: '10' })).rejects.toThrow(ClubKonnectError)
    expect(fetchJson).not.toHaveBeenCalled()
  })

  it(`documents the amount bounds (${AIRTIME_MIN_NGN}/${AIRTIME_MAX_NGN})`, () => {
    expect(AIRTIME_MIN_NGN).toBe(50)
    expect(AIRTIME_MAX_NGN).toBe(200000)
  })
})
