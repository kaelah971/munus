// @vitest-environment node
import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import type { PaymentOrder } from '../src/domain/orders'
import { InMemoryPaymentRepository } from './paymentRepository'
import { parsePaymentOrderDraft } from './paymentValidation'
import type { AirtimeFulfilmentService } from './airtimeFulfilment'
import type { NimRateProvider } from './nimRates'
import { NimRateError } from './nimRates'
import type { ChainTransaction, NimiqChainReader } from './nimiqChain'
import { NimPaymentService } from './nimPayments'

const RECEIVER = KeyPair.generate().toAddress().toUserFriendlyAddress()
const SENDER = KeyPair.generate().toAddress().toUserFriendlyAddress()
const HASH = 'cd'.repeat(32)
const OTHER_HASH = 'ef'.repeat(32)
const NOW = new Date('2026-10-14T12:00:00.000Z').getTime()

const airtimeDraft = {
  serviceType: 'AIRTIME',
  paymentAsset: 'NIM',
  recipientPhone: '08012345678',
  recipientNetwork: 'MTN',
  requestedAmount: '1000',
}

class FixtureRates implements NimRateProvider {
  rate = '2000'
  error: Error | null = null
  calls = 0

  async getNimNgnRate() {
    this.calls += 1
    if (this.error) throw this.error
    return { rateNgnPerNim: this.rate, source: 'fixture', observedAt: new Date(NOW).toISOString() }
  }
}

class FixtureChain implements NimiqChainReader {
  transaction: ChainTransaction | null = null
  error: Error | null = null
  head: number | null = 1000
  headError: Error | null = null
  accountBalance: string | null = null
  accountError: Error | null = null
  accountQueries: string[] = []

  async getTransaction(): Promise<ChainTransaction | null> {
    if (this.error) throw this.error
    return this.transaction
  }

  async getHeadBlockNumber(): Promise<number> {
    if (this.headError) throw this.headError
    if (this.head === null) throw new Error('no head')
    return this.head
  }

  async getAccountBalance(address: string): Promise<string> {
    this.accountQueries.push(address)
    if (this.accountError) throw this.accountError
    if (this.accountBalance === null) throw new Error('no account balance in fixture')
    return this.accountBalance
  }
}

function matchingTransaction(overrides: Partial<ChainTransaction> = {}): ChainTransaction {
  return {
    hash: HASH,
    from: SENDER,
    to: RECEIVER,
    valueLuna: '50000',
    networkId: 42,
    blockNumber: 990,
    confirmations: 10,
    dataFields: ['MNS:placeholder'],
    ...overrides,
  }
}

function setup(options: { network?: 'mainnet' | 'testnet'; receiver?: string } = {}) {
  const repository = new InMemoryPaymentRepository()
  const rates = new FixtureRates()
  const chain = new FixtureChain()
  const fulfilCalls: string[] = []
  const fulfilment = {
    fulfilOrder: async (userId: string, orderId: string) => {
      fulfilCalls.push(orderId)
      const order = await repository.getOrder(userId, orderId)
      if (order && order.fulfilmentStatus === 'NOT_STARTED') order.fulfilmentStatus = 'FULFILLING'
      return order
    },
  } as unknown as AirtimeFulfilmentService
  const service = new NimPaymentService(repository, rates, chain, fulfilment, {
    receiverAddress: options.receiver ?? RECEIVER,
    network: options.network ?? 'mainnet',
    quoteTtlMs: 120_000,
    now: () => NOW,
  })
  return { repository, rates, chain, fulfilCalls, service }
}

async function draftOrder(repository: InMemoryPaymentRepository, draft: Record<string, string> = airtimeDraft): Promise<PaymentOrder> {
  return repository.createOrder(
    'user-a',
    parsePaymentOrderDraft({ ...draft }),
  )
}

async function quotedOrder(
  service: NimPaymentService,
  repository: InMemoryPaymentRepository,
  orderId?: string,
): Promise<PaymentOrder> {
  const id = orderId ?? (await draftOrder(repository)).id
  return service.createQuote('user-a', id)
}

describe('NIM payment service', () => {
  it('creates a persisted quote from a live rate with exact luna math', async () => {
    const { repository, rates, service } = setup()
    const created = await draftOrder(repository)

    const quoted = await service.createQuote('user-a', created.id)

    expect(rates.calls).toBe(1)
    expect(quoted).toMatchObject({
      paymentStatus: 'READY_FOR_PAYMENT',
      quotedCryptoAmount: '0.5',
      quoteLunaAmount: '50000',
      quoteRateNgnPerNim: '2000',
      quoteSource: 'fixture',
      paymentNetwork: 'mainnet',
      paymentReceiver: RECEIVER,
    })
    expect(quoted.paymentMemo).toMatch(/^MNS:[0-9a-f]{12}$/)
    expect(quoted.quoteExpiresAt).toBe(new Date(NOW + 120_000).toISOString())
  })

  it('fails closed when pricing is unavailable, leaving the draft untouched', async () => {
    const { repository, rates, service } = setup()
    rates.error = new NimRateError('Live NIM rate is unavailable. No quote was created.')
    const created = await draftOrder(repository)

    await expect(service.createQuote('user-a', created.id)).rejects.toBeInstanceOf(NimRateError)
    const untouched = await repository.getOrder('user-a', created.id)
    expect(untouched).toMatchObject({ paymentStatus: 'DRAFT' })
    expect(untouched?.quotedCryptoAmount).toBeUndefined()
    expect(untouched?.quoteLunaAmount).toBeUndefined()
  })

  it('rejects quotes for non-NIM, snapshot-less, and non-draft orders', async () => {
    const { repository, rates, service } = setup()
    const data = await draftOrder(repository, { ...airtimeDraft, serviceType: 'DATA' })
    const usdt = await draftOrder(repository, { ...airtimeDraft, paymentAsset: 'USDT' })
    await expect(service.createQuote('user-a', data.id)).rejects.toMatchObject({ statusCode: 400 })
    await expect(service.createQuote('user-a', usdt.id)).rejects.toMatchObject({ statusCode: 400 })
    expect(rates.calls).toBe(0)
    await expect(service.createQuote('user-a', 'missing')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('quotes data orders from the snapshotted bundle price', async () => {
    const { repository, rates, service } = setup()
    const created = await repository.createOrder('user-a', parsePaymentOrderDraft(airtimeDraft))
    const stored = repository.orders.get(created.id)
    if (!stored) throw new Error('Fixture order was not stored.')
    // A snapshotted data order prices from the bundle, whatever the draft said.
    Object.assign(stored, {
      serviceType: 'DATA',
      requestedAmount: '350',
      providerPlanId: 'MTN-15',
      planDisplayLabel: '1.5GB - 7 days',
    })

    const quoted = await service.createQuote('user-a', created.id)
    expect(rates.calls).toBe(1)
    expect(quoted).toMatchObject({
      paymentStatus: 'READY_FOR_PAYMENT',
      quotedCryptoAmount: '0.175',
      quoteLunaAmount: '17500',
      providerPlanId: 'MTN-15',
    })
  })

  it('refuses wallet progress once the quote expires', async () => {
    let now = NOW
    const { repository, rates, chain } = setup()
    const service = new NimPaymentService(repository, rates, chain, null, {
      receiverAddress: RECEIVER,
      network: 'mainnet',
      quoteTtlMs: 120_000,
      now: () => now,
    })
    const quoted = await quotedOrder(service, repository)

    now = NOW + 120_001
    await expect(service.createPaymentIntent('user-a', quoted.id)).rejects.toMatchObject({ statusCode: 410 })
    await expect(service.submitPayment('user-a', quoted.id, HASH)).rejects.toMatchObject({ statusCode: 410 })
    expect(await repository.getOrder('user-a', quoted.id)).toMatchObject({ paymentStatus: 'READY_FOR_PAYMENT' })
  })

  it('verifies an exact transaction to PAID and hands off exactly once', async () => {
    const { repository, chain, fulfilCalls, service } = setup()
    const quoted = await quotedOrder(service, repository)
    const memo = quoted.paymentMemo ?? ''
    chain.transaction = matchingTransaction({ dataFields: [memo] })

    const { intent } = await service.createPaymentIntent('user-a', quoted.id)
    expect(intent).toMatchObject({ receiver: RECEIVER, lunaAmount: '50000', memo, network: 'mainnet' })
    expect(await repository.getOrder('user-a', quoted.id)).toMatchObject({ paymentStatus: 'AWAITING_WALLET_APPROVAL' })

    const settled = await service.submitPayment('user-a', quoted.id, HASH)
    expect(settled).toMatchObject({
      paymentStatus: 'PAID',
      walletTxRef: HASH,
      paymentSender: SENDER,
      paymentReceiver: RECEIVER,
      paymentBlockNumber: '990',
      paymentConfirmations: 10,
    })
    expect(settled.paymentVerifiedAt).toBeDefined()
    expect(fulfilCalls).toEqual([quoted.id])

    // Duplicate submission and repeat reconciliation never double-hand off.
    expect(await service.submitPayment('user-a', quoted.id, HASH)).toMatchObject({ paymentStatus: 'PAID' })
    expect(await service.reconcilePayment('user-a', quoted.id)).toMatchObject({ paymentStatus: 'PAID' })
    expect(fulfilCalls).toEqual([quoted.id])
  })

  it('treats the wallet result as a submission reference, not proof', async () => {
    const { repository, chain, fulfilCalls, service } = setup()
    const quoted = await quotedOrder(service, repository)
    chain.transaction = null

    const pending = await service.submitPayment('user-a', quoted.id, HASH)
    expect(pending).toMatchObject({ paymentStatus: 'ONCHAIN_PENDING', walletTxRef: HASH })
    expect(pending.paymentSender).toBeUndefined()
    expect(fulfilCalls).toEqual([])

    // Later confirmation settles the same pending order.
    const memo = quoted.paymentMemo ?? ''
    chain.transaction = matchingTransaction({ dataFields: [memo] })
    expect(await service.reconcilePayment('user-a', quoted.id)).toMatchObject({ paymentStatus: 'PAID' })
    expect(fulfilCalls).toEqual([quoted.id])
  })

  it('rides out RPC outages as retryable pending, never failed', async () => {
    const { repository, chain, service } = setup()
    const quoted = await quotedOrder(service, repository)
    chain.error = new Error('connection reset')

    const pending = await service.submitPayment('user-a', quoted.id, HASH)
    expect(pending.paymentStatus).toBe('ONCHAIN_PENDING')
    chain.error = null
    chain.headError = new Error('no head yet')
    chain.transaction = matchingTransaction({ dataFields: [quoted.paymentMemo ?? ''], confirmations: 0 })
    // Head unavailable with zero confirmations: still pending, still safe.
    expect(await service.reconcilePayment('user-a', quoted.id)).toMatchObject({ paymentStatus: 'ONCHAIN_PENDING' })
  })

  it('fails payments with affirmative chain mismatches and never fulfils them', async () => {
    const cases: Array<{ name: string; override: Partial<ChainTransaction>; reason: string }> = [
      { name: 'wrong receiver', override: { to: KeyPair.generate().toAddress().toUserFriendlyAddress() }, reason: 'wrong-recipient' },
      { name: 'wrong amount', override: { valueLuna: '49999' }, reason: 'wrong-amount' },
      { name: 'wrong network', override: { networkId: 53 }, reason: 'wrong-network' },
      { name: 'wrong memo', override: { dataFields: ['MNS:ffffffffffff'] }, reason: 'wrong-memo' },
    ]
    for (const { override, reason } of cases) {
      const { repository, chain, fulfilCalls, service } = setup()
      const quoted = await quotedOrder(service, repository)
      chain.transaction = matchingTransaction({ dataFields: [quoted.paymentMemo ?? ''], ...override })
      const failed = await service.submitPayment('user-a', quoted.id, HASH)
      expect(failed).toMatchObject({ paymentStatus: 'PAYMENT_FAILED', paymentFailureReason: reason })
      expect(fulfilCalls).toEqual([])
    }
  })

  it('rejects malformed hashes and conflicting bindings', async () => {
    const { repository, service } = setup()
    const quoted = await quotedOrder(service, repository)

    await expect(service.submitPayment('user-a', quoted.id, 'not-a-hash')).rejects.toMatchObject({ statusCode: 400 })
    expect(await repository.getOrder('user-a', quoted.id)).toMatchObject({ paymentStatus: 'READY_FOR_PAYMENT' })

    // Bind the order, then prove a different hash is refused.
    const stored = repository.orders.get(quoted.id)
    if (!stored) throw new Error('Fixture order missing.')
    stored.paymentStatus = 'ONCHAIN_PENDING'
    stored.walletTxRef = HASH
    await expect(service.submitPayment('user-a', quoted.id, OTHER_HASH)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('never triggers provider spend from a testnet payment', async () => {
    const { repository, chain, fulfilCalls, service } = setup({ network: 'testnet' })
    const quoted = await quotedOrder(service, repository)
    expect(quoted.paymentNetwork).toBe('testnet')
    chain.transaction = matchingTransaction({ networkId: undefined, dataFields: [quoted.paymentMemo ?? ''] })

    const paid = await service.submitPayment('user-a', quoted.id, HASH)
    expect(paid).toMatchObject({ paymentStatus: 'PAID', paymentNetwork: 'testnet' })
    expect(fulfilCalls).toEqual([])
    expect(await repository.getOrder('user-a', quoted.id)).toMatchObject({ fulfilmentStatus: 'NOT_STARTED' })
  })

  it('survives fulfilment trouble without losing the verified payment', async () => {
    const { repository, rates, chain } = setup()
    const failing = {
      fulfilOrder: async () => { throw new Error('provider callback not configured') },
    } as unknown as AirtimeFulfilmentService
    const service = new NimPaymentService(repository, rates, chain, failing, {
      receiverAddress: RECEIVER,
      network: 'mainnet',
      quoteTtlMs: 120_000,
      now: () => NOW,
    })
    const quoted = await quotedOrder(service, repository)
    chain.transaction = matchingTransaction({ dataFields: [quoted.paymentMemo ?? ''] })

    const paid = await service.submitPayment('user-a', quoted.id, HASH)
    expect(paid).toMatchObject({ paymentStatus: 'PAID', fulfilmentStatus: 'NOT_STARTED' })
  })

  it('notifies essential sync on settlement without risking payment', async () => {
    const { repository, rates, chain } = setup()
    const settled: string[] = []
    const failingHook = async () => { throw new Error('sync down') }
    const service = new NimPaymentService(repository, rates, chain, null, {
      receiverAddress: RECEIVER,
      network: 'mainnet',
      quoteTtlMs: 120_000,
      now: () => NOW,
      onPaymentSettled: async (order) => { settled.push(order.id) },
    })
    const quoted = await quotedOrder(service, repository)
    const stored = repository.orders.get(quoted.id)
    if (!stored) throw new Error('Fixture order was not stored.')
    stored.essentialRequestId = 'req-1'
    chain.transaction = matchingTransaction({ dataFields: [quoted.paymentMemo ?? ''] })

    const paid = await service.submitPayment('user-a', quoted.id, HASH)
    expect(paid.paymentStatus).toBe('PAID')
    expect(settled).toEqual([quoted.id])

    const failingService = new NimPaymentService(repository, rates, chain, null, {
      receiverAddress: RECEIVER,
      network: 'mainnet',
      quoteTtlMs: 120_000,
      now: () => NOW,
      onPaymentSettled: failingHook,
    })
    const second = await draftOrder(repository)
    const secondStored = repository.orders.get(second.id)
    if (!secondStored) throw new Error('Fixture order was not stored.')
    secondStored.essentialRequestId = 'req-2'
    const secondQuoted = await failingService.createQuote('user-a', second.id)
    chain.transaction = matchingTransaction({ hash: OTHER_HASH, dataFields: [secondQuoted.paymentMemo ?? ''] })
    // Hook failure never fails the payment itself.
    const paidAgain = await failingService.submitPayment('user-a', second.id, OTHER_HASH)
    expect(paidAgain.paymentStatus).toBe('PAID')
  })

  it('reads the session wallet balance without accepting client addresses', async () => {
    const { service, chain } = setup()
    chain.accountBalance = '22100000'
    const balance = await service.getSessionWalletBalance(RECEIVER)
    expect(balance).toEqual({
      balanceLuna: '22100000',
      balanceNim: '221',
      network: 'mainnet',
      source: 'rpc',
    })
    // Normalized canonical address, never a client-supplied alternative.
    expect(chain.accountQueries).toEqual([RECEIVER])
    chain.accountBalance = '0'
    await expect(service.getSessionWalletBalance(RECEIVER)).resolves.toMatchObject({
      balanceLuna: '0',
      balanceNim: '0',
    })
  })

  it('fails closed on unconfigured chain, bad identity, and RPC failure', async () => {
    const { repository, rates } = setup()
    const noChain = new NimPaymentService(repository, rates, null, null, {
      receiverAddress: RECEIVER,
      network: 'mainnet',
      quoteTtlMs: 120_000,
      now: () => NOW,
    })
    await expect(noChain.getSessionWalletBalance(RECEIVER)).rejects.toMatchObject({ statusCode: 503 })
    const { service } = setup()
    await expect(service.getSessionWalletBalance('not-an-address')).rejects.toMatchObject({ statusCode: 400 })
    const failing = setup()
    failing.chain.accountError = new Error('rpc down')
    await expect(failing.service.getSessionWalletBalance(RECEIVER)).rejects.toMatchObject({
      name: 'NimiqChainError',
      statusCode: 503,
    })
  })

  it('balances host-exposed addresses with exact aggregate math', async () => {
    const addrA = KeyPair.generate().toAddress().toUserFriendlyAddress()
    const addrB = KeyPair.generate().toAddress().toUserFriendlyAddress()
    const balances: Record<string, string> = { [addrA]: '22100000', [addrB]: '500' }
    const seen: string[] = []
    const chain = {
      getTransaction: async () => null,
      getHeadBlockNumber: async () => 1000,
      getAccountBalance: async (address: string) => {
        seen.push(address)
        return balances[address] ?? '0'
      },
    }
    const { repository, rates } = setup()
    const svc = new NimPaymentService(repository, rates, chain as never, null, {
      receiverAddress: RECEIVER,
      network: 'mainnet',
      quoteTtlMs: 120_000,
      now: () => NOW,
    })
    const report = await svc.getAccountBalances([addrA, addrB])
    expect(seen).toEqual([addrA, addrB])
    expect(report.accounts).toHaveLength(2)
    expect(report.accounts[0]).toMatchObject({ ok: true, balanceLuna: '22100000', balanceNim: '221' })
    expect(report.accounts[1]).toMatchObject({ ok: true, balanceLuna: '500', balanceNim: '0.005' })
    expect(report).toMatchObject({ aggregateLuna: '22100500', aggregateNim: '221.005', okCount: 2, network: 'mainnet' })
    expect(JSON.stringify(report)).not.toContain(addrA)
    expect(JSON.stringify(report)).not.toContain(addrB)
  })

  it('keeps per-address failures out of the aggregate without zeroing them', async () => {
    const addrA = KeyPair.generate().toAddress().toUserFriendlyAddress()
    const addrB = KeyPair.generate().toAddress().toUserFriendlyAddress()
    const { repository, rates } = setup()
    const chain = {
      getTransaction: async () => null,
      getHeadBlockNumber: async () => 1000,
      getAccountBalance: async (address: string) => {
        if (address === addrA) throw new Error('rpc down')
        return '500'
      },
    }
    const svc = new NimPaymentService(repository, rates, chain as never, null, {
      receiverAddress: RECEIVER,
      network: 'mainnet',
      quoteTtlMs: 120_000,
      now: () => NOW,
    })
    const report = await svc.getAccountBalances([addrA, addrB, 'junk'])
    expect(report.accounts[0]).toMatchObject({ ok: false })
    expect(report.accounts[1]).toMatchObject({ ok: true, balanceLuna: '500' })
    expect(report.accounts[2]).toMatchObject({ ok: false })
    expect(report).toMatchObject({ aggregateLuna: '500', aggregateNim: '0.005', okCount: 1 })
    await expect(svc.getAccountBalances([])).rejects.toMatchObject({ statusCode: 400 })
    await expect(svc.getAccountBalances(new Array(11).fill(addrB))).rejects.toMatchObject({ statusCode: 400 })
  })

  it('requires a configured receiver before quoting', async () => {
    const { repository, rates, chain } = setup({ receiver: '' })
    const service = new NimPaymentService(repository, rates, chain, null, {
      receiverAddress: '',
      network: 'mainnet',
      quoteTtlMs: 120_000,
      now: () => NOW,
    })
    const created = await draftOrder(repository)
    await expect(service.createQuote('user-a', created.id)).rejects.toMatchObject({ statusCode: 503 })
  })
})
