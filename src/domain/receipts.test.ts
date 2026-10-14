import { describe, expect, it } from 'vitest'
import type { PaymentOrder } from './orders'
import {
  buildReceipt,
  buildReceiptReference,
  describeActivityStatus,
  describePaymentNetwork,
  formatActivityDate,
  isCompletedReceipt,
  matchesActivityFilter,
  shortenReference,
  sortOrdersNewestFirst,
} from './receipts'

const TX_HASH = 'ab'.repeat(32)

function order(overrides: Partial<PaymentOrder> = {}): PaymentOrder {
  return {
    id: '123e4567-e89b-12d3-a456-426614174000',
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
    createdAt: '2026-10-14T10:00:00.000Z',
    updatedAt: '2026-10-14T10:00:00.000Z',
    ...overrides,
  }
}

function deliveredOrder(): PaymentOrder {
  return order({
    paymentStatus: 'PAID',
    fulfilmentStatus: 'DELIVERED',
    quotedCryptoAmount: '0.5',
    quoteLunaAmount: '50000',
    quoteRateNgnPerNim: '2000',
    quoteExpiresAt: '2026-10-14T12:02:00.000Z',
    paymentNetwork: 'mainnet',
    paymentMemo: 'MNS:123e4567e89b',
    paymentReceiver: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000',
    paymentSender: 'NQ19 8DSN PR0S 2PC0 61Q4 U1HT 5FDP RBNK BXBN',
    paymentBlockNumber: '990',
    paymentConfirmations: 10,
    paymentVerifiedAt: '2026-10-14T12:05:00.000Z',
    walletTxRef: TX_HASH,
    provider: 'clubkonnect',
    providerRef: 'ord-1',
    providerRequestId: '123e4567e89b12d3a456426614174000',
    providerStatusCode: '200',
    providerStatus: 'ORDER_COMPLETED',
    providerAmountCharged: '1000',
    fulfilmentStartedAt: '2026-10-14T12:05:30.000Z',
    fulfilledAt: '2026-10-14T12:06:00.000Z',
  })
}

describe('receipt projection', () => {
  it('projects a full completed receipt from a delivered order', () => {
    const receipt = buildReceipt(deliveredOrder())

    expect(receipt.completed).toBe(true)
    expect(receipt.activityStatus).toBe('delivered')
    expect(receipt.statusLabel).toBe('Delivered')
    expect(receipt.receiptReference).toBe('MNS-123E4567')
    expect(receipt.serviceLabel).toBe('Airtime')
    expect(receipt.recipientMasked).toBe('080•••5678')
    expect(receipt.nimAmount).toBe('0.5')
    expect(receipt.walletTxShort).toBe('abababab…ababab')
    expect(receipt.providerName).toBe('ClubKonnect')
    expect(receipt.providerRef).toBe('ord-1')
    expect(receipt.paymentTime).toBe('2026-10-14T12:05:00.000Z')
    expect(receipt.deliveryTime).toBe('2026-10-14T12:06:00.000Z')
    // No full phone leaks through the projection; the UI shows the derived
    // receipt reference instead of the raw internal id (orderId stays in the
    // view-model only as a functional key, never rendered).
    expect(JSON.stringify(receipt)).not.toContain('08012345678')
    expect(receipt.receiptReference).toBe('MNS-123E4567')
    expect(receipt.timeline.map((stage) => `${stage.id}:${stage.state}`)).toEqual([
      'created:done',
      'submitted:done',
      'confirmed:done',
      'sent:done',
      'delivered:done',
    ])
    expect(receipt.timeline[0].at).toBe('2026-10-14T10:00:00.000Z')
  })

  it('never labels a paid-but-undelivered order a completed receipt', () => {
    const fulfilling = buildReceipt(order({
      paymentStatus: 'PAID',
      fulfilmentStatus: 'FULFILLING',
      walletTxRef: TX_HASH,
      paymentVerifiedAt: '2026-10-14T12:05:00.000Z',
      provider: 'clubkonnect',
      providerRequestId: 'req-1',
    }))

    expect(fulfilling.completed).toBe(false)
    expect(fulfilling.activityStatus).toBe('delivering')
    expect(fulfilling.timeline.map((stage) => `${stage.id}:${stage.state}`)).toEqual([
      'created:done',
      'submitted:done',
      'confirmed:done',
      'sent:done',
      'delivered:idle',
    ])
  })

  it('requires every evidence link for a completed receipt', () => {
    const base = deliveredOrder()
    expect(isCompletedReceipt(base)).toBe(true)
    const withoutDelivered = { ...base, fulfilmentStatus: 'FULFILLING' } as PaymentOrder
    expect(isCompletedReceipt(withoutDelivered)).toBe(false)
    const cases: (keyof PaymentOrder)[] = [
      'walletTxRef',
      'paymentVerifiedAt',
      'quotedCryptoAmount',
      'quoteLunaAmount',
      'provider',
      'fulfilledAt',
    ]
    for (const key of cases) {
      expect(isCompletedReceipt({ ...base, [key]: undefined })).toBe(false)
    }
  })

  it('maps every payment/fulfilment combination to one human status', () => {
    const cases: Array<[PaymentOrder['paymentStatus'], PaymentOrder['fulfilmentStatus'], string]> = [
      ['DRAFT', 'NOT_STARTED', 'draft'],
      ['QUOTE_PENDING', 'NOT_STARTED', 'ready'],
      ['READY_FOR_PAYMENT', 'NOT_STARTED', 'ready'],
      ['AWAITING_WALLET_APPROVAL', 'NOT_STARTED', 'awaiting-approval'],
      ['ONCHAIN_PENDING', 'NOT_STARTED', 'confirming'],
      ['PAID', 'NOT_STARTED', 'payment-confirmed'],
      ['PAID', 'FULFILLING', 'delivering'],
      ['PAID', 'DELIVERED', 'delivered'],
      ['PAID', 'FULFILLMENT_FAILED', 'delivery-failed'],
      ['PAID', 'RECOVERY_REQUIRED', 'needs-attention'],
      ['PAYMENT_FAILED', 'NOT_STARTED', 'payment-failed'],
    ]
    for (const [paymentStatus, fulfilmentStatus, expected] of cases) {
      expect(describeActivityStatus(order({ paymentStatus, fulfilmentStatus }))).toBe(expected)
    }
  })

  it('filters activity without hiding drafts from All', () => {
    expect(matchesActivityFilter('delivered', 'completed')).toBe(true)
    expect(matchesActivityFilter('payment-confirmed', 'completed')).toBe(false)
    expect(matchesActivityFilter('draft', 'all')).toBe(true)
    expect(matchesActivityFilter('draft', 'in-progress')).toBe(false)
    expect(matchesActivityFilter('ready', 'in-progress')).toBe(true)
    expect(matchesActivityFilter('delivering', 'in-progress')).toBe(true)
    expect(matchesActivityFilter('needs-attention', 'attention')).toBe(true)
    expect(matchesActivityFilter('delivery-failed', 'attention')).toBe(true)
    expect(matchesActivityFilter('payment-failed', 'attention')).toBe(true)
    expect(matchesActivityFilter('delivered', 'attention')).toBe(false)
  })

  it('keeps the chain sender independent from the session wallet', () => {
    const receipt = buildReceipt(deliveredOrder())
    expect(receipt.senderShort).toBe('NQ198DSN…NKBXBN')
    expect(receipt.senderShort).not.toContain('user-a')
  })

  it('marks testnet orders visibly testnet', () => {
    const receipt = buildReceipt(order({
      paymentStatus: 'PAID',
      fulfilmentStatus: 'NOT_STARTED',
      paymentNetwork: 'testnet',
      walletTxRef: TX_HASH,
      paymentVerifiedAt: '2026-10-14T12:05:00.000Z',
    }))
    expect(receipt.isTestnet).toBe(true)
    expect(describePaymentNetwork('testnet')).toBe('Nimiq testnet')
    expect(describePaymentNetwork('mainnet')).toBe('Nimiq mainnet')
    expect(describePaymentNetwork(undefined)).toBeUndefined()
  })

  it('sorts newest first and formats dates without fabricating them', () => {
    const older = order({ id: 'aaaaaaaa-0000-0000-0000-000000000000', createdAt: '2026-10-13T10:00:00.000Z' })
    const newer = order({ id: 'bbbbbbbb-0000-0000-0000-000000000000', createdAt: '2026-10-14T10:00:00.000Z' })
    expect(sortOrdersNewestFirst([older, newer]).map((entry) => entry.id)).toEqual([newer.id, older.id])
    expect(formatActivityDate('2026-10-14T12:05:00.000Z')).toContain('2026')
    expect(formatActivityDate('not-a-date')).toBe('')
  })

  it('shortens long references and derives deterministic receipt ids', () => {
    expect(shortenReference(TX_HASH)).toBe('abababab…ababab')
    expect(shortenReference('short')).toBe('short')
    expect(buildReceiptReference('123e4567-e89b-12d3-a456-426614174000')).toBe('MNS-123E4567')
    expect(buildReceiptReference('123e4567-e89b-12d3-a456-426614174000')).toBe(
      buildReceiptReference('123e4567-e89b-12d3-a456-426614174000'),
    )
    expect(() => buildReceiptReference('short')).toThrow()
  })

  it('renders failed and recovery timelines without invented timestamps', () => {
    const failed = buildReceipt(order({
      paymentStatus: 'PAYMENT_FAILED',
      paymentFailureReason: 'wrong-amount',
      walletTxRef: TX_HASH,
    }))
    expect(failed.completed).toBe(false)
    expect(failed.activityStatus).toBe('payment-failed')
    expect(failed.failureDetail).toContain('quoted amount')
    expect(failed.timeline.map((stage) => stage.id)).toEqual(['created', 'submitted'])

    const recovery = buildReceipt(order({
      paymentStatus: 'PAID',
      fulfilmentStatus: 'RECOVERY_REQUIRED',
      walletTxRef: TX_HASH,
      paymentVerifiedAt: '2026-10-14T12:05:00.000Z',
      provider: 'clubkonnect',
      providerRequestId: 'req-1',
    }))
    expect(recovery.activityStatus).toBe('needs-attention')
    expect(recovery.timeline.map((stage) => `${stage.id}:${stage.state}`)).toEqual([
      'created:done',
      'submitted:done',
      'confirmed:done',
      'sent:done',
      'delivered:attention',
    ])
  })

  it('projects data receipts with snapshotted bundle evidence', () => {
    const receipt = buildReceipt({
      ...deliveredOrder(),
      serviceType: 'DATA',
      requestedAmount: '350',
      providerPlanId: 'MTN-15',
      planDisplayLabel: '1.5GB - 7 days',
      planDataAllowance: '1.5 GB',
      planValidity: '7 days',
    })

    expect(receipt.completed).toBe(true)
    expect(receipt.serviceLabel).toBe('Data')
    expect(receipt.bundleLabel).toBe('1.5GB - 7 days')
    expect(receipt.dataAllowance).toBe('1.5 GB')
    expect(receipt.validity).toBe('7 days')
    expect(receipt.localAmount).toBe('350')
    expect(receipt.timeline.map((stage) => stage.label)).toEqual([
      'Order created',
      'NIM payment submitted',
      'NIM payment confirmed',
      'Data sent to provider',
      'Data delivered',
    ])
    expect(JSON.stringify(receipt)).not.toContain('08012345678')
  })
})
