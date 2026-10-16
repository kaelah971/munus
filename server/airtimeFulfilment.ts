import { maskPhone } from '../src/domain/support'
import {
  canStartDataFulfilment,
  canStartFulfilment,
  fulfilmentStatusForOutcome,
  isFulfilmentTerminal,
  type AirtimeProviderAdapter,
  type AirtimePurchaseReceipt,
  type AirtimeQueryInput,
  type AirtimeQueryRecord,
  type DataProviderAdapter,
  type PaymentOrder,
  type PaymentServiceType,
} from '../src/domain/orders'
import type { FulfilmentStart, PaymentRepository, ProviderEvidenceUpdate } from './paymentRepository'
import { CLUBKONNECT_CALLBACK_PATH, ClubKonnectError } from './clubKonnect'

/**
 * Sanitized provider-failure log: HTTP status when a response arrived,
 * provider message otherwise. Never URLs, credentials, or phone numbers.
 */
function logProviderFailure(kind: string, orderId: string, requestId: string, step: string, error: unknown): void {
  console.info(`Munus ${kind} provider ${step} failed`, {
    orderId,
    requestId,
    httpStatus: error instanceof ClubKonnectError ? (error.httpStatus ?? null) : null,
    cause: error instanceof Error ? error.message : 'unknown provider error',
  })
}

export class FulfilmentError extends Error {
  constructor(message: string, readonly statusCode = 409) {
    super(message)
    this.name = 'FulfilmentError'
  }
}

export interface AirtimeFulfilmentOptions {
  callbackBaseUrl?: string
  now?: () => string
  /** Optional sync for orders that satisfy an essential request. Never throws into fulfilment flow. */
  onFulfilmentSettled?: (order: PaymentOrder) => Promise<void>
}

export interface FulfilmentProviders {
  airtime?: AirtimeProviderAdapter
  data?: DataProviderAdapter
}

interface FulfilmentRunner<Input> {
  readonly provider: string
  deriveRequestId(orderId: string): string
  buildPurchaseParams(input: Input): Record<string, string>
  purchase(input: Input): Promise<AirtimePurchaseReceipt>
  query(input: AirtimeQueryInput): Promise<AirtimeQueryRecord>
}

/**
 * Provider holds no transaction under a RequestID: the query came back
 * empty, or ambiguous WITHOUT any provider order reference. Production
 * proof (2026-10-16): a never-created RequestID answers
 * `TRANSACTION_BEYOND_30_DAYS` with no orderid — reconcile-first must
 * treat that as resubmittable, not as a known transaction. Any record
 * carrying a provider order id (or an order already holding a provider
 * reference) is genuinely ambiguous and must only reconcile, never
 * repurchase: the order id is the existence proof.
 */
export function providerHasNoRecord(
  order: Pick<PaymentOrder, 'providerRef'>,
  record: Pick<AirtimeQueryRecord, 'outcome' | 'providerOrderId'>,
): boolean {
  if (record.outcome === 'not-found') return true
  if (record.outcome !== 'unknown') return false
  return !record.providerOrderId && !order.providerRef
}

/**
 * Real provider fulfilment for PAID airtime and data orders. The service
 * never invents payment state: only PAID orders may contact the provider,
 * retries query before any repurchase, and callbacks only trigger
 * reconciliation — the provider query is always canonical.
 */
export class AirtimeFulfilmentService {
  private readonly now: () => string

  constructor(
    private readonly payment: PaymentRepository,
    providers: AirtimeProviderAdapter | DataProviderAdapter | FulfilmentProviders,
    private readonly options: AirtimeFulfilmentOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString())
    this.providers = normalizeProviders(providers)
  }

  private readonly providers: FulfilmentProviders

  async fulfilOrder(userId: string, orderId: string): Promise<PaymentOrder> {
    const order = await this.requireOwnedOrder(userId, orderId)
    if (order.serviceType !== 'AIRTIME' && order.serviceType !== 'DATA') {
      throw new FulfilmentError('Only airtime or data orders can use this provider.', 400)
    }
    if (order.paymentStatus !== 'PAID') {
      throw new FulfilmentError('Only PAID orders can enter provider fulfilment.', 409)
    }
    // Testnet (or any non-mainnet) payments must never spend provider funds.
    // Orders created before the payment network was durable carry no network
    // and keep the previous behavior; every quoted payment sets one.
    if (order.paymentNetwork !== undefined && order.paymentNetwork !== 'mainnet') {
      throw new FulfilmentError('Only verified mainnet payments can enter provider fulfilment.', 409)
    }
    if (isFulfilmentTerminal(order.fulfilmentStatus)) return order
    const fresh = order.serviceType === 'AIRTIME' ? canStartFulfilment(order) : canStartDataFulfilment(order)
    if (!fresh && order.fulfilmentStatus !== 'FULFILLING') {
      throw new FulfilmentError('This order needs manual recovery before it can be fulfilled again.', 409)
    }
    if (!order.recipientNetwork) {
      throw new FulfilmentError('Recipient network is required before fulfilment can be sent.', 400)
    }
    const callbackUrl = this.requireCallbackUrl()
    if (order.serviceType === 'DATA') {
      const provider = this.requireProvider('DATA')
      if (!order.providerPlanId) {
        throw new FulfilmentError('Data order is missing its bundle snapshot. It needs manual recovery.', 409)
      }
      return this.executeFulfilment(userId, order, provider, {
        network: order.recipientNetwork,
        providerPlanId: order.providerPlanId,
        mobileNumber: order.recipientPhone,
        requestId: provider.deriveRequestId(order.id),
        callbackUrl,
      })
    }
    const provider = this.requireProvider('AIRTIME')
    return this.executeFulfilment(userId, order, provider, {
      network: order.recipientNetwork,
      amountNgn: order.requestedAmount,
      mobileNumber: order.recipientPhone,
      requestId: provider.deriveRequestId(order.id),
      callbackUrl,
    })
  }

  /**
   * User-initiated safe retry for stalled or failed deliveries. Reconciles
   * first against the stored (or derived, hence stable) RequestID and only
   * purchases when the provider has no record of this fulfilment — the
   * same identifier is always reused, so a retry can never double-charge.
   * Ambiguous provider answers keep the recovery state; they never trigger
   * a purchase.
   */
  async retryDelivery(userId: string, orderId: string): Promise<PaymentOrder> {
    const order = await this.requireOwnedOrder(userId, orderId)
    if (order.serviceType !== 'AIRTIME' && order.serviceType !== 'DATA') {
      throw new FulfilmentError('Only airtime or data orders can use this provider.', 400)
    }
    if (order.paymentStatus !== 'PAID') {
      throw new FulfilmentError('Only PAID orders can enter provider fulfilment.', 409)
    }
    if (order.paymentNetwork !== undefined && order.paymentNetwork !== 'mainnet') {
      throw new FulfilmentError('Only verified mainnet payments can enter provider fulfilment.', 409)
    }
    if (isFulfilmentTerminal(order.fulfilmentStatus)) return order
    if (order.fulfilmentStatus !== 'NOT_STARTED' && order.fulfilmentStatus !== 'FULFILLMENT_FAILED' && order.fulfilmentStatus !== 'RECOVERY_REQUIRED') {
      throw new FulfilmentError('Delivery is already in progress. Refresh status instead of retrying.', 409)
    }
    if (!order.recipientNetwork) {
      throw new FulfilmentError('Recipient network is required before fulfilment can be sent.', 400)
    }
    const callbackUrl = this.requireCallbackUrl()
    if (order.serviceType === 'DATA') {
      const provider = this.requireProvider('DATA')
      if (!order.providerPlanId) {
        throw new FulfilmentError('Data order is missing its bundle snapshot. It needs manual recovery.', 409)
      }
      return this.executeRetry(userId, order, provider, {
        network: order.recipientNetwork,
        providerPlanId: order.providerPlanId,
        mobileNumber: order.recipientPhone,
        requestId: order.providerRequestId ?? provider.deriveRequestId(order.id),
        callbackUrl,
      })
    }
    const provider = this.requireProvider('AIRTIME')
    return this.executeRetry(userId, order, provider, {
      network: order.recipientNetwork,
      amountNgn: order.requestedAmount,
      mobileNumber: order.recipientPhone,
      requestId: order.providerRequestId ?? provider.deriveRequestId(order.id),
      callbackUrl,
    })
  }

  private async executeRetry<Input extends { requestId: string }>(
    userId: string,
    order: PaymentOrder,
    provider: FulfilmentRunner<Input>,
    purchaseInput: Input,
  ): Promise<PaymentOrder> {
    const orderId = order.id
    const kind = order.serviceType === 'DATA' ? 'data' : 'airtime'
    // Pure provider validation (network, amount/plan, phone shape) before
    // any state change or network contact.
    provider.buildPurchaseParams(purchaseInput)

    // Reconcile first: only a provider that has never seen this RequestID
    // may be asked to fulfil it. An ambiguous answer WITH a provider
    // order id reconciles only; without one there is nothing to
    // duplicate, so the same stable RequestID is (re)submitted.
    let record: AirtimeQueryRecord
    try {
      record = await provider.query({
        requestId: purchaseInput.requestId,
        providerOrderId: order.providerRef,
      })
    } catch (error) {
      logProviderFailure(kind, orderId, purchaseInput.requestId, 'lookup', error)
      throw error
    }
    console.info(`Munus ${kind} recovery lookup`, {
      orderId,
      requestId: purchaseInput.requestId,
      action: providerHasNoRecord(order, record) ? 'resubmit' : 'reconcile-only',
      providerCode: record.statusCode || null,
      providerStatus: record.status || null,
      outcome: record.outcome,
    })
    if (!providerHasNoRecord(order, record)) {
      return this.applyQueryRecord(userId, order, record)
    }

    if (order.fulfilmentStatus === 'NOT_STARTED') {
      const reserved = await this.payment.startFulfilment(userId, orderId, {
        provider: provider.provider,
        providerRequestId: purchaseInput.requestId,
      })
      if (!reserved) return this.requireOwnedOrder(userId, orderId)
    }
    console.info(`Munus ${kind} purchase sent`, { orderId, requestId: purchaseInput.requestId, recipient: maskPhone(order.recipientPhone ?? '') })
    let receipt: AirtimePurchaseReceipt
    try {
      receipt = await provider.purchase(purchaseInput)
    } catch (error) {
      logProviderFailure(kind, orderId, purchaseInput.requestId, 'purchase', error)
      throw error
    }
    const updated = await this.payment.recordProviderUpdate(userId, orderId, {
      providerOrderId: receipt.providerOrderId,
      providerStatusCode: receipt.statusCode,
      providerStatus: receipt.status,
      providerRemark: cleanRemark(receipt.remark),
      fulfilmentStatus: 'FULFILLING',
    })
    const settled = updated ?? await this.requireOwnedOrder(userId, orderId)
    await this.notifySettled(settled)
    return settled
  }

  private async executeFulfilment<Input extends { requestId: string }>(
    userId: string,
    order: PaymentOrder,
    provider: FulfilmentRunner<Input>,
    purchaseInput: Input,
  ): Promise<PaymentOrder> {
    const orderId = order.id
    const kind = order.serviceType === 'DATA' ? 'data' : 'airtime'
    // Pure provider validation (network, amount/plan, phone shape) before
    // any state change or network contact.
    provider.buildPurchaseParams(purchaseInput)

    let current = order
    if (current.fulfilmentStatus === 'NOT_STARTED') {
      const start: FulfilmentStart = { provider: provider.provider, providerRequestId: purchaseInput.requestId }
      const reserved = await this.payment.startFulfilment(userId, orderId, start)
      // A null reservation means the attempt was already reserved (retry or
      // race): fall through to the reconcile-first path, never repurchase.
      current = reserved ?? await this.requireOwnedOrder(userId, orderId)
    }
    if (current.fulfilmentStatus !== 'FULFILLING') return current
    if (current.providerRef) return this.reconcileOrder(userId, orderId)

    // Reconcile-first retry: if the provider already knows this RequestID
    // (earlier purchase reached them), attach it instead of repurchasing.
    // An ambiguous answer without any provider order id means nothing
    // exists to duplicate, so the same stable RequestID is submitted.
    const existing = await provider.query({ requestId: purchaseInput.requestId })
    console.info(`Munus ${kind} recovery lookup`, {
      orderId,
      requestId: purchaseInput.requestId,
      action: providerHasNoRecord(current, existing) ? 'resubmit' : 'reconcile-only',
      providerCode: existing.statusCode || null,
      providerStatus: existing.status || null,
      outcome: existing.outcome,
    })
    if (!providerHasNoRecord(current, existing)) {
      return this.applyQueryRecord(userId, current, existing)
    }

    console.info(`Munus ${kind} purchase sent`, { orderId: current.id, requestId: purchaseInput.requestId, recipient: maskPhone(current.recipientPhone ?? '') })
    let receipt: AirtimePurchaseReceipt
    try {
      receipt = await provider.purchase(purchaseInput)
    } catch (error) {
      logProviderFailure(kind, current.id, purchaseInput.requestId, 'purchase', error)
      throw error
    }
    const updated = await this.payment.recordProviderUpdate(userId, orderId, {
      providerOrderId: receipt.providerOrderId,
      providerStatusCode: receipt.statusCode,
      providerStatus: receipt.status,
      providerRemark: cleanRemark(receipt.remark),
      fulfilmentStatus: 'FULFILLING',
    })
    const settled = updated ?? await this.requireOwnedOrder(userId, orderId)
    await this.notifySettled(settled)
    return settled
  }

  private requireProvider(serviceType: 'AIRTIME'): AirtimeProviderAdapter
  private requireProvider(serviceType: 'DATA'): DataProviderAdapter
  private requireProvider(serviceType: PaymentServiceType): AirtimeProviderAdapter | DataProviderAdapter {
    const provider = serviceType === 'DATA' ? this.providers.data : this.providers.airtime
    if (!provider) {
      throw new FulfilmentError(`${serviceType === 'DATA' ? 'Data' : 'Airtime'} fulfilment is not configured.`, 503)
    }
    return provider
  }

  async reconcileOrder(userId: string, orderId: string): Promise<PaymentOrder> {
    const order = await this.requireOwnedOrder(userId, orderId)
    if (isFulfilmentTerminal(order.fulfilmentStatus)) return order
    if (!order.providerRequestId && !order.providerRef) return order
    // Callbacks and retries dispatch by service type; the provider query is
    // always canonical, never the callback payload.
    const provider = order.serviceType === 'DATA' ? this.providers.data
      : order.serviceType === 'AIRTIME' ? this.providers.airtime
        : undefined
    if (!provider) return order
    const record = await provider.query({
      requestId: order.providerRequestId,
      providerOrderId: order.providerRef,
    })
    return this.applyQueryRecord(userId, order, record)
  }

  /**
   * Callback entry point. Resolves the order by persisted provider reference
   * and reconciles against a fresh provider query. Returns null for unknown
   * references without mutating anything.
   */
  async reconcileByProviderReference(providerRequestId?: string, providerOrderId?: string): Promise<PaymentOrder | null> {
    if (!providerRequestId && !providerOrderId) {
      throw new FulfilmentError('Provider callback is missing its transaction reference.', 400)
    }
    const order = await this.payment.findOrderByProviderReference(providerRequestId, providerOrderId)
    if (!order) return null
    return this.reconcileOrder(order.userId, order.id)
  }

  private async applyQueryRecord(userId: string, order: PaymentOrder, record: AirtimeQueryRecord): Promise<PaymentOrder> {
    if (record.outcome === 'not-found') return order
    const next = record.outcome === 'pending' ? 'FULFILLING' : fulfilmentStatusForOutcome(record.outcome)
    if (!next) return order
    const evidence: ProviderEvidenceUpdate = {
      providerOrderId: record.providerOrderId,
      providerStatusCode: record.statusCode || undefined,
      providerStatus: record.status || undefined,
      providerRemark: cleanRemark(record.remark),
      providerAmountCharged: cleanAmount(record.amountCharged),
      fulfilmentStatus: next,
      fulfilledAt: next === 'DELIVERED' ? this.now() : undefined,
    }
    console.info(`Munus ${order.serviceType === 'DATA' ? 'data' : 'airtime'} reconciled`, {
      orderId: order.id,
      outcome: record.outcome,
      fulfilmentStatus: next,
      providerCode: record.statusCode || null,
      providerStatus: record.status || null,
      providerRef: record.providerOrderId ?? order.providerRef ?? null,
    })
    const updated = await this.payment.recordProviderUpdate(userId, order.id, evidence)
    const settled = updated ?? order
    await this.notifySettled(settled)
    return settled
  }

  private async notifySettled(order: PaymentOrder): Promise<void> {
    if (!order.essentialRequestId || !this.options.onFulfilmentSettled) return
    try {
      await this.options.onFulfilmentSettled(order)
    } catch (error) {
      console.info('Munus essential sync retryable', { orderId: order.id, cause: error instanceof Error ? error.message : 'unknown sync error' })
    }
  }

  private requireCallbackUrl(): string {
    const base = this.options.callbackBaseUrl?.trim().replace(/\/$/, '')
    if (!base) throw new FulfilmentError('Airtime fulfilment callback is not configured.', 503)
    return `${base}${CLUBKONNECT_CALLBACK_PATH}`
  }

  private async requireOwnedOrder(userId: string, orderId: string): Promise<PaymentOrder> {
    const order = await this.payment.getOrder(userId, orderId)
    if (!order) throw new FulfilmentError('Payment order was not found.', 404)
    return order
  }
}

function normalizeProviders(
  input: AirtimeProviderAdapter | DataProviderAdapter | FulfilmentProviders,
): FulfilmentProviders {
  if ('airtime' in input || 'data' in input) return input
  const adapter = input as AirtimeProviderAdapter | DataProviderAdapter
  return adapter.serviceType === 'DATA' ? { data: adapter } : { airtime: adapter }
}

function cleanRemark(remark: string | undefined): string | undefined {
  if (!remark) return undefined
  const trimmed = remark.trim().slice(0, 160)
  return trimmed === '' ? undefined : trimmed
}

function cleanAmount(amountCharged: string | undefined): string | undefined {
  if (!amountCharged) return undefined
  const trimmed = amountCharged.trim()
  return /^\d+(\.\d{1,8})?$/.test(trimmed) ? trimmed : undefined
}
