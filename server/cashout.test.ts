// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { InMemoryPaymentRepository } from './paymentRepository'
import { CashoutService } from './cashout'
import { PaycrestClient } from './paycrest'
import type { PaymentOrder } from '../src/domain/orders'

const CREDENTIALS = { apiKey: 'fixture-key', apiSecret: 'fixture-secret' }
const REFUND = `0x${'cc'.repeat(20)}`
const RECEIVER = `0x${'dd'.repeat(20)}`
const NOW = Date.parse('2026-10-14T12:00:00.000Z')

function paycrest(fetchJson: (url: string) => Promise<unknown>) {
  return new PaycrestClient({ credentials: CREDENTIALS, fetchJson })
}

function setup(options: {
  network?: 'mainnet' | 'testnet'
  fetchJson?: (url: string) => Promise<unknown>
  contract?: string
  refund?: string
} = {}) {
  const payment = new InMemoryPaymentRepository()
  const seen: string[] = []
  const provider = paycrest(async (url) => {
    seen.push(url)
    if (options.fetchJson) return options.fetchJson(url)
    if (url.includes('/institutions/')) return [{ code: 'GTB', name: 'GTBank' }]
    if (url.includes('/verify-account')) return { data: 'ADA OKAFOR' }
    if (url.includes('/v2/rates/')) return { rate: 1500 }
    if (url.includes('/sender/orders') && !url.includes('/sender/orders/')) {
      return {
        id: 'pc-1',
        receiveAddress: RECEIVER,
        validUntil: new Date(NOW + 600_000).toISOString(),
        amount: '100',
        senderFee: '1',
        transactionFee: '0.5',
        totalAmount: '101.5',
        destination: { amount: '152250' },
        status: 'initiated',
      }
    }
    return { id: 'pc-1', status: 'initiated' }
  })
  const service = new CashoutService(payment, provider, {
    network: options.network ?? 'mainnet',
    quoteTtlMs: 120_000,
    usdtContractAddress: options.contract ?? `0x${'ab'.repeat(20)}`,
    refundAddress: options.refund ?? REFUND,
    now: () => NOW,
  })
  return { payment, service, seen }
}

async function draftOrder(payment: InMemoryPaymentRepository): Promise<PaymentOrder> {
  return payment.createOrder('user-a', {
    serviceType: 'CASH_OUT',
    paymentAsset: 'USDT',
    requestedAmount: '100',
    requestedCurrency: 'USDT',
    bankCode: 'GTB',
    bankName: 'GTBank',
    bankAccountNumber: '0123456789',
    bankAccountName: 'ADA OKAFOR',
  })
}

describe('cash-out service', () => {
  it('creates orders with verified bank snapshots', async () => {
    const { service } = setup()
    const order = await service.createCashoutOrder('user-a', {
      usdtAmount: '100.00',
      bankCode: 'GTB',
      accountNumber: '0123 456 789',
    })
    expect(order).toMatchObject({
      serviceType: 'CASH_OUT',
      paymentAsset: 'USDT',
      requestedAmount: '100',
      requestedCurrency: 'USDT',
      bankCode: 'GTB',
      bankName: 'GTBank',
      bankAccountNumber: '0123456789',
      bankAccountName: 'ADA OKAFOR',
      paymentStatus: 'DRAFT',
    })
    expect(order.recipientPhone).toBeUndefined()
  })

  it('fails closed on testnet, unknown banks, and unverified accounts', async () => {
    const { service } = setup()
    await expect(service.createCashoutOrder('user-a', {
      usdtAmount: '100', bankCode: 'NOPE', accountNumber: '0123456789',
    })).rejects.toMatchObject({ statusCode: 400 })
    await expect(service.createCashoutOrder('user-a', {
      usdtAmount: '0', bankCode: 'GTB', accountNumber: '0123456789',
    })).rejects.toMatchObject({ statusCode: 400 })
    const testnet = setup({ network: 'testnet' })
    await expect(testnet.service.createCashoutOrder('user-a', {
      usdtAmount: '100', bankCode: 'GTB', accountNumber: '0123456789',
    })).rejects.toMatchObject({ statusCode: 409 })
    const noName = setup({
      fetchJson: async (url) => {
        if (url.includes('/institutions/')) return [{ code: 'GTB', name: 'GTBank' }]
        return { message: 'OK' }
      },
    })
    await expect(noName.service.createCashoutOrder('user-a', {
      usdtAmount: '100', bankCode: 'GTB', accountNumber: '0123456789',
    })).rejects.toThrow('could not be verified')
  })

  it('records authoritative quote figures and binds intent', async () => {
    const { payment, service } = setup()
    const created = await draftOrder(payment)
    const quoted = await service.createCashoutQuote('user-a', created.id)
    expect(quoted).toMatchObject({
      paymentStatus: 'READY_FOR_PAYMENT',
      provider: 'paycrest',
      providerRef: 'pc-1',
      paycrestReceiveAddress: RECEIVER,
      payoutNgnAmount: '152250',
      usdtTotalAmount: '101.5',
      quotedCryptoAmount: '101.5',
    })
    const { intent } = await service.createCashoutIntent('user-a', created.id)
    expect(intent).toMatchObject({
      receiveAddress: RECEIVER,
      totalBaseUnits: '101500000',
      chainIdHex: '0x89',
    })
    expect(intent.contractAddress).toMatch(/^0x[0-9a-fA-F]{40}$/)
  })

  it('advances only on provider evidence, never on uncertainty', async () => {
    let paycrestStatus = 'initiated'
    const { payment, service } = setup({
      fetchJson: async (url) => {
        if (url.includes('/institutions/')) return [{ code: 'GTB', name: 'GTBank' }]
        if (url.includes('/verify-account')) return { data: 'ADA OKAFOR' }
        if (url.includes('/v2/rates/')) return { rate: 1500 }
        if (url.includes('/sender/orders/')) return { id: 'pc-1', status: paycrestStatus }
        return {
          id: 'pc-1',
          receiveAddress: RECEIVER,
          validUntil: new Date(NOW + 600_000).toISOString(),
          amount: '100',
          senderFee: '1',
          transactionFee: '0.5',
          totalAmount: '101.5',
          destination: { amount: '152250' },
          status: 'initiated',
        }
      },
    })
    const created = await draftOrder(payment)
    await service.createCashoutQuote('user-a', created.id)
    const hash = `0x${'ab'.repeat(32)}`
    await service.submitCashoutPayment('user-a', created.id, hash)

    expect((await service.reconcileCashoutOrder('user-a', created.id)).paymentStatus).toBe('ONCHAIN_PENDING')
    paycrestStatus = 'processing'
    expect(await service.reconcileCashoutOrder('user-a', created.id)).toMatchObject({
      paymentStatus: 'PAID',
      fulfilmentStatus: 'FULFILLING',
    })
    paycrestStatus = 'settled'
    expect(await service.reconcileCashoutOrder('user-a', created.id)).toMatchObject({
      paymentStatus: 'PAID',
      fulfilmentStatus: 'DELIVERED',
    })
  })

  it('maps refund, expiry, and failure without fabricating', async () => {
    const statuses: Record<string, unknown> = {}
    const { payment, service } = setup({
      fetchJson: async (url) => {
        if (url.includes('/institutions/')) return [{ code: 'GTB', name: 'GTBank' }]
        if (url.includes('/verify-account')) return { data: 'ADA OKAFOR' }
        if (url.includes('/v2/rates/')) return { rate: 1500 }
        if (url.includes('/sender/orders/')) return { id: 'pc-1', status: statuses.current ?? 'initiated' }
        return {
          id: 'pc-1',
          receiveAddress: RECEIVER,
          validUntil: new Date(NOW + 600_000).toISOString(),
          amount: '100',
          senderFee: '1',
          transactionFee: '0.5',
          totalAmount: '101.5',
          destination: { amount: '152250' },
          status: 'initiated',
        }
      },
    })
    const created = await draftOrder(payment)
    await service.createCashoutQuote('user-a', created.id)
    const hash = `0x${'ab'.repeat(32)}`
    await service.submitCashoutPayment('user-a', created.id, hash)

    statuses.current = 'refunded'
    expect(await service.reconcileCashoutOrder('user-a', created.id)).toMatchObject({
      paymentStatus: 'PAID',
      fulfilmentStatus: 'REFUNDED',
    })

    statuses.current = 'initiated'
    const second = await payment.createOrder('user-a', {
      serviceType: 'CASH_OUT',
      paymentAsset: 'USDT',
      requestedAmount: '50',
      requestedCurrency: 'USDT',
      bankCode: 'GTB',
      bankName: 'GTBank',
      bankAccountNumber: '0123456789',
      bankAccountName: 'ADA OKAFOR',
    })
    await service.createCashoutQuote('user-a', second.id)
    await service.submitCashoutPayment('user-a', second.id, `0x${'cd'.repeat(32)}`)
    statuses.current = 'expired'
    expect(await service.reconcileCashoutOrder('user-a', second.id)).toMatchObject({
      paymentStatus: 'ONCHAIN_PENDING',
      fulfilmentStatus: 'RECOVERY_REQUIRED',
    })
    statuses.current = 'failed'
    expect(await service.reconcileCashoutOrder('user-a', second.id)).toMatchObject({
      fulfilmentStatus: 'FULFILLMENT_FAILED',
    })
  })

  it('refreshes only expired, unsubmitted payout details', async () => {
    let paycrestStatus = 'initiated'
    let createdCount = 0
    const { payment, service } = setup({
      fetchJson: async (url) => {
        if (url.includes('/institutions/')) return [{ code: 'GTB', name: 'GTBank' }]
        if (url.includes('/verify-account')) return { data: 'ADA OKAFOR' }
        if (url.includes('/v2/rates/')) return { rate: 1500 }
        if (url.includes('/sender/orders/')) return { id: 'pc-1', status: paycrestStatus }
        createdCount += 1
        return {
          id: `pc-new-${createdCount}`,
          receiveAddress: RECEIVER,
          validUntil: new Date(NOW + 600_000).toISOString(),
          amount: '100',
          senderFee: '1',
          transactionFee: '0.5',
          totalAmount: '101.5',
          destination: { amount: '152250' },
          status: 'initiated',
        }
      },
    })
    const created = await draftOrder(payment)
    await service.createCashoutQuote('user-a', created.id)
    await expect(service.refreshCashoutQuote('user-a', created.id)).rejects.toMatchObject({ statusCode: 409 })
    paycrestStatus = 'expired'
    const refreshed = await service.refreshCashoutQuote('user-a', created.id)
    expect(refreshed.providerRef).toBe('pc-new-2')
    expect(refreshed.paymentStatus).toBe('READY_FOR_PAYMENT')
  })

  it('submits hashes idempotently and advances on provider evidence', async () => {
    const { payment, service } = setup()
    const created = await draftOrder(payment)
    await service.createCashoutQuote('user-a', created.id)
    const hash = `0x${'ab'.repeat(32)}`
    const submitted = await service.submitCashoutPayment('user-a', created.id, hash)
    expect(submitted).toMatchObject({ paymentStatus: 'ONCHAIN_PENDING', walletTxRef: 'ab'.repeat(32) })
    await expect(service.submitCashoutPayment('user-a', created.id, `0x${'cd'.repeat(32)}`))
      .rejects.toMatchObject({ statusCode: 409 })
    expect(await service.submitCashoutPayment('user-a', created.id, hash)).toMatchObject({
      paymentStatus: 'ONCHAIN_PENDING',
    })
    await expect(service.submitCashoutPayment('user-a', created.id, 'nope')).rejects.toMatchObject({ statusCode: 400 })
  })
})
