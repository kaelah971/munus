import {
  addExactDecimals,
  formatUsdtFromBaseUnits,
  multiplyExactDecimals,
  normalizeBankAccountNumber,
  parseUsdtToBaseUnits,
  POLYGON_CHAIN_ID_HEX,
  type CashoutBank,
  type CashoutIntent,
  type CashoutRatePreview,
} from '../src/domain/cashout'
import type { NimiqPaymentNetwork, PaymentOrder } from '../src/domain/orders'
import type { CashoutQuoteRecord, PaymentRepository } from './paymentRepository'
import { isTransactionHash, normalizeHash } from './nimiqChain'
import {
  classifyPaycrestOutcome,
  parsePaycrestWebhookEvent,
  type PaycrestClient,
  type PaycrestOutcome,
} from './paycrest'

export class CashoutError extends Error {
  constructor(message: string, readonly statusCode = 409) {
    super(message)
    this.name = 'CashoutError'
  }
}

export interface CashoutServiceOptions {
  network: NimiqPaymentNetwork
  quoteTtlMs: number
  usdtContractAddress?: string
  refundAddress?: string
  now?: () => number
}

export interface CashoutIntentResponse {
  order: PaymentOrder
  intent: CashoutIntent
}

export interface CashoutOrderInput {
  usdtAmount: string
  bankCode: string
  accountNumber: string
}

/**
 * Real USDT → NGN cash-out orchestration through Paycrest. The server never
 * prices from client input: banks resolve from the provider directory,
 * account names pin from verification, and every transfer figure comes
 * from the Paycrest order response. Wallet hashes are submission evidence
 * only; Paycrest status is canonical for fiat completion.
 */
export class CashoutService {
  private readonly now: () => number

  constructor(
    private readonly payment: PaymentRepository,
    private readonly paycrest: PaycrestClient | null,
    private readonly options: CashoutServiceOptions,
  ) {
    this.now = options.now ?? Date.now
  }

  async listBanks(): Promise<CashoutBank[]> {
    const paycrest = this.requirePaycrest()
    return paycrest.listInstitutions()
  }

  async verifyAccount(input: { institution: string; accountNumber: string }): Promise<{
    bankCode: string
    bankName: string
    accountNumber: string
    accountName: string
  }> {
    const paycrest = this.requirePaycrest()
    const accountNumber = normalizeBankAccountNumber(input.accountNumber)
    const bank = await this.resolveBank(paycrest, input.institution)
    const verified = await paycrest.verifyAccount({ institution: bank.code, accountNumber })
    return { bankCode: bank.code, bankName: bank.name, accountNumber, accountName: verified.accountName }
  }

  async previewRate(usdtAmount: string): Promise<CashoutRatePreview> {
    const paycrest = this.requirePaycrest()
    const amount = normalizeUsdtAmount(usdtAmount)
    const preview = await paycrest.getSellRate(amount)
    return {
      usdtAmount: amount,
      ngnAmount: multiplyExactDecimals(amount, preview.rateNgnPerUsdt),
      rateNgnPerUsdt: preview.rateNgnPerUsdt,
      source: preview.source,
      observedAt: preview.observedAt,
    }
  }

  async createCashoutOrder(userId: string, input: CashoutOrderInput): Promise<PaymentOrder> {
    this.requireMainnet()
    this.requirePaycrest()
    const usdtAmount = normalizeUsdtAmount(input.usdtAmount)
    const verified = await this.verifyAccount({ institution: input.bankCode, accountNumber: input.accountNumber })
    return this.payment.createOrder(userId, {
      serviceType: 'CASH_OUT',
      paymentAsset: 'USDT',
      requestedAmount: usdtAmount,
      requestedCurrency: 'USDT',
      bankCode: verified.bankCode,
      bankName: verified.bankName,
      bankAccountNumber: verified.accountNumber,
      bankAccountName: verified.accountName,
    })
  }

  async createCashoutQuote(userId: string, orderId: string): Promise<PaymentOrder> {
    this.requireMainnet()
    const paycrest = this.requirePaycrest()
    const order = await this.requireOwnedCashoutOrder(userId, orderId)
    if (order.paymentStatus !== 'DRAFT' && order.paymentStatus !== 'READY_FOR_PAYMENT') {
      throw new CashoutError('This order cannot be quoted in its current state.', 409)
    }
    if (!order.bankCode || !order.bankAccountNumber || !order.bankAccountName) {
      throw new CashoutError('This order is missing its verified bank details.', 400)
    }
    const rate = await paycrest.getSellRate(order.requestedAmount)
    const created = await paycrest.createOrder({
      reference: order.id,
      refundAddress: this.requireRefundAddress(),
      institution: order.bankCode,
      accountNumber: order.bankAccountNumber,
      accountName: order.bankAccountName,
      amountUsdt: order.requestedAmount,
    })
    if (!created.payoutNgnAmount) {
      throw new CashoutError('Paycrest payout is missing. No cash-out order was quoted.', 502)
    }
    const quote: CashoutQuoteRecord = {
      paycrestOrderId: created.paycrestOrderId,
      receiveAddress: created.receiveAddress,
      validUntil: created.validUntil,
      payoutNgnAmount: created.payoutNgnAmount,
      feeUsdtAmount: addExactDecimals(created.senderFeeUsdt, created.transactionFeeUsdt),
      rateNgnPerUsdt: rate.rateNgnPerUsdt,
      usdtTotalAmount: created.totalUsdt,
      source: 'paycrest',
      observedAt: rate.observedAt,
    }
    const quoted = await this.payment.recordCashoutQuote(userId, orderId, quote)
    if (!quoted) throw new CashoutError('This order cannot be quoted in its current state.', 409)
    return quoted
  }

  async createCashoutIntent(userId: string, orderId: string): Promise<CashoutIntentResponse> {
    const order = await this.requireOwnedCashoutOrder(userId, orderId)
    this.requireFreshQuote(order)
    const marked = await this.payment.recordCashoutIntent(userId, orderId, new Date(this.now()).toISOString())
    if (!marked) throw new CashoutError('This order cannot start wallet approval in its current state.', 409)
    return { order: marked, intent: this.toIntent(marked) }
  }

  async submitCashoutPayment(userId: string, orderId: string, transactionHash: unknown): Promise<PaymentOrder> {
    const hash = normalizeSubmissionHash(transactionHash)
    const order = await this.requireOwnedCashoutOrder(userId, orderId)
    if (order.walletTxRef && order.walletTxRef.toLowerCase() === hash.toLowerCase()) {
      return this.reconcileCashoutOrder(userId, orderId)
    }
    if (order.walletTxRef) {
      throw new CashoutError('This order is already bound to a different wallet transaction.', 409)
    }
    this.requireFreshQuote(order)
    const submitted = await this.payment.recordCashoutSubmission(userId, orderId, hash, new Date(this.now()).toISOString())
    if (!submitted) throw new CashoutError('This order cannot accept a wallet transaction in its current state.', 409)
    return this.settleCashoutOrder(submitted)
  }

  /**
   * Safe retry/poll path. Re-reads Paycrest status and advances only on
   * provider evidence. Never purchases, never refunds, never invents.
   */
  async reconcileCashoutOrder(userId: string, orderId: string): Promise<PaymentOrder> {
    const order = await this.requireOwnedCashoutOrder(userId, orderId)
    return this.settleCashoutOrder(order)
  }

  /**
   * Webhook entry point. The signature is verified by the route; here the
   * payload is only a signal — the order still advances through the same
   * evidence mapping as polling, so duplicates are idempotent.
   */
  async handlePaycrestWebhook(body: unknown): Promise<PaymentOrder | null> {
    const event = parsePaycrestWebhookEvent(body)
    if (!event) return null
    const order = await this.payment.findOrderByProviderReference(undefined, event.paycrestOrderId)
    if (!order || order.serviceType !== 'CASH_OUT') return null
    return this.applyPaycrestOutcome({ ...order, providerStatus: event.status }, classifyPaycrestOutcome(event.status))
  }

  /**
   * Issues fresh payout details after expiry, only when no USDT was ever
   * submitted. The previous Paycrest order is abandoned, never reused.
   */
  async refreshCashoutQuote(userId: string, orderId: string): Promise<PaymentOrder> {
    const order = await this.requireOwnedCashoutOrder(userId, orderId)
    if (order.paymentStatus !== 'READY_FOR_PAYMENT') {
      throw new CashoutError('Only unexpired, unsubmitted payout details can be refreshed.', 409)
    }
    if (order.walletTxRef) {
      throw new CashoutError('This order already has a submitted transaction.', 409)
    }
    const paycrest = this.requirePaycrest()
    const current = order.providerRef ? await paycrest.getOrder(order.providerRef).catch(() => null) : null
    if (!current || current.outcome !== 'expired') {
      throw new CashoutError('Current payout details are still valid.', 409)
    }
    return this.createCashoutQuote(userId, orderId)
  }

  /**
   * Applies a Paycrest outcome observed by reconcile, refresh, or webhook.
   * Transport failures throw so callers keep prior state; uncertainty never
   * becomes success or failure.
   */
  async applyPaycrestOutcome(order: PaymentOrder, outcome: PaycrestOutcome): Promise<PaymentOrder> {
    switch (outcome) {
      case 'pending':
      case 'unknown':
        return order
      case 'processing': {
        let current = order
        if (current.paymentStatus === 'ONCHAIN_PENDING') {
          const paid = await this.payment.recordCashoutPaid(current.userId, current.id, new Date(this.now()).toISOString())
          if (paid) current = paid
        }
        if (current.paymentStatus === 'PAID' && current.fulfilmentStatus === 'NOT_STARTED') {
          const started = await this.payment.startFulfilment(current.userId, current.id, {
            provider: 'paycrest',
            providerRequestId: current.providerRef ?? current.id,
          })
          if (started) current = started
        }
        return (await this.payment.getOrder(current.userId, current.id)) ?? current
      }
      case 'settled': {
        let current = order
        if (current.paymentStatus === 'ONCHAIN_PENDING') {
          const paid = await this.payment.recordCashoutPaid(current.userId, current.id, new Date(this.now()).toISOString())
          if (paid) current = paid
        }
        if (current.paymentStatus === 'PAID' && current.fulfilmentStatus !== 'DELIVERED') {
          if (current.fulfilmentStatus === 'NOT_STARTED') {
            const started = await this.payment.startFulfilment(current.userId, current.id, {
              provider: 'paycrest',
              providerRequestId: current.providerRef ?? current.id,
            })
            if (started) current = started
          }
          const delivered = await this.payment.recordProviderUpdate(current.userId, current.id, {
            fulfilmentStatus: 'DELIVERED',
            fulfilledAt: new Date(this.now()).toISOString(),
          })
          if (delivered) current = delivered
        }
        return (await this.payment.getOrder(current.userId, current.id)) ?? current
      }
      case 'refunded': {
        // Refunded is shown only on explicit provider evidence, never
        // inferred. A refund proves funds arrived and were returned, so the
        // crypto leg is marked paid alongside the refunded fulfilment.
        if (order.fulfilmentStatus === 'DELIVERED') return order
        let current = order
        if (current.paymentStatus === 'ONCHAIN_PENDING') {
          const paid = await this.payment.recordCashoutPaid(current.userId, current.id, new Date(this.now()).toISOString())
          if (paid) current = paid
        }
        if (current.paymentStatus !== 'PAID') return current
        const updated = await this.payment.recordProviderUpdate(current.userId, current.id, {
          fulfilmentStatus: 'REFUNDED',
        })
        return updated ?? current
      }
      case 'expired':
      case 'failed': {
        // Explicit provider failure ends fulfilment attempts. Payment truth
        // is untouched: a submitted hash stays bound for later ambiguity
        // review instead of becoming a fabricated payment failure. An
        // expiry with no submission simply waits for a refresh.
        if (order.fulfilmentStatus === 'DELIVERED') return order
        if (outcome === 'expired' && !order.walletTxRef) return order
        const updated = await this.payment.recordProviderUpdate(order.userId, order.id, {
          fulfilmentStatus: outcome === 'failed' ? 'FULFILLMENT_FAILED' : 'RECOVERY_REQUIRED',
          providerStatus: order.providerStatus,
          providerStatusCode: order.providerStatusCode,
        })
        return updated ?? order
      }
    }
  }

  private async settleCashoutOrder(order: PaymentOrder): Promise<PaymentOrder> {
    const paycrest = this.requirePaycrest()
    if (!order.providerRef) return order
    let record
    try {
      record = await paycrest.getOrder(order.providerRef)
    } catch (error) {
      console.info('Munus cash-out lookup retryable', { orderId: order.id, cause: errorMessage(error) })
      return order
    }
    return this.applyPaycrestOutcome({ ...order, providerStatus: record.status }, record.outcome)
  }

  private requirePaycrest() {
    if (!this.paycrest) throw new CashoutError('Cash out is not configured yet.', 503)
    return this.paycrest
  }

  private requireRefundAddress(): string {
    const refundAddress = this.options.refundAddress?.trim() ?? ''
    if (!/^0x[0-9a-fA-F]{40}$/.test(refundAddress)) {
      throw new CashoutError('Cash-out refund address is not configured.', 503)
    }
    return refundAddress
  }

  private requireMainnet(): void {
    if (this.options.network !== 'mainnet') {
      throw new CashoutError('Cash out is available on mainnet only.', 409)
    }
  }

  private async resolveBank(paycrest: { listInstitutions(): Promise<{ code: string; name: string }[]> }, bankCode: string) {
    const code = bankCode.trim()
    const banks = await paycrest.listInstitutions()
    const bank = banks.find((entry) => entry.code === code)
    if (!bank) throw new CashoutError('Bank is not supported for cash out.', 400)
    return bank
  }

  private requireOwnedCashoutOrder(userId: string, orderId: string): Promise<PaymentOrder> {
    return this.requireOwnedOrder(userId, orderId)
  }

  private async requireOwnedOrder(userId: string, orderId: string): Promise<PaymentOrder> {
    const order = await this.payment.getOrder(userId, orderId)
    if (!order) throw new CashoutError('Cash-out order was not found.', 404)
    if (order.serviceType !== 'CASH_OUT' || order.paymentAsset !== 'USDT') {
      throw new CashoutError('This is not a USDT cash-out order.', 400)
    }
    return order
  }

  private toIntent(order: PaymentOrder): CashoutIntentResponse['intent'] {
    if (!order.paycrestReceiveAddress || !order.usdtTotalAmount || !order.quoteExpiresAt) {
      throw new CashoutError('This order has no usable payout details. Refresh them first.', 409)
    }
    return {
      receiveAddress: order.paycrestReceiveAddress,
      contractAddress: this.requireContractAddress(),
      chainIdHex: POLYGON_CHAIN_ID_HEX,
      totalBaseUnits: parseUsdtToBaseUnits(order.usdtTotalAmount).toString(),
      quoteExpiresAt: order.quoteExpiresAt,
    }
  }

  private requireContractAddress(): string {
    const contract = this.options.usdtContractAddress?.trim() ?? ''
    if (!/^0x[0-9a-fA-F]{40}$/.test(contract)) {
      throw new CashoutError('Cash out is not configured yet.', 503)
    }
    return contract
  }

  private requireFreshQuote(order: PaymentOrder): void {
    if (!order.providerRef || !order.quoteExpiresAt || Date.parse(order.quoteExpiresAt) <= this.now()) {
      throw new CashoutError('These payout details have expired. Refresh them before paying.', 410)
    }
  }
}

function normalizeUsdtAmount(value: unknown): string {
  if (typeof value !== 'string') throw new CashoutError('USDT amount must be a decimal string.', 400)
  try {
    return formatUsdtFromBaseUnits(parseUsdtToBaseUnits(value))
  } catch (error) {
    throw new CashoutError(error instanceof Error ? error.message : 'USDT amount is invalid.', 400)
  }
}

function normalizeSubmissionHash(value: unknown): string {
  if (!isTransactionHash(value)) {
    throw new CashoutError('Wallet transaction reference is not a valid transaction hash.', 400)
  }
  return normalizeHash(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown cash-out error'
}
