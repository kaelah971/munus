import { describe, expect, it } from 'vitest'
import { InMemoryPaymentRepository } from './paymentRepository'
import { parsePaymentOrderDraft, PaymentValidationError } from './paymentValidation'

const airtimeDraft = {
  serviceType: 'AIRTIME',
  paymentAsset: 'NIM',
  recipientPhone: '080 1234 5678',
  recipientNetwork: 'MTN',
  requestedAmount: '1000',
}

describe('Munus payment order persistence', () => {
  it('creates draft orders with normalized phone and amount', async () => {
    const repository = new InMemoryPaymentRepository()
    const order = await repository.createOrder('user-a', parsePaymentOrderDraft(airtimeDraft))

    expect(order).toMatchObject({
      userId: 'user-a',
      serviceType: 'AIRTIME',
      paymentAsset: 'NIM',
      recipientPhone: '08012345678',
      recipientNetwork: 'MTN',
      recipientCountry: 'NG',
      requestedAmount: '1000',
      requestedCurrency: 'NGN',
      paymentStatus: 'DRAFT',
      fulfilmentStatus: 'NOT_STARTED',
    })
    expect(order.quotedCryptoAmount).toBeUndefined()
    expect(order.walletTxRef).toBeUndefined()
    expect(order.providerRef).toBeUndefined()
    expect(await repository.getOrder('user-a', order.id)).toEqual(order)
    expect(await repository.listOrders('user-a')).toEqual([order])
  })

  it('keeps orders private to their owner', async () => {
    const repository = new InMemoryPaymentRepository()
    const order = await repository.createOrder('user-a', parsePaymentOrderDraft(airtimeDraft))

    expect(await repository.getOrder('user-b', order.id)).toBeNull()
    expect(await repository.listOrders('user-b')).toEqual([])
  })

  it('rejects unsupported service types, assets, and amounts', () => {
    expect(() => parsePaymentOrderDraft({ ...airtimeDraft, serviceType: 'GAMBLING' })).toThrow(PaymentValidationError)
    expect(() => parsePaymentOrderDraft({ ...airtimeDraft, paymentAsset: 'BTC' })).toThrow(PaymentValidationError)
    expect(() => parsePaymentOrderDraft({ ...airtimeDraft, requestedAmount: '0' })).toThrow(PaymentValidationError)
    expect(() => parsePaymentOrderDraft({ ...airtimeDraft, recipientPhone: '123' })).toThrow(PaymentValidationError)
    expect(() => parsePaymentOrderDraft({ ...airtimeDraft, recipientPhone: '' })).toThrow(PaymentValidationError)
  })

  it('accepts the typed DATA and CASH_OUT service models for future slices', () => {
    expect(parsePaymentOrderDraft({ ...airtimeDraft, serviceType: 'DATA' }).serviceType).toBe('DATA')
    expect(parsePaymentOrderDraft({ ...airtimeDraft, serviceType: 'CASH_OUT', paymentAsset: 'USDT' }).serviceType).toBe('CASH_OUT')
  })

  it('reserves fulfilment only for PAID orders waiting to start', async () => {
    const repository = new InMemoryPaymentRepository()
    const draft = await repository.createOrder('user-a', parsePaymentOrderDraft(airtimeDraft))
    expect(await repository.startFulfilment('user-a', draft.id, { provider: 'clubkonnect', providerRequestId: 'req-1' })).toBeNull()

    const stored = repository.orders.get(draft.id)
    if (!stored) throw new Error('Fixture order was not stored.')
    stored.paymentStatus = 'PAID'
    const started = await repository.startFulfilment('user-a', draft.id, { provider: 'clubkonnect', providerRequestId: 'req-1' })
    expect(started).toMatchObject({ fulfilmentStatus: 'FULFILLING', provider: 'clubkonnect', providerRequestId: 'req-1' })
    expect(started?.fulfilmentStartedAt).toBeDefined()
    expect(await repository.startFulfilment('user-a', draft.id, { provider: 'clubkonnect', providerRequestId: 'req-1' })).toBeNull()
    expect(await repository.startFulfilment('user-b', draft.id, { provider: 'clubkonnect', providerRequestId: 'req-1' })).toBeNull()
  })

  it('finds orders by provider reference and records reconciled evidence', async () => {
    const repository = new InMemoryPaymentRepository()
    const order = await repository.createOrder('user-a', parsePaymentOrderDraft(airtimeDraft))
    expect(await repository.findOrderByProviderReference(undefined, undefined)).toBeNull()
    expect(await repository.findOrderByProviderReference('req-1', undefined)).toBeNull()

    repository.orders.get(order.id)!.paymentStatus = 'PAID'
    await repository.startFulfilment('user-a', order.id, { provider: 'clubkonnect', providerRequestId: 'req-1' })
    expect(await repository.findOrderByProviderReference('req-1', undefined)).toMatchObject({ id: order.id })

    const updated = await repository.recordProviderUpdate('user-a', order.id, {
      providerOrderId: 'ord-1',
      providerStatusCode: '200',
      providerStatus: 'ORDER_COMPLETED',
      providerAmountCharged: '1000',
      providerRemark: 'Successful',
      fulfilmentStatus: 'DELIVERED',
      fulfilledAt: '2026-10-14T00:00:00.000Z',
    })
    expect(updated).toMatchObject({ providerRef: 'ord-1', fulfilmentStatus: 'DELIVERED', fulfilledAt: '2026-10-14T00:00:00.000Z' })
    expect(await repository.findOrderByProviderReference(undefined, 'ord-1')).toMatchObject({ id: order.id })
    expect(await repository.recordProviderUpdate('user-a', order.id, { fulfilmentStatus: 'FULFILLING' })).toBeNull()
  })
})
