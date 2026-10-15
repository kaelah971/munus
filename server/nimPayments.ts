import {
  buildPaymentMemo,
  calculateQuoteLuna,
  canCreateDataQuote,
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
import { NimRateError, type NimRateProvider } from './nimRates'
import {
  isTransactionHash,
  NimiqChainError,
  normalizeHash,
  verifyNimPayment,
  type NimiqChainReader,
  type NimPaymentExpectation,
} from './nimiqChain'
import { toProviderAmount } from './clubKonnect'
import { normalizeNimiqAddress } from './nimiqSignature'
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
  /** Optional sync for orders that satisfy an essential request. Never throws into payment flow. */
  onPaymentSettled?: (order: PaymentOrder) => Promise<void>
}

export interface PaymentIntent {
  receiver: string
  lunaAmount: string
  memo: string
  network: NimiqPaymentNetwork
  quoteExpiresAt: string
}

/**
 * Real NIM payment orchestration for airtime and data orders. Quotes come from a live
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
    if (order.paymentAsset !== 'NIM' || (order.serviceType !== 'AIRTIME' && order.serviceType !== 'DATA')) {
      throw new NimPaymentError('Only NIM airtime or data orders can be quoted.', 400)
    }
    const receiver = this.requireReceiver()
    if (order.serviceType === 'AIRTIME') {
      if (!canCreateQuote(order)) {
        throw new NimPaymentError('This order cannot be quoted in its current state.', 409)
      }
      // Provider bounds keep the quote inside fulfilable airtime amounts.
      toProviderAmount(order.requestedAmount)
    } else {
      // DATA quotes price the snapshotted bundle, never client input.
      if (!order.providerPlanId) {
        throw new NimPaymentError('Data order is missing its bundle snapshot.', 400)
      }
      if (!canCreateDataQuote(order)) {
        throw new NimPaymentError('This order cannot be quoted in its current state.', 409)
      }
    }

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

  /**
   * Informational NIM/NGN estimate for balance display. Same provider and
   * source as payment quotes, same quote lifetime — but never a payment
   * quote: it binds to no order and authorizes nothing.
   */
  async getIndicativeRate(): Promise<{ ngnPerNim: string; source: string; asOf: string; expiresAt: string }> {
    const rate = await this.rates.getNimNgnRate()
    const asOfMs = Date.parse(rate.observedAt)
    if (!Number.isFinite(asOfMs)) throw new NimRateError('Live NIM rate is unavailable.')
    return {
      ngnPerNim: rate.rateNgnPerNim,
      source: rate.source,
      asOf: rate.observedAt,
      expiresAt: new Date(asOfMs + this.options.quoteTtlMs).toISOString(),
    }
  }

  /**
   * Read-only confirmed balance for the caller's own session wallet.
   * The address always comes from the server session — never from client
   * input — so one user can never query another's balance through this
   * path. Display fallback only; payment proof still requires a
   * transaction-specific verification.
   */
  async getSessionWalletBalance(sessionWalletAddress: string): Promise<{
    balanceLuna: string
    balanceNim: string
    network: 'mainnet' | 'testnet'
    source: 'rpc'
  }> {
    if (!this.chain) {
      throw new NimPaymentError('NIM chain lookup is not configured yet.', 503)
    }
    let address: string
    try {
      address = normalizeNimiqAddress(sessionWalletAddress)
    } catch {
      throw new NimPaymentError('Session wallet address is not usable.', 400)
    }
    let balanceLuna: string
    try {
      balanceLuna = await this.chain.getAccountBalance(address)
    } catch (error) {
      if (error instanceof NimiqChainError) throw error
      throw new NimiqChainError('NIM chain lookup failed. Balance will retry.')
    }
    return {
      balanceLuna,
      balanceNim: formatNimFromLunaBigint(BigInt(balanceLuna)),
      network: this.options.network,
      source: 'rpc',
    }
  }

  /**
   * Confirmed balances for host-exposed addresses (operator-triggered
   * diagnostics only). Each entry is normalized and queried independently;
   * failures stay per-entry and never become zero. On-chain balances are
   * public data — the bound (10) and session gate prevent abuse, not
   * secrecy. Auth identity is untouched: this never influences sessions.
   */
  async getAccountBalances(addresses: unknown): Promise<{
    accounts: Array<{
      suffix: string
      ok: boolean
      balanceLuna?: string
      balanceNim?: string
      error?: string
    }>
    aggregateLuna: string
    aggregateNim: string
    okCount: number
    network: 'mainnet' | 'testnet'
  }> {
    if (!this.chain) {
      throw new NimPaymentError('NIM chain lookup is not configured yet.', 503)
    }
    if (!Array.isArray(addresses) || addresses.length < 1 || addresses.length > 10) {
      throw new NimPaymentError('Provide between 1 and 10 wallet addresses.', 400)
    }
    const chain = this.chain
    const accounts = await Promise.all(addresses.map(async (entry) => {
      const raw = typeof entry === 'string' ? entry : ''
      const suffix = raw.replace(/\s+/g, '').slice(-4) || '••••'
      let address: string
      try {
        if (!raw.trim()) throw new Error('empty')
        address = normalizeNimiqAddress(raw)
      } catch {
        return { suffix, ok: false as const, error: 'Unreadable wallet address.' }
      }
      try {
        const balanceLuna = await chain.getAccountBalance(address)
        return {
          suffix,
          ok: true as const,
          balanceLuna,
          balanceNim: formatNimFromLunaBigint(BigInt(balanceLuna)),
        }
      } catch {
        return { suffix, ok: false as const, error: 'Chain lookup failed.' }
      }
    }))
    let aggregate = 0n
    let okCount = 0
    for (const account of accounts) {
      if (account.ok && account.balanceLuna !== undefined) {
        aggregate += BigInt(account.balanceLuna)
        okCount += 1
      }
    }
    return {
      accounts,
      aggregateLuna: aggregate.toString(),
      aggregateNim: formatNimFromLunaBigint(aggregate),
      okCount,
      network: this.options.network,
    }
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
      const settledFailure = failed ?? order
      await this.notifySettled(settledFailure)
      return settledFailure
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
    await this.notifySettled(current)
    return this.maybeHandoffFulfilment(current)
  }

  private async notifySettled(order: PaymentOrder): Promise<void> {
    if (!order.essentialRequestId || !this.options.onPaymentSettled) return
    try {
      await this.options.onPaymentSettled(order)
    } catch (error) {
      console.info('Munus essential sync retryable', { orderId: order.id, cause: errorMessage(error) })
    }
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
