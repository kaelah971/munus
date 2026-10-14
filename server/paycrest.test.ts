// @vitest-environment node
import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  classifyPaycrestOutcome,
  parsePaycrestWebhookEvent,
  PaycrestClient,
  PaycrestError,
  verifyPaycrestWebhookSignature,
  type PaycrestFetchJson,
} from './paycrest'

const credentials = { apiKey: 'fixture-key', apiSecret: 'fixture-secret' }

function client(fetchJson: PaycrestFetchJson = async () => ({})) {
  return new PaycrestClient({ credentials, fetchJson })
}

describe('Paycrest client', () => {
  it('normalizes institutions without leaking credentials', async () => {
    const seen: string[] = []
    const adapter = client(async (url) => {
      seen.push(url)
      return { data: [{ code: 'GTB', name: 'GTBank' }, { bankCode: '044', bankName: 'Access Bank' }, { name: 'No code' }] }
    })
    expect(await adapter.listInstitutions()).toEqual([
      { code: 'GTB', name: 'GTBank' },
      { code: '044', name: 'Access Bank' },
    ])
    expect(seen.join(' ')).not.toContain('fixture-key')
  })

  it('verifies accounts only with a canonical name', async () => {
    const ok = client(async () => ({ status: 'success', data: '  ADA OKAFOR  ' }))
    await expect(ok.verifyAccount({ institution: 'GTB', accountNumber: '0123456789' })).resolves.toEqual({
      accountName: 'ADA OKAFOR',
    })
    const noName = client(async () => ({ status: 'success', message: 'OK' }))
    await expect(noName.verifyAccount({ institution: 'GTB', accountNumber: '0123456789' })).rejects.toThrow(
      'could not be verified',
    )
    const malformed = client(async () => 'not-json' as unknown)
    await expect(malformed.verifyAccount({ institution: 'GTB', accountNumber: '0123456789' })).rejects.toThrow(
      PaycrestError,
    )
  })

  it('reads the sell rate without inventing one', async () => {
    const adapter = client(async () => ({ rate: 1532.5 }))
    const preview = await adapter.getSellRate('100')
    expect(preview).toMatchObject({ rateNgnPerUsdt: '1532.5', source: 'paycrest' })
    expect(typeof preview.observedAt).toBe('string')
    const missing = client(async () => ({}))
    await expect(missing.getSellRate('100')).rejects.toThrow('rate is unavailable')
  })

  it('takes the wallet transfer total from the provider response only', async () => {
    const explicit = client(async () => ({
      id: 'pc-1',
      receiveAddress: '0xreceiver',
      validUntil: '2026-10-14T12:30:00.000Z',
      amount: '100',
      senderFee: '1',
      transactionFee: '0.5',
      totalAmount: '101.5',
      status: 'initiated',
    }))
    await expect(explicit.createOrder({
      reference: 'order-1',
      refundAddress: '0xrefund',
      institution: 'GTB',
      accountNumber: '0123456789',
      accountName: 'ADA OKAFOR',
      amountUsdt: '100',
    })).resolves.toMatchObject({ paycrestOrderId: 'pc-1', totalUsdt: '101.5' })

    const summed = client(async () => ({
      id: 'pc-2',
      receiveAddress: '0xreceiver',
      validUntil: '2026-10-14T12:30:00.000Z',
      amount: '100',
      senderFee: '1',
      transactionFee: '0.5',
      status: 'initiated',
    }))
    await expect(summed.createOrder({
      reference: 'order-1',
      refundAddress: '0xrefund',
      institution: 'GTB',
      accountNumber: '0123456789',
      accountName: 'ADA OKAFOR',
      amountUsdt: '100',
    })).resolves.toMatchObject({ totalUsdt: '101.5' })

    const incomplete = client(async () => ({
      id: 'pc-3',
      receiveAddress: '0xreceiver',
      validUntil: '2026-10-14T12:30:00.000Z',
      amount: '100',
      status: 'initiated',
    }))
    await expect(incomplete.createOrder({
      reference: 'order-1',
      refundAddress: '0xrefund',
      institution: 'GTB',
      accountNumber: '0123456789',
      accountName: 'ADA OKAFOR',
      amountUsdt: '100',
    })).rejects.toThrow('incomplete')
  })

  it('maps statuses conservatively and reads nested order payloads', async () => {
    expect(classifyPaycrestOutcome('settled')).toBe('settled')
    expect(classifyPaycrestOutcome('SETTLED')).toBe('settled')
    expect(classifyPaycrestOutcome('validated')).toBe('processing')
    expect(classifyPaycrestOutcome('initiated')).toBe('pending')
    expect(classifyPaycrestOutcome('refunded')).toBe('refunded')
    expect(classifyPaycrestOutcome('expired')).toBe('expired')
    expect(classifyPaycrestOutcome('failed')).toBe('failed')
    expect(classifyPaycrestOutcome('something-new')).toBe('unknown')
    expect(classifyPaycrestOutcome(undefined)).toBe('pending')

    const nested = client(async () => ({ data: { id: 'pc-9', status: 'SETTLED' } }))
    await expect(nested.getOrder('pc-9')).resolves.toMatchObject({
      paycrestOrderId: 'pc-9',
      status: 'SETTLED',
      outcome: 'settled',
    })
  })

  it('never surfaces secrets in errors', async () => {
    const failing = client(async () => {
      throw new Error(`boom ${credentials.apiKey} ${credentials.apiSecret}`)
    })
    const urls: string[] = []
    const recording = new PaycrestClient({
      credentials,
      fetchJson: async (url, init) => {
        urls.push(url)
        expect(init.headers?.authorization).toBe('Bearer fixture-key')
        throw new Error('down')
      },
    })
    await expect(failing.listInstitutions()).rejects.toSatisfy((error: unknown) => {
      const message = error instanceof Error ? error.message : ''
      return !message.includes('fixture-key') && !message.includes('fixture-secret')
    })
    await expect(recording.listInstitutions()).rejects.toThrow('No cash-out state changed')
    expect(urls.join(' ')).not.toContain('fixture-key')
    expect(() => new PaycrestClient({ credentials: { apiKey: '', apiSecret: '' } })).toThrow(
      expect.objectContaining({ statusCode: 503 }),
    )
    const fetchJson = vi.fn(async () => ([]))
    new PaycrestClient({ credentials, fetchJson })
    expect(fetchJson).not.toHaveBeenCalled()
  })
})

describe('Paycrest webhook events', () => {
  it('parses events with strict presence, lenient nesting', () => {
    expect(parsePaycrestWebhookEvent(null)).toBeNull()
    expect(parsePaycrestWebhookEvent({ message: 'OK' })).toBeNull()
    expect(parsePaycrestWebhookEvent({ id: 'pc-1', status: 'settled' })).toEqual({
      paycrestOrderId: 'pc-1',
      status: 'settled',
    })
    expect(parsePaycrestWebhookEvent({ data: { id: 'pc-2', orderStatus: 'processing' } })).toEqual({
      paycrestOrderId: 'pc-2',
      status: 'processing',
    })
  })
})

describe('Paycrest webhook signature', () => {
  const secret = 'whsec-test'
  const rawBody = '{"event":"payment.completed","data":{"id":"pc-1"}}'
  const signature = createHmac('sha256', secret).update(rawBody).digest('hex')

  it('accepts a valid signature and rejects anything else', () => {
    expect(verifyPaycrestWebhookSignature({ rawBody, signatureHeader: signature, apiSecret: secret })).toBe(true)
    expect(verifyPaycrestWebhookSignature({ rawBody, signatureHeader: signature.toUpperCase(), apiSecret: secret })).toBe(true)
    expect(verifyPaycrestWebhookSignature({ rawBody: `${rawBody} `, signatureHeader: signature, apiSecret: secret })).toBe(false)
    expect(verifyPaycrestWebhookSignature({ rawBody, signatureHeader: 'deadbeef', apiSecret: secret })).toBe(false)
    expect(verifyPaycrestWebhookSignature({ rawBody, signatureHeader: undefined, apiSecret: secret })).toBe(false)
    expect(verifyPaycrestWebhookSignature({ rawBody, signatureHeader: signature, apiSecret: '' })).toBe(false)
  })
})
