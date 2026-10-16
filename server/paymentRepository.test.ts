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

  it('persists data bundle snapshots on creation', async () => {
    const repository = new InMemoryPaymentRepository()
    const order = await repository.createOrder('user-a', {
      ...parsePaymentOrderDraft({ ...airtimeDraft, serviceType: 'DATA' }),
      requestedAmount: '350',
      providerPlanId: 'MTN-15',
      planDisplayLabel: '1.5GB - 7 days',
      planDataAllowance: '1.5 GB',
      planValidity: '7 days',
    })

    expect(order).toMatchObject({
      serviceType: 'DATA',
      requestedAmount: '350',
      providerPlanId: 'MTN-15',
      planDisplayLabel: '1.5GB - 7 days',
      planDataAllowance: '1.5 GB',
      planValidity: '7 days',
    })
    expect(await repository.getOrder('user-a', order.id)).toEqual(order)
  })

  it('records quotes for data orders with snapshots', async () => {
    const repository = new InMemoryPaymentRepository()
    const order = await repository.createOrder('user-a', {
      ...parsePaymentOrderDraft({ ...airtimeDraft, serviceType: 'DATA' }),
      requestedAmount: '350',
      providerPlanId: 'MTN-15',
    })
    const quote = {
      rateNgnPerNim: '2000',
      nimAmount: '0.175',
      lunaAmount: '17500',
      source: 'fixture',
      observedAt: '2026-10-14T12:00:00.000Z',
      expiresAt: '2026-10-14T12:02:00.000Z',
      network: 'mainnet' as const,
      receiver: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000',
      memo: 'MNS:abc123def456',
    }
    const quoted = await repository.recordQuote('user-a', order.id, quote)
    expect(quoted).toMatchObject({ paymentStatus: 'READY_FOR_PAYMENT', quoteLunaAmount: '17500' })
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

  it('allows failed deliveries back into recovery while stamping each check', async () => {
    const repository = new InMemoryPaymentRepository()
    const order = await repository.createOrder('user-a', parsePaymentOrderDraft(airtimeDraft))
    repository.orders.get(order.id)!.paymentStatus = 'PAID'
    await repository.startFulfilment('user-a', order.id, { provider: 'clubkonnect', providerRequestId: 'req-1' })
    const failed = await repository.recordProviderUpdate('user-a', order.id, {
      providerStatusCode: '400',
      providerStatus: 'ORDER_FAILED',
      fulfilmentStatus: 'FULFILLMENT_FAILED',
    })
    expect(failed?.fulfilmentStatus).toBe('FULFILLMENT_FAILED')
    expect(failed?.lastReconciledAt).toBeDefined()
    // Recovery may advance a failed row; terminal rows stay frozen.
    const recovering = await repository.recordProviderUpdate('user-a', order.id, {
      providerStatusCode: '300',
      providerStatus: 'ORDER_UNKNOWN',
      fulfilmentStatus: 'RECOVERY_REQUIRED',
    })
    expect(recovering?.fulfilmentStatus).toBe('RECOVERY_REQUIRED')
    expect(recovering?.lastReconciledAt).toBeDefined()
    const retrying = await repository.recordProviderUpdate('user-a', order.id, { fulfilmentStatus: 'FULFILLING' })
    expect(retrying?.fulfilmentStatus).toBe('FULFILLING')
    const delivered = await repository.recordProviderUpdate('user-a', order.id, {
      providerStatusCode: '200',
      providerStatus: 'ORDER_COMPLETED',
      fulfilmentStatus: 'DELIVERED',
      fulfilledAt: '2026-10-14T00:00:00.000Z',
    })
    expect(delivered?.fulfilmentStatus).toBe('DELIVERED')
    expect(await repository.recordProviderUpdate('user-a', order.id, { fulfilmentStatus: 'FULFILLING' })).toBeNull()
    expect(await repository.recordProviderUpdate('user-b', order.id, { fulfilmentStatus: 'FULFILLING' })).toBeNull()
  })

  it('records quotes, intents, submissions, verification, and failure with guards', async () => {
    const repository = new InMemoryPaymentRepository()
    const order = await repository.createOrder('user-a', parsePaymentOrderDraft(airtimeDraft))
    const quote = {
      rateNgnPerNim: '2000',
      nimAmount: '0.5',
      lunaAmount: '50000',
      source: 'fixture',
      observedAt: '2026-10-14T12:00:00.000Z',
      expiresAt: '2026-10-14T12:02:00.000Z',
      network: 'mainnet' as const,
      receiver: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000',
      memo: 'MNS:abc123def456',
    }

    const quoted = await repository.recordQuote('user-a', order.id, quote)
    expect(quoted).toMatchObject({
      paymentStatus: 'READY_FOR_PAYMENT',
      quotedCryptoAmount: '0.5',
      quoteLunaAmount: '50000',
      paymentNetwork: 'mainnet',
      paymentMemo: 'MNS:abc123def456',
    })
    // Re-quote overwrites while still quotable.
    expect(await repository.recordQuote('user-a', order.id, { ...quote, lunaAmount: '50001' }))
      .toMatchObject({ quoteLunaAmount: '50001' })
    expect(await repository.recordQuote('user-b', order.id, quote)).toBeNull()

    // Intent requires a fresh quote.
    expect(await repository.recordPaymentIntent('user-a', order.id, '2026-10-14T12:05:00.000Z')).toBeNull()
    expect(await repository.recordPaymentIntent('user-a', order.id, '2026-10-14T12:01:00.000Z'))
      .toMatchObject({ paymentStatus: 'AWAITING_WALLET_APPROVAL' })

    // Submission binds one hash idempotently and advances.
    const submitted = await repository.recordPaymentSubmission('user-a', order.id, 'HASH', '2026-10-14T12:01:00.000Z')
    expect(submitted).toMatchObject({ paymentStatus: 'ONCHAIN_PENDING', walletTxRef: 'HASH' })
    expect(await repository.recordPaymentSubmission('user-a', order.id, 'OTHER', '2026-10-14T12:01:00.000Z')).toBeNull()

    // Verification requires the bound hash and pending state.
    expect(await repository.recordVerifiedPayment('user-a', order.id, {
      transactionHash: 'other',
      sender: 's',
      receiver: 'r',
      lunaAmount: '50000',
      blockNumber: '1',
      confirmations: 1,
      verifiedAt: '2026-10-14T12:03:00.000Z',
    })).toBeNull()
    const paid = await repository.recordVerifiedPayment('user-a', order.id, {
      transactionHash: 'hash',
      sender: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000',
      receiver: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000',
      lunaAmount: '50000',
      blockNumber: '99',
      confirmations: 2,
      verifiedAt: '2026-10-14T12:03:00.000Z',
    })
    expect(paid).toMatchObject({ paymentStatus: 'PAID', paymentBlockNumber: '99', paymentConfirmations: 2 })

    // Failure only lands on pending orders.
    expect(await repository.recordPaymentFailure('user-a', order.id, 'wrong-amount')).toBeNull()
    const pending = await repository.createOrder('user-a', parsePaymentOrderDraft(airtimeDraft))
    const stored = repository.orders.get(pending.id)
    if (!stored) throw new Error('Fixture order missing.')
    stored.paymentStatus = 'ONCHAIN_PENDING'
    expect(await repository.recordPaymentFailure('user-a', pending.id, 'wrong-amount'))
      .toMatchObject({ paymentStatus: 'PAYMENT_FAILED', paymentFailureReason: 'wrong-amount' })
  })

  it('reopens only wrong-network failures with a bound hash for re-verification', async () => {
    const repository = new InMemoryPaymentRepository()
    const order = await repository.createOrder('user-a', parsePaymentOrderDraft(airtimeDraft))
    const stored = repository.orders.get(order.id)
    if (!stored) throw new Error('Fixture order missing.')
    stored.paymentStatus = 'ONCHAIN_PENDING'
    stored.walletTxRef = 'ab'.repeat(32)
    expect(await repository.recordPaymentFailure('user-a', order.id, 'wrong-network'))
      .toMatchObject({ paymentStatus: 'PAYMENT_FAILED' })
    // Affirmative mismatches are never reopened.
    const other = await repository.createOrder('user-a', parsePaymentOrderDraft(airtimeDraft))
    const otherStored = repository.orders.get(other.id)
    if (!otherStored) throw new Error('Fixture order missing.')
    otherStored.paymentStatus = 'ONCHAIN_PENDING'
    otherStored.walletTxRef = 'cd'.repeat(32)
    await repository.recordPaymentFailure('user-a', other.id, 'wrong-amount')
    expect(await repository.reopenWrongNetworkPayment('user-a', other.id)).toBeNull()
    expect(await repository.reopenWrongNetworkPayment('user-b', order.id)).toBeNull()
    // The wrong-network failure returns to pending with its binding intact.
    const reopened = await repository.reopenWrongNetworkPayment('user-a', order.id)
    expect(reopened).toMatchObject({
      paymentStatus: 'ONCHAIN_PENDING',
      walletTxRef: 'ab'.repeat(32),
    })
    expect(reopened?.paymentFailureReason).toBeUndefined()
    // Verified payment then lands on the same hash.
    expect(await repository.recordVerifiedPayment('user-a', order.id, {
      transactionHash: 'ab'.repeat(32),
      sender: 's',
      receiver: 'r',
      lunaAmount: '1',
      blockNumber: '7',
      confirmations: 5,
      verifiedAt: '2026-10-16T12:00:00.000Z',
    })).toMatchObject({ paymentStatus: 'PAID' })
  })
})
