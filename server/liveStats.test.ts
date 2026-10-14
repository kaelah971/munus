// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  InMemoryLiveStatsSource,
  LIVE_FEED_LIMIT,
  LiveStatsService,
  maskLiveWallet,
  normalizeDecimalAmount,
  type InMemoryLiveTables,
} from './liveStats'
import type { PaymentOrder } from '../src/domain/orders'
import type { EssentialRequest } from '../src/domain/essentialRequests'

const NOW = Date.parse('2026-10-14T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const iso = (ms: number) => new Date(ms).toISOString()

const WALLET_A = 'NQ32 8DSN PR0S 2PC0 61Q4 U1HT 5FDP RBNK 8KPM'
const WALLET_B = 'NQ47 1234 5678 90AB CDEF 1234 5678 90AB BCKQ'

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
    paymentStatus: 'PAID',
    fulfilmentStatus: 'DELIVERED',
    paymentNetwork: 'mainnet',
    paymentVerifiedAt: iso(NOW - DAY),
    fulfilledAt: iso(NOW - DAY),
    quoteLunaAmount: '50000',
    quotedCryptoAmount: '0.5',
    createdAt: iso(NOW - DAY),
    updatedAt: iso(NOW - DAY),
    ...overrides,
  }
}

function essential(overrides: Partial<EssentialRequest> = {}): EssentialRequest {
  return {
    id: 'req-1',
    ownerUserId: 'user-a',
    publicRequestId: 'public-1',
    serviceType: 'DATA',
    network: 'Airtel',
    requestedAmount: '350',
    planDataAllowance: '5 GB',
    planDisplayLabel: '5GB - 30 days',
    recipientPhone: '08098765432',
    essentialStatus: 'COMPLETED',
    paymentOrderId: '123e4567-e89b-12d3-a456-426614174000',
    fulfilledAt: iso(NOW - 2 * DAY),
    expiresAt: iso(NOW + DAY),
    createdAt: iso(NOW - 3 * DAY),
    updatedAt: iso(NOW - 2 * DAY),
    ...overrides,
  }
}

function tables(overrides: {
  users?: Array<{ id: string; walletAddress: string; network: string }>
  sessions?: Array<{ userId: string; createdAt: number }>
  orders?: PaymentOrder[]
  essentialRequests?: EssentialRequest[]
  supportRequests?: Array<{ ownerUserId: string; createdAt: string }>
} = {}): InMemoryLiveTables {
  const users = overrides.users ?? [{ id: 'user-a', walletAddress: WALLET_A, network: 'mainnet' }]
  const sessions = overrides.sessions ?? [{ userId: 'user-a', createdAt: NOW - DAY }]
  return {
    users: () => users,
    sessions: () => sessions,
    orders: () => overrides.orders ?? [],
    essentialRequests: () => overrides.essentialRequests ?? [],
    supportRequests: () => overrides.supportRequests ?? [],
  }
}

function serviceFor(input: InMemoryLiveTables, nowMs = NOW) {
  return new LiveStatsService(new InMemoryLiveStatsSource(input), { now: () => nowMs })
}

describe('Munus Live metric definitions', () => {
  it('counts distinct verified mainnet wallets, never sessions', async () => {
    const snapshot = await serviceFor(tables({
      users: [
        { id: 'user-a', walletAddress: WALLET_A, network: 'mainnet' },
        { id: 'user-b', walletAddress: WALLET_B, network: 'mainnet' },
        { id: 'user-test', walletAddress: 'NQ99 TEST', network: 'testnet' },
      ],
      sessions: [
        { userId: 'user-a', createdAt: NOW - DAY },
        { userId: 'user-a', createdAt: NOW - 2 * DAY },
        { userId: 'user-a', createdAt: NOW - 3 * DAY },
        { userId: 'user-b', createdAt: NOW - DAY },
      ],
    })).getSnapshot()
    expect(snapshot.metrics.verifiedWallets).toBe(2)
    expect(snapshot.metrics.activeUsers7d).toBe(2)
  })

  it('drops stale activity outside the 7-day window', async () => {
    const snapshot = await serviceFor(tables({
      sessions: [{ userId: 'user-a', createdAt: NOW - 8 * DAY }],
    })).getSnapshot()
    expect(snapshot.metrics.activeUsers7d).toBe(0)
  })

  it('counts orders and support requests as user activity', async () => {
    const snapshot = await serviceFor(tables({
      users: [
        { id: 'user-a', walletAddress: WALLET_A, network: 'mainnet' },
        { id: 'user-b', walletAddress: WALLET_B, network: 'mainnet' },
      ],
      sessions: [],
      orders: [order({ userId: 'user-a', createdAt: iso(NOW - DAY) })],
      supportRequests: [{ ownerUserId: 'user-b', createdAt: iso(NOW - 2 * DAY) }],
    })).getSnapshot()
    expect(snapshot.metrics.activeUsers7d).toBe(2)
  })

  it('excludes testnet payments, unpaid quotes, and undelivered orders from delivery evidence', async () => {
    const snapshot = await serviceFor(tables({
      orders: [
        order({ id: 'testnet', paymentNetwork: 'testnet' }),
        order({ id: 'quote', paymentStatus: 'READY_FOR_PAYMENT', fulfilmentStatus: 'NOT_STARTED' }),
        order({ id: 'undelivered', fulfilmentStatus: 'FULFILLING' }),
        order({ id: 'failed', fulfilmentStatus: 'FULFILLMENT_FAILED' }),
        order({ id: 'recovery', fulfilmentStatus: 'RECOVERY_REQUIRED' }),
      ],
    })).getSnapshot()
    expect(snapshot.metrics.deliveredEssentials).toBe(0)
    // Verified on-chain movement still counts as NIM volume even when
    // delivery did not complete: moved NIM is moved NIM. Only the three
    // mainnet PAID orders qualify (testnet and the unpaid quote do not).
    expect(snapshot.metrics.nimUsed).toBe('1.5')
    expect(snapshot.metrics.nimPayments).toBe(3)
  })

  it('counts verified mainnet deliveries with exact NIM volume', async () => {
    const snapshot = await serviceFor(tables({
      orders: [
        order({ quoteLunaAmount: '50000' }),
        order({ id: '22222222-2222-2222-2222-222222222222', quoteLunaAmount: '1250000', requestedAmount: '25000' }),
      ],
    })).getSnapshot()
    expect(snapshot.metrics.deliveredEssentials).toBe(2)
    expect(snapshot.metrics.nimUsed).toBe('13')
    expect(snapshot.metrics.nimPayments).toBe(2)
  })

  it('counts only settled cash-outs with exact USDT volume', async () => {
    const cashout = (overrides: Partial<PaymentOrder> = {}) => order({
      id: '33333333-3333-3333-3333-333333333333',
      serviceType: 'CASH_OUT',
      paymentAsset: 'USDT',
      recipientPhone: undefined,
      requestedAmount: '100',
      requestedCurrency: 'USDT',
      paymentNetwork: undefined,
      quoteLunaAmount: undefined,
      quotedCryptoAmount: '101.5',
      bankCode: 'GTB',
      bankName: 'GTBank',
      bankAccountNumber: '0123456789',
      bankAccountName: 'ADA OKAFOR',
      provider: 'paycrest',
      providerRef: 'pc-1',
      usdtTotalAmount: '101.5',
      payoutNgnAmount: '152250',
      ...overrides,
    })
    const snapshot = await serviceFor(tables({
      orders: [
        cashout(),
        cashout({ id: '44444444-4444-4444-4444-444444444444', paymentStatus: 'ONCHAIN_PENDING', fulfilmentStatus: 'NOT_STARTED' }),
        cashout({ id: '55555555-5555-5555-5555-555555555555', paymentStatus: 'READY_FOR_PAYMENT', fulfilmentStatus: 'NOT_STARTED' }),
      ],
    })).getSnapshot()
    expect(snapshot.metrics.cashoutOrders).toBe(1)
    expect(snapshot.metrics.usdtCashedOut).toBe('101.5')
  })

  it('counts completed requests only with linked real fulfilment', async () => {
    const linked = order()
    const snapshot = await serviceFor(tables({
      orders: [
        linked,
        order({ id: 'testnet-order', paymentNetwork: 'testnet' }),
      ],
      essentialRequests: [
        essential({ paymentOrderId: linked.id }),
        essential({ id: 'req-nolink', paymentOrderId: undefined }),
        essential({ id: 'req-testnet', paymentOrderId: 'testnet-order' }),
        essential({ id: 'req-open', essentialStatus: 'NEEDS_ATTENTION', paymentOrderId: linked.id }),
      ],
    })).getSnapshot()
    expect(snapshot.metrics.requestsCompleted).toBe(1)
  })

  it('reports a truthful zero state', async () => {
    const snapshot = await serviceFor(tables({ users: [], sessions: [] })).getSnapshot()
    expect(snapshot.metrics).toEqual({
      verifiedWallets: 0,
      activeUsers7d: 0,
      deliveredEssentials: 0,
      nimUsed: '0',
      nimPayments: 0,
      cashoutOrders: 0,
      usdtCashedOut: '0',
      requestsCompleted: 0,
    })
    expect(snapshot.recentActivity).toEqual([])
    expect(snapshot.updatedAt).toBe(iso(NOW))
  })
})

describe('Munus Live activity feed', () => {
  function feedTables(): InMemoryLiveTables {
    const delivered = order({ fulfilledAt: iso(NOW - 5 * 60 * 60 * 1000) })
    const data = order({
      id: '66666666-6666-6666-6666-666666666666',
      serviceType: 'DATA',
      recipientNetwork: 'Airtel',
      planDataAllowance: '5 GB',
      fulfilledAt: iso(NOW - 2 * 60 * 60 * 1000),
    })
    const cashout = order({
      id: '77777777-7777-7777-7777-777777777777',
      serviceType: 'CASH_OUT',
      paymentAsset: 'USDT',
      recipientPhone: undefined,
      requestedAmount: '100',
      requestedCurrency: 'USDT',
      paymentNetwork: undefined,
      quoteLunaAmount: undefined,
      quotedCryptoAmount: '101.5',
      bankAccountNumber: '0123456789',
      bankAccountName: 'ADA OKAFOR',
      provider: 'paycrest',
      providerRef: 'pc-9',
      walletTxRef: 'ab'.repeat(32),
      usdtTotalAmount: '100',
      fulfilledAt: iso(NOW - 60 * 60 * 1000),
    })
    return tables({
      users: [
        { id: 'user-a', walletAddress: WALLET_A, network: 'mainnet' },
        { id: 'user-b', walletAddress: WALLET_B, network: 'mainnet' },
      ],
      sessions: [
        { userId: 'user-a', createdAt: NOW - 10 * DAY },
        { userId: 'user-b', createdAt: NOW - 30 * 60 * 1000 },
      ],
      orders: [delivered, data, cashout],
      essentialRequests: [essential()],
    })
  }

  it('emits newest-first privacy-safe events', async () => {
    const snapshot = await serviceFor(feedTables()).getSnapshot()
    const kinds = snapshot.recentActivity.map((event) => event.kind)
    expect(kinds).toEqual([
      'wallet-joined',
      'cashout-settled',
      'data-delivered',
      'airtime-delivered',
      'request-completed',
      'wallet-joined',
    ])
    const data = snapshot.recentActivity.find((event) => event.kind === 'data-delivered')
    expect(data).toMatchObject({ network: 'Airtel', dataAllowance: '5 GB', walletMasked: 'NQ32…8KPM' })
    const cashout = snapshot.recentActivity.find((event) => event.kind === 'cashout-settled')
    expect(cashout).toMatchObject({ usdtAmount: '100', walletMasked: 'NQ32…8KPM' })
    const request = snapshot.recentActivity.find((event) => event.kind === 'request-completed')
    expect(request).toMatchObject({ serviceLabel: 'Data', detail: '5 GB · Airtel' })
  })

  it('never leaks private fields', async () => {
    const snapshot = await serviceFor(feedTables()).getSnapshot()
    const serialized = JSON.stringify(snapshot)
    expect(serialized).not.toContain('08012345678')
    expect(serialized).not.toContain('08098765432')
    expect(serialized).not.toContain('0123456789')
    expect(serialized).not.toContain('ADA OKAFOR')
    expect(serialized).not.toContain('ab'.repeat(32))
    expect(serialized).not.toContain('pc-9')
    expect(serialized).not.toContain('user-a')
    expect(serialized).not.toContain('public-1')
    expect(serialized).not.toContain('NQ32 8DSN')
    expect(serialized).toContain('NQ32…8KPM')
  })

  it('bounds the feed to the newest events', async () => {
    const baseOrders = [
      order({ fulfilledAt: iso(NOW - 5 * 60 * 60 * 1000) }),
    ]
    const extra = Array.from({ length: 12 }, (_, index) => order({
      id: `88888888-8888-8888-8888-${String(index).padStart(12, '0')}`,
      fulfilledAt: iso(NOW - (index + 1) * 60 * 1000),
    }))
    const snapshot = await serviceFor(tables({ orders: [...baseOrders, ...extra] })).getSnapshot()
    expect(snapshot.recentActivity).toHaveLength(LIVE_FEED_LIMIT)
    const times = snapshot.recentActivity.map((event) => Date.parse(event.at))
    expect([...times].sort((a, b) => b - a)).toEqual(times)
  })
})

describe('Munus Live helpers and cache', () => {
  it('masks wallets and normalizes decimals exactly', () => {
    expect(maskLiveWallet(WALLET_A)).toBe('NQ32…8KPM')
    expect(maskLiveWallet('short')).toBe('••••')
    expect(normalizeDecimalAmount('101.50000000')).toBe('101.5')
    expect(normalizeDecimalAmount('100.00000000')).toBe('100')
    expect(normalizeDecimalAmount('0')).toBe('0')
    expect(() => normalizeDecimalAmount('1e5')).toThrow()
  })

  it('caches snapshots for the documented TTL', async () => {
    let nowMs = NOW
    const source = new InMemoryLiveStatsSource(tables())
    const sourceSpy = vi.spyOn(source, 'countVerifiedWallets')
    const service = new LiveStatsService(source, { now: () => nowMs, ttlMs: 60_000 })
    const first = await service.getSnapshot()
    const second = await service.getSnapshot()
    expect(second).toBe(first)
    expect(sourceSpy).toHaveBeenCalledTimes(1)
    nowMs += 60_001
    const third = await service.getSnapshot()
    expect(third).not.toBe(first)
    expect(third.updatedAt).toBe(iso(NOW + 60_001))
    expect(sourceSpy).toHaveBeenCalledTimes(2)
  })
})
