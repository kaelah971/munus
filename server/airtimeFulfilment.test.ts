// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type {
  AirtimeProviderAdapter,
  AirtimePurchaseInput,
  AirtimePurchaseReceipt,
  AirtimeQueryRecord,
  DataProviderAdapter,
  DataPurchaseInput,
  PaymentOrder,
} from '../src/domain/orders'
import { InMemoryPaymentRepository } from './paymentRepository'
import { parsePaymentOrderDraft } from './paymentValidation'
import { AirtimeFulfilmentService, FulfilmentError } from './airtimeFulfilment'

class FixtureAirtimeProvider implements AirtimeProviderAdapter {
  readonly provider = 'clubkonnect'
  readonly serviceType = 'AIRTIME' as const
  purchaseCalls = 0
  queryCalls = 0
  purchaseReceipt: AirtimePurchaseReceipt = { providerOrderId: 'ord-1', statusCode: '100', status: 'ORDER_RECEIVED' }
  queryRecord: AirtimeQueryRecord = { statusCode: '', status: '', outcome: 'not-found' }

  deriveRequestId(orderId: string): string {
    return orderId.replace(/-/g, '')
  }

  buildPurchaseParams(input: AirtimePurchaseInput): Record<string, string> {
    if (!input.network) throw new FulfilmentError('network required', 400)
    return { RequestID: input.requestId }
  }

  async purchase(): Promise<AirtimePurchaseReceipt> {
    this.purchaseCalls += 1
    return this.purchaseReceipt
  }

  async query(): Promise<AirtimeQueryRecord> {
    this.queryCalls += 1
    return this.queryRecord
  }
}

class FixtureDataProvider implements DataProviderAdapter {
  readonly provider = 'clubkonnect'
  readonly serviceType = 'DATA' as const
  purchaseCalls = 0
  queryCalls = 0
  purchaseReceipt: AirtimePurchaseReceipt = { providerOrderId: 'ord-data-1', statusCode: '100', status: 'ORDER_RECEIVED' }
  queryRecord: AirtimeQueryRecord = { statusCode: '', status: '', outcome: 'not-found' }
  lastInput: DataPurchaseInput | null = null

  deriveRequestId(orderId: string): string {
    return orderId.replace(/-/g, '')
  }

  buildPurchaseParams(input: DataPurchaseInput): Record<string, string> {
    if (!input.network) throw new FulfilmentError('network required', 400)
    if (!input.providerPlanId) throw new FulfilmentError('plan required', 400)
    return { RequestID: input.requestId, DataPlan: input.providerPlanId }
  }

  async purchase(input: DataPurchaseInput): Promise<AirtimePurchaseReceipt> {
    this.purchaseCalls += 1
    this.lastInput = input
    return this.purchaseReceipt
  }

  async query(): Promise<AirtimeQueryRecord> {
    this.queryCalls += 1
    return this.queryRecord
  }
}

const airtimeDraft = {
  serviceType: 'AIRTIME',
  paymentAsset: 'NIM',
  recipientPhone: '08012345678',
  recipientNetwork: 'MTN',
  requestedAmount: '1000',
}

async function paidOrder(repository: InMemoryPaymentRepository, userId = 'user-a'): Promise<PaymentOrder> {
  const order = await repository.createOrder(userId, parsePaymentOrderDraft(airtimeDraft))
  const stored = repository.orders.get(order.id)
  if (!stored) throw new Error('Fixture order was not stored.')
  stored.paymentStatus = 'PAID'
  return stored
}

function service(repository: InMemoryPaymentRepository, provider = new FixtureAirtimeProvider()) {
  return {
    provider,
    fulfilment: new AirtimeFulfilmentService(repository, provider, {
      callbackBaseUrl: 'https://munus.example',
      now: () => '2026-10-14T00:00:00.000Z',
    }),
  }
}

describe('Airtime fulfilment service', () => {
  it('rejects DRAFT orders before any provider contact', async () => {
    const repository = new InMemoryPaymentRepository()
    const draft = await repository.createOrder('user-a', parsePaymentOrderDraft(airtimeDraft))
    const { provider, fulfilment } = service(repository)

    await expect(fulfilment.fulfilOrder('user-a', draft.id)).rejects.toMatchObject({ statusCode: 409 })
    expect(provider.purchaseCalls).toBe(0)
    expect(provider.queryCalls).toBe(0)
    const untouched = await repository.getOrder('user-a', draft.id)
    expect(untouched).toMatchObject({ paymentStatus: 'DRAFT', fulfilmentStatus: 'NOT_STARTED' })
    expect(untouched?.provider).toBeUndefined()
    expect(untouched?.providerRequestId).toBeUndefined()
  })

  it('rejects unpaid and unsupported orders', async () => {
    const repository = new InMemoryPaymentRepository()
    const failed = await paidOrder(repository)
    failed.paymentStatus = 'PAYMENT_FAILED'
    const cash = await repository.createOrder('user-a', parsePaymentOrderDraft({ ...airtimeDraft, serviceType: 'CASH_OUT' }))
    const storedCash = repository.orders.get(cash.id)
    if (!storedCash) throw new Error('Fixture order was not stored.')
    storedCash.paymentStatus = 'PAID'
    const { fulfilment } = service(repository)

    await expect(fulfilment.fulfilOrder('user-a', failed.id)).rejects.toMatchObject({ statusCode: 409 })
    await expect(fulfilment.fulfilOrder('user-a', cash.id)).rejects.toThrow('Only airtime or data orders')
  })

  it('moves a PAID order to FULFILLING with one stable RequestID', async () => {
    const repository = new InMemoryPaymentRepository()
    const order = await paidOrder(repository)
    const { fulfilment } = service(repository)

    const fulfilled = await fulfilment.fulfilOrder('user-a', order.id)

    expect(fulfilled).toMatchObject({
      paymentStatus: 'PAID',
      fulfilmentStatus: 'FULFILLING',
      provider: 'clubkonnect',
      providerRef: 'ord-1',
      providerStatusCode: '100',
      providerStatus: 'ORDER_RECEIVED',
    })
    expect(fulfilled.providerRequestId).toBe(order.id.replace(/-/g, ''))
    expect(fulfilled.fulfilmentStartedAt).toBeDefined()
    expect(fulfilled.fulfilledAt).toBeUndefined()
  })

  it('never repurchases on a duplicate fulfil attempt', async () => {
    const repository = new InMemoryPaymentRepository()
    const order = await paidOrder(repository)
    const { provider, fulfilment } = service(repository)

    await fulfilment.fulfilOrder('user-a', order.id)
    // Provider already knows the request: attach without repurchasing.
    provider.queryRecord = { providerOrderId: 'ord-1', statusCode: '100', status: 'ORDER_RECEIVED', outcome: 'pending' }
    const again = await fulfilment.fulfilOrder('user-a', order.id)

    expect(provider.purchaseCalls).toBe(1)
    expect(again.fulfilmentStatus).toBe('FULFILLING')
    expect(again.providerRef).toBe('ord-1')
  })

  it('reconciles ORDER_COMPLETED to DELIVERED with real evidence only', async () => {
    const repository = new InMemoryPaymentRepository()
    const order = await paidOrder(repository)
    const { provider, fulfilment } = service(repository)
    await fulfilment.fulfilOrder('user-a', order.id)

    provider.queryRecord = {
      providerOrderId: 'ord-1',
      requestId: order.id.replace(/-/g, ''),
      statusCode: '200',
      status: 'ORDER_COMPLETED',
      remark: 'Successful delivery of 1000 NGN airtime to 08012345678',
      amountCharged: '1000',
      outcome: 'completed',
    }
    const delivered = await fulfilment.reconcileOrder('user-a', order.id)

    expect(delivered).toMatchObject({
      paymentStatus: 'PAID',
      fulfilmentStatus: 'DELIVERED',
      providerRef: 'ord-1',
      providerStatusCode: '200',
      providerStatus: 'ORDER_COMPLETED',
      providerAmountCharged: '1000',
      fulfilledAt: '2026-10-14T00:00:00.000Z',
    })
    expect(delivered).not.toHaveProperty('walletbalance')
    // Terminal orders reconcile idempotently without provider contact.
    const queryCalls = provider.queryCalls
    expect(await fulfilment.reconcileOrder('user-a', order.id)).toMatchObject({ fulfilmentStatus: 'DELIVERED' })
    expect(provider.queryCalls).toBe(queryCalls)
    expect(await fulfilment.fulfilOrder('user-a', order.id)).toMatchObject({ fulfilmentStatus: 'DELIVERED' })
  })

  it('maps provider failure and ambiguity to failure/recovery states', async () => {
    const repository = new InMemoryPaymentRepository()
    const failed = await paidOrder(repository)
    const ambiguous = await paidOrder(repository)
    const { provider, fulfilment } = service(repository)
    await fulfilment.fulfilOrder('user-a', failed.id)
    provider.purchaseReceipt = { providerOrderId: 'ord-2', statusCode: '100', status: 'ORDER_RECEIVED' }
    await fulfilment.fulfilOrder('user-a', ambiguous.id)
    provider.purchaseCalls = 0

    provider.queryRecord = { statusCode: '400', status: 'ORDER_FAILED', outcome: 'failed' }
    const terminal = await fulfilment.reconcileByProviderReference(failed.id.replace(/-/g, ''), undefined)
    expect(terminal).toMatchObject({ fulfilmentStatus: 'FULFILLMENT_FAILED' })
    expect(terminal?.fulfilledAt).toBeUndefined()

    provider.queryRecord = { statusCode: '300', status: 'SOME_NEW_STATUS', outcome: 'unknown' }
    expect(await fulfilment.reconcileByProviderReference(undefined, 'ord-2'))
      .toMatchObject({ fulfilmentStatus: 'RECOVERY_REQUIRED' })
    expect(provider.purchaseCalls).toBe(0)
  })

  it('leaves state untouched when the provider knows nothing yet', async () => {
    const repository = new InMemoryPaymentRepository()
    const order = await paidOrder(repository)
    const { provider, fulfilment } = service(repository)
    await fulfilment.fulfilOrder('user-a', order.id)

    provider.queryRecord = { statusCode: '', status: '', outcome: 'not-found' }
    const unchanged = await fulfilment.reconcileOrder('user-a', order.id)
    expect(unchanged.fulfilmentStatus).toBe('FULFILLING')
    expect(unchanged.providerStatusCode).toBe('100')
  })

  it('returns null for unknown provider references without mutating', async () => {
    const repository = new InMemoryPaymentRepository()
    const { provider, fulfilment } = service(repository)

    expect(await fulfilment.reconcileByProviderReference('nope', undefined)).toBeNull()
    expect(provider.queryCalls).toBe(0)
    await expect(fulfilment.reconcileByProviderReference(undefined, undefined)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('requires network, bounds, and callback configuration before reserving', async () => {
    const repository = new InMemoryPaymentRepository()
    const noNetwork = await repository.createOrder('user-a', parsePaymentOrderDraft({ ...airtimeDraft, recipientNetwork: '' }))
    repository.orders.get(noNetwork.id)!.paymentStatus = 'PAID'
    const unconfigured = new AirtimeFulfilmentService(repository, new FixtureAirtimeProvider(), {})
    const blocked = await paidOrder(repository)
    const { fulfilment } = service(repository)

    await expect(fulfilment.fulfilOrder('user-a', noNetwork.id)).rejects.toMatchObject({ statusCode: 400 })
    await expect(unconfigured.fulfilOrder('user-a', blocked.id)).rejects.toMatchObject({ statusCode: 503 })
    for (const id of [noNetwork.id, blocked.id]) {
      const current = await repository.getOrder('user-a', id)
      expect(current).toMatchObject({ fulfilmentStatus: 'NOT_STARTED' })
      expect(current?.providerRequestId).toBeUndefined()
    }
  })

  it('fulfils PAID data orders with the snapshotted plan id', async () => {
    const repository = new InMemoryPaymentRepository()
    const created = await repository.createOrder('user-a', parsePaymentOrderDraft(airtimeDraft))
    const stored = repository.orders.get(created.id)
    if (!stored) throw new Error('Fixture order was not stored.')
    Object.assign(stored, {
      serviceType: 'DATA',
      requestedAmount: '350',
      providerPlanId: 'MTN-15',
      planDisplayLabel: '1.5GB - 7 days',
      planDataAllowance: '1.5 GB',
      planValidity: '7 days',
      paymentStatus: 'PAID',
    })
    const dataProvider = new FixtureDataProvider()
    const fulfilment = new AirtimeFulfilmentService(repository, { data: dataProvider }, {
      callbackBaseUrl: 'https://munus.example',
      now: () => '2026-10-14T00:00:00.000Z',
    })

    const fulfilled = await fulfilment.fulfilOrder('user-a', created.id)
    expect(fulfilled).toMatchObject({
      paymentStatus: 'PAID',
      fulfilmentStatus: 'FULFILLING',
      provider: 'clubkonnect',
      providerRef: 'ord-data-1',
    })
    expect(dataProvider.purchaseCalls).toBe(1)
    expect(dataProvider.lastInput).toMatchObject({
      network: 'MTN',
      providerPlanId: 'MTN-15',
      mobileNumber: '08012345678',
    })

    dataProvider.queryRecord = { providerOrderId: 'ord-data-1', statusCode: '200', status: 'ORDER_COMPLETED', outcome: 'completed' }
    expect(await fulfilment.reconcileOrder('user-a', created.id)).toMatchObject({ fulfilmentStatus: 'DELIVERED' })

    // A duplicate fulfil attempt re-queries instead of repurchasing.
    expect(await fulfilment.fulfilOrder('user-a', created.id)).toMatchObject({ fulfilmentStatus: 'DELIVERED' })
    expect(dataProvider.purchaseCalls).toBe(1)
  })

  it('refuses data fulfilment without a snapshot or a data provider', async () => {
    const repository = new InMemoryPaymentRepository()
    const bare = await repository.createOrder('user-a', parsePaymentOrderDraft({ ...airtimeDraft, serviceType: 'DATA' }))
    const stored = repository.orders.get(bare.id)
    if (!stored) throw new Error('Fixture order was not stored.')
    stored.paymentStatus = 'PAID'
    const dataOnly = new AirtimeFulfilmentService(repository, { data: new FixtureDataProvider() }, {
      callbackBaseUrl: 'https://munus.example',
    })
    await expect(dataOnly.fulfilOrder('user-a', bare.id)).rejects.toMatchObject({ statusCode: 409 })

    const airtimeOnly = new AirtimeFulfilmentService(repository, { airtime: new FixtureAirtimeProvider() }, {
      callbackBaseUrl: 'https://munus.example',
    })
    const snapshotted = repository.orders.get(bare.id)
    if (!snapshotted) throw new Error('Fixture order was not stored.')
    snapshotted.providerPlanId = 'MTN-15'
    await expect(airtimeOnly.fulfilOrder('user-a', bare.id)).rejects.toMatchObject({ statusCode: 503 })
  })

  it('keeps invalid-plan failure on PAID without touching payment state', async () => {
    const repository = new InMemoryPaymentRepository()
    const created = await repository.createOrder('user-a', parsePaymentOrderDraft(airtimeDraft))
    const stored = repository.orders.get(created.id)
    if (!stored) throw new Error('Fixture order was not stored.')
    Object.assign(stored, { serviceType: 'DATA', requestedAmount: '350', providerPlanId: 'MTN-OLD', paymentStatus: 'PAID' })
    const dataProvider = new FixtureDataProvider()
    const fulfilment = new AirtimeFulfilmentService(repository, { data: dataProvider }, {
      callbackBaseUrl: 'https://munus.example',
    })
    await fulfilment.fulfilOrder('user-a', created.id)
    dataProvider.queryRecord = { statusCode: '400', status: 'ORDER_FAILED', outcome: 'failed' }
    const failed = await fulfilment.reconcileByProviderReference(created.id.replace(/-/g, ''), undefined)
    expect(failed).toMatchObject({ paymentStatus: 'PAID', fulfilmentStatus: 'FULFILLMENT_FAILED' })
  })

  it('never spends provider funds for non-mainnet payments', async () => {
    const repository = new InMemoryPaymentRepository()
    const order = await paidOrder(repository)
    order.paymentNetwork = 'testnet'
    const { provider, fulfilment } = service(repository)

    await expect(fulfilment.fulfilOrder('user-a', order.id)).rejects.toMatchObject({ statusCode: 409 })
    expect(provider.purchaseCalls).toBe(0)
    expect(provider.queryCalls).toBe(0)
    expect(await repository.getOrder('user-a', order.id)).toMatchObject({ fulfilmentStatus: 'NOT_STARTED' })
  })
})
