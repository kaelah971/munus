import { maskPhone } from '../src/domain/support'
import {
  canStartFulfilment,
  fulfilmentStatusForOutcome,
  isFulfilmentTerminal,
  type AirtimeProviderAdapter,
  type AirtimePurchaseInput,
  type AirtimeQueryRecord,
  type PaymentOrder,
} from '../src/domain/orders'
import type { FulfilmentStart, PaymentRepository, ProviderEvidenceUpdate } from './paymentRepository'
import { CLUBKONNECT_CALLBACK_PATH } from './clubKonnect'

export class FulfilmentError extends Error {
  constructor(message: string, readonly statusCode = 409) {
    super(message)
    this.name = 'FulfilmentError'
  }
}

export interface AirtimeFulfilmentOptions {
  callbackBaseUrl?: string
  now?: () => string
}

/**
 * Real airtime fulfilment for PAID orders only. The service never invents
 * payment state: only PAID orders may contact the provider, retries query
 * before any repurchase, and callbacks only trigger reconciliation — the
 * provider query is always canonical.
 */
export class AirtimeFulfilmentService {
  private readonly now: () => string

  constructor(
    private readonly payment: PaymentRepository,
    private readonly provider: AirtimeProviderAdapter,
    private readonly options: AirtimeFulfilmentOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString())
  }

  get providerId(): string {
    return this.provider.provider
  }

  async fulfilOrder(userId: string, orderId: string): Promise<PaymentOrder> {
    const order = await this.requireOwnedOrder(userId, orderId)
    if (order.serviceType !== 'AIRTIME') {
      throw new FulfilmentError('Only airtime orders can use this provider.', 400)
    }
    if (order.paymentStatus !== 'PAID') {
      throw new FulfilmentError('Only PAID orders can enter provider fulfilment.', 409)
    }
    if (isFulfilmentTerminal(order.fulfilmentStatus)) return order
    if (!canStartFulfilment(order) && order.fulfilmentStatus !== 'FULFILLING') {
      throw new FulfilmentError('This order needs manual recovery before it can be fulfilled again.', 409)
    }
    if (!order.recipientNetwork) {
      throw new FulfilmentError('Recipient network is required before airtime can be sent.', 400)
    }

    const purchaseInput: AirtimePurchaseInput = {
      network: order.recipientNetwork,
      amountNgn: order.requestedAmount,
      mobileNumber: order.recipientPhone,
      requestId: this.provider.deriveRequestId(order.id),
      callbackUrl: this.requireCallbackUrl(),
    }
    // Pure provider validation (network, amount bounds, phone shape) before
    // any state change or network contact.
    this.provider.buildPurchaseParams(purchaseInput)

    let current = order
    if (current.fulfilmentStatus === 'NOT_STARTED') {
      const start: FulfilmentStart = { provider: this.providerId, providerRequestId: purchaseInput.requestId }
      const reserved = await this.payment.startFulfilment(userId, orderId, start)
      // A null reservation means the attempt was already reserved (retry or
      // race): fall through to the reconcile-first path, never repurchase.
      current = reserved ?? await this.requireOwnedOrder(userId, orderId)
    }
    if (current.fulfilmentStatus !== 'FULFILLING') return current
    if (current.providerRef) return this.reconcileOrder(userId, orderId)

    // Reconcile-first retry: if the provider already knows this RequestID
    // (earlier purchase reached them), attach it instead of repurchasing.
    const existing = await this.provider.query({ requestId: purchaseInput.requestId })
    if (existing.outcome !== 'not-found') {
      return this.applyQueryRecord(userId, current, existing)
    }

    console.info('Munus airtime purchase sent', { orderId: current.id, recipient: maskPhone(current.recipientPhone) })
    const receipt = await this.provider.purchase(purchaseInput)
    const updated = await this.payment.recordProviderUpdate(userId, orderId, {
      providerOrderId: receipt.providerOrderId,
      providerStatusCode: receipt.statusCode,
      providerStatus: receipt.status,
      providerRemark: cleanRemark(receipt.remark),
      fulfilmentStatus: 'FULFILLING',
    })
    return updated ?? await this.requireOwnedOrder(userId, orderId)
  }

  async reconcileOrder(userId: string, orderId: string): Promise<PaymentOrder> {
    const order = await this.requireOwnedOrder(userId, orderId)
    if (isFulfilmentTerminal(order.fulfilmentStatus)) return order
    if (!order.providerRequestId && !order.providerRef) return order
    const record = await this.provider.query({
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
    console.info('Munus airtime reconciled', { orderId: order.id, outcome: record.outcome, fulfilmentStatus: next })
    const updated = await this.payment.recordProviderUpdate(userId, order.id, evidence)
    return updated ?? order
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
