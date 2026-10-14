import {
  buildPaymentMemo,
  calculateQuoteLuna,
  canCreateQuote,
  formatNimFromLunaBigint,
  isQuoteFresh,
  type NimiqPaymentNetwork,
  type PaymentOrder,
} from '../src/domain/orders'
import type {
  NimQuoteRecord,
  PaymentRepository,
  VerifiedNimPayment,
} from './paymentRepository'
import type { NimRateProvider } from './nimRates'
import {
  isTransactionHash,
  NimiqChainError,
  normalizeHash,
  verifyNimPayment,
  type NimiqChainReader,
  type NimPaymentExpectation,
} from './nimiqChain'
import { toProviderAmount } from './clubKonnect'
import type { AirtimeFulfilmentService } from './airtimeFulfilment'

export class NimPaymentError extends Error {
  constructor(message: string, readonly statusCode = 409) {
    super(message)
    this.name = 'NimPaymentError'
  }
}

export interface NimPaymentServiceOptions {
  receiverAddress?: string
  network: NimiqPaymentNetwork
  quoteTtlMs: number
  now?: () => number
}

export interface PaymentIntent {
  receiver: string
  lunaAmount: string
  memo: string
  network: NimiqPaymentNetwork
  quoteExpiresAt: string
}

/**
 * Real NIM payment orchestration for airtime orders. Quotes come from a live
 * rate with exact integer luna math; the wallet submission is only a
 * reference; PAID is set solely from independent chain evidence; and only a
 * verified mainnet PAID hands off to provider fulfilment.
 */
export class NimPaymentService {
  private readonly now: () => number

  constructor(
    private readonly payment: PaymentRepository,
    private readonly rates: NimRateProvider,
    private readonly chain: NimiqChainReader | null,
    private readonly fulfilment: AirtimeFulfilmentService | null,
    private readonly options: NimPaymentServiceOptions,
  ) {
    this.now = options.now ?? Date.now
  }

  async createQuote(userId: string, orderId: string): Promise<PaymentOrder> {
    const order = await this.requireOwnedOrder(userId, orderId)
    if (order.serviceType !== 'AIRTIME' || order.paymentAsset !== 'NIM') {
      throw new NimPaymentError('Only NIM airtime orders can be quoted.', 400)
    }
    if (!canCreateQuote(order)) {
      throw new NimPaymentError('This order cannot be quoted in its current state.', 409)
    }
    const receiver = this.requireReceiver()
    // Provider bounds keep the quote inside fulfilable airtime amounts.
    toProviderAmount(order.requestedAmount)

    const rate = await this.rates.getNimNgnRate()
    const luna = calculateQuoteLuna(order.requestedAmount, rate.rateNgnPerNim)
    const nowMs = this.now()
    const quote: NimQuoteRecord = {
      rateNgnPerNim: rate.rateNgnPerNim,
      nimAmount: formatNimFromLunaBigint(luna),
      lunaAmount: luna.toString(),
      source: rate.source,
      observedAt: rate.observedAt,
      expiresAt: new Date(nowMs + this.options.quoteTtlMs).toISOString(),
      network: this.options.network,
      receiver,
      memo: buildPaymentMemo(order.id),
    }
    const quoted = await this.payment.recordQuote(userId, orderId, quote)
    if (!quoted) throw new NimPaymentError('This order cannot be quoted in its current state.', 409)
    return quoted
  }

  async createPaymentIntent(userId: string, orderId: string): Promise<{ order: PaymentOrder; intent: PaymentIntent }> {
    const order = await this.requireOwnedOrder(userId, orderId)
    this.requireFreshQuote(order)
    const marked = await this.payment.recordPaymentIntent(userId, orderId, new Date(this.now()).toISOString())
    if (!marked) throw new NimPaymentError('This order cannot start wallet approval in its current state.', 409)
    return { order: marked, intent: this.toIntent(marked) }
  }

  async submitPayment(userId: string, orderId: string, transactionHash: unknown): Promise<PaymentOrder> {
    const hash = normalizeSubmissionHash(transactionHash)
    const order = await this.requireOwnedOrder(userId, orderId)
    // A repeated submission of the same hash is always harmless: pending
    // payments re-verify, verified payments re-check the handoff.
    if (order.walletTxRef && order.walletTxRef.toLowerCase() === hash.toLowerCase()) {
      return this.reconcilePayment(userId, orderId)
    }
    if (order.walletTxRef) {
      throw new NimPaymentError('This order is already bound to a different wallet transaction.', 409)
    }
    this.requireFreshQuote(order)
    const submitted = await this.payment.recordPaymentSubmission(userId, orderId, hash, new Date(this.now()).toISOString())
    if (!submitted) throw new NimPaymentError('This order cannot accept a wallet transaction in its current state.', 409)
    return this.verifyAndSettle(submitted)
  }

  /**
   * Safe retry/poll path. Re-runs chain verification for pending payments
   * and re-attempts the fulfilment handoff for verified mainnet payments.
   * Never invents state and never spends twice.
   */
  async reconcilePayment(userId: string, orderId: string): Promise<PaymentOrder> {
    const order = await this.requireOwnedOrder(userId, orderId)
    if (order.paymentStatus === 'ONCHAIN_PENDING') return this.verifyAndSettle(order)
    if (order.paymentStatus === 'PAID') return this.maybeHandoffFulfilment(order)
    return order
  }

  private async verifyAndSettle(order: PaymentOrder): Promise<PaymentOrder> {
    if (!this.chain) {
      console.info('Munus chain verification unavailable', { orderId: order.id })
      return order
    }
    let transaction: Awaited<ReturnType<NimiqChainReader['getTransaction']>>
    try {
      transaction = await this.chain.getTransaction(order.walletTxRef ?? '')
    } catch (error) {
      // RPC outage is uncertainty, not failure: stay pending and retryable.
      console.info('Munus chain lookup retryable', { orderId: order.id, cause: errorMessage(error) })
      return order
    }
    if (!transaction) return order

    let head: number | null = null
    try {
      head = await this.chain.getHeadBlockNumber()
    } catch (error) {
      console.info('Munus chain head retryable', { orderId: order.id, cause: errorMessage(error) })
    }
    const expectation = this.toExpectation(order)
    if (!expectation) return order
    const verification = verifyNimPayment(transaction, head, expectation)
    if (!verification.ok) {
      if (verification.reason === 'not-found' || verification.reason === 'pending') return order
      const failed = await this.payment.recordPaymentFailure(order.userId, order.id, verification.reason)
      console.info('Munus payment verification failed', { orderId: order.id, reason: verification.reason })
      return failed ?? order
    }

    const verified: VerifiedNimPayment = {
      transactionHash: verification.evidence.transactionHash,
      sender: verification.evidence.sender,
      receiver: verification.evidence.receiver,
      lunaAmount: verification.evidence.lunaAmount,
      blockNumber: verification.evidence.blockNumber,
      confirmations: verification.evidence.confirmations,
      verifiedAt: new Date(this.now()).toISOString(),
    }
    const paid = await this.payment.recordVerifiedPayment(order.userId, order.id, verified)
    const current = paid ?? await this.requireOwnedOrder(order.userId, order.id)
    console.info('Munus payment verified', { orderId: order.id, sender: verification.evidence.sender })
    return this.maybeHandoffFulfilment(current)
  }

  private async maybeHandoffFulfilment(order: PaymentOrder): Promise<PaymentOrder> {
    if (order.paymentStatus !== 'PAID') return order
    // Testnet (or unknown-network) payments must NEVER spend provider funds.
    if (order.paymentNetwork !== 'mainnet') return order
    if (!this.fulfilment) return order
    // The handoff initiates exactly once per order. Anything past reservation
    // retries through the fulfilment routes; the fulfilment service itself
    // stays idempotent against races.
    if (order.fulfilmentStatus !== 'NOT_STARTED') return order
    try {
      await this.fulfilment.fulfilOrder(order.userId, order.id)
    } catch (error) {
      // Payment success survives fulfilment trouble: the order stays PAID
      // and the existing fulfil/reconcile routes remain retryable.
      console.info('Munus fulfilment handoff retryable', { orderId: order.id, cause: errorMessage(error) })
    }
    return (await this.payment.getOrder(order.userId, order.id)) ?? order
  }

  private toExpectation(order: PaymentOrder): NimPaymentExpectation | null {
    if (!order.walletTxRef || !order.paymentReceiver || !order.quoteLunaAmount || !order.paymentMemo || !order.paymentNetwork) {
      return null
    }
    return {
      transactionHash: order.walletTxRef,
      receiver: order.paymentReceiver,
      lunaAmount: order.quoteLunaAmount,
      network: order.paymentNetwork,
      memo: order.paymentMemo,
    }
  }

  private toIntent(order: PaymentOrder): PaymentIntent {
    if (!order.paymentReceiver || !order.quoteLunaAmount || !order.paymentMemo || !order.paymentNetwork || !order.quoteExpiresAt) {
      throw new NimPaymentError('This order has no usable quote. Create a fresh quote first.', 409)
    }
    return {
      receiver: order.paymentReceiver,
      lunaAmount: order.quoteLunaAmount,
      memo: order.paymentMemo,
      network: order.paymentNetwork,
      quoteExpiresAt: order.quoteExpiresAt,
    }
  }

  private requireFreshQuote(order: PaymentOrder): void {
    if (!isQuoteFresh(order, this.now())) {
      throw new NimPaymentError('This quote has expired. Create a fresh quote before paying.', 410)
    }
  }

  private requireReceiver(): string {
    const receiver = this.options.receiverAddress?.trim()
    if (!receiver) throw new NimPaymentError('NIM payments are not configured yet.', 503)
    return receiver
  }

  private async requireOwnedOrder(userId: string, orderId: string): Promise<PaymentOrder> {
    const order = await this.payment.getOrder(userId, orderId)
    if (!order) throw new NimPaymentError('Payment order was not found.', 404)
    return order
  }
}

function normalizeSubmissionHash(value: unknown): string {
  if (!isTransactionHash(value)) {
    throw new NimPaymentError('Wallet transaction reference is not a valid transaction hash.', 400)
  }
  return normalizeHash(value)
}

function errorMessage(error: unknown): string {
  if (error instanceof NimiqChainError) return error.message
  return error instanceof Error ? error.message : 'unknown chain error'
}
