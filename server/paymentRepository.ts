import { randomUUID } from 'node:crypto'
import type {
  FulfilmentStatus,
  NimiqPaymentNetwork,
  PaymentOrder,
  ValidatedPaymentOrderDraft,
} from '../src/domain/orders'
import type { DatabasePool } from './database'

export class PaymentRepositoryError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message)
    this.name = 'PaymentRepositoryError'
  }
}

export interface FulfilmentStart {
  provider: string
  providerRequestId: string
}

export interface ProviderEvidenceUpdate {
  providerOrderId?: string
  providerStatusCode?: string
  providerStatus?: string
  providerAmountCharged?: string
  providerRemark?: string
  fulfilmentStatus: FulfilmentStatus
  fulfilledAt?: string
}

export interface NimQuoteRecord {
  rateNgnPerNim: string
  nimAmount: string
  lunaAmount: string
  source: string
  observedAt: string
  expiresAt: string
  network: NimiqPaymentNetwork
  receiver: string
  memo: string
}

export interface VerifiedNimPayment {
  transactionHash: string
  sender: string
  receiver: string
  lunaAmount: string
  blockNumber: string
  confirmations: number
  verifiedAt: string
}

export interface PaymentRepository {
  listOrders(userId: string): Promise<PaymentOrder[]>
  getOrder(userId: string, orderId: string): Promise<PaymentOrder | null>
  findOrderById(orderId: string): Promise<PaymentOrder | null>
  createOrder(userId: string, draft: ValidatedPaymentOrderDraft): Promise<PaymentOrder>
  findOrderByProviderReference(providerRequestId?: string, providerOrderId?: string): Promise<PaymentOrder | null>
  startFulfilment(userId: string, orderId: string, start: FulfilmentStart): Promise<PaymentOrder | null>
  recordProviderUpdate(userId: string, orderId: string, evidence: ProviderEvidenceUpdate): Promise<PaymentOrder | null>
  recordQuote(userId: string, orderId: string, quote: NimQuoteRecord): Promise<PaymentOrder | null>
  recordPaymentIntent(userId: string, orderId: string, nowIso: string): Promise<PaymentOrder | null>
  recordPaymentSubmission(userId: string, orderId: string, transactionHash: string, nowIso: string): Promise<PaymentOrder | null>
  recordVerifiedPayment(userId: string, orderId: string, payment: VerifiedNimPayment): Promise<PaymentOrder | null>
  recordPaymentFailure(userId: string, orderId: string, reason: string): Promise<PaymentOrder | null>
}

export class InMemoryPaymentRepository implements PaymentRepository {
  readonly orders = new Map<string, PaymentOrder>()

  async listOrders(userId: string): Promise<PaymentOrder[]> {
    return [...this.orders.values()]
      .filter((order) => order.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async getOrder(userId: string, orderId: string): Promise<PaymentOrder | null> {
    const order = this.orders.get(orderId)
    return order?.userId === userId ? order : null
  }

  async createOrder(userId: string, draft: ValidatedPaymentOrderDraft): Promise<PaymentOrder> {
    const now = new Date().toISOString()
    const order: PaymentOrder = {
      id: randomUUID(),
      userId,
      serviceType: draft.serviceType,
      paymentAsset: draft.paymentAsset,
      recipientPhone: draft.recipientPhone,
      recipientNetwork: draft.recipientNetwork,
      recipientCountry: 'NG',
      requestedAmount: draft.requestedAmount,
      requestedCurrency: 'NGN',
      providerPlanId: draft.providerPlanId,
      planDisplayLabel: draft.planDisplayLabel,
      planDataAllowance: draft.planDataAllowance,
      planValidity: draft.planValidity,
      essentialRequestId: draft.essentialRequestId,
      paymentStatus: 'DRAFT',
      fulfilmentStatus: 'NOT_STARTED',
      createdAt: now,
      updatedAt: now,
    }
    this.orders.set(order.id, order)
    return order
  }

  async findOrderById(orderId: string): Promise<PaymentOrder | null> {
    return this.orders.get(orderId) ?? null
  }

  async findOrderByProviderReference(providerRequestId?: string, providerOrderId?: string): Promise<PaymentOrder | null> {
    if (!providerRequestId && !providerOrderId) return null
    const found = [...this.orders.values()].find((order) =>
      (providerRequestId !== undefined && providerRequestId !== '' && order.providerRequestId === providerRequestId) ||
      (providerOrderId !== undefined && providerOrderId !== '' && order.providerRef === providerOrderId),
    )
    return found ?? null
  }

  async startFulfilment(userId: string, orderId: string, start: FulfilmentStart): Promise<PaymentOrder | null> {
    const order = await this.getOrder(userId, orderId)
    if (!order) return null
    if (order.paymentStatus !== 'PAID' || order.fulfilmentStatus !== 'NOT_STARTED') return null
    const started: PaymentOrder = {
      ...order,
      provider: start.provider,
      providerRequestId: start.providerRequestId,
      fulfilmentStatus: 'FULFILLING',
      fulfilmentStartedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    this.orders.set(orderId, started)
    return started
  }

  async recordProviderUpdate(userId: string, orderId: string, evidence: ProviderEvidenceUpdate): Promise<PaymentOrder | null> {
    const order = await this.getOrder(userId, orderId)
    if (!order) return null
    if (order.fulfilmentStatus !== 'NOT_STARTED' && order.fulfilmentStatus !== 'FULFILLING' && order.fulfilmentStatus !== 'RECOVERY_REQUIRED') return null
    const updated: PaymentOrder = {
      ...order,
      providerRef: evidence.providerOrderId ?? order.providerRef,
      providerStatusCode: evidence.providerStatusCode ?? order.providerStatusCode,
      providerStatus: evidence.providerStatus ?? order.providerStatus,
      providerAmountCharged: evidence.providerAmountCharged ?? order.providerAmountCharged,
      providerRemark: evidence.providerRemark ?? order.providerRemark,
      fulfilmentStatus: evidence.fulfilmentStatus,
      fulfilledAt: evidence.fulfilledAt ?? order.fulfilledAt,
      updatedAt: new Date().toISOString(),
    }
    this.orders.set(orderId, updated)
    return updated
  }

  async recordQuote(userId: string, orderId: string, quote: NimQuoteRecord): Promise<PaymentOrder | null> {
    const order = await this.getOrder(userId, orderId)
    if (!order) return null
    if ((order.serviceType !== 'AIRTIME' && order.serviceType !== 'DATA') || order.paymentAsset !== 'NIM') return null
    if (order.paymentStatus !== 'DRAFT' && order.paymentStatus !== 'READY_FOR_PAYMENT') return null
    const updated: PaymentOrder = {
      ...order,
      quotedCryptoAmount: quote.nimAmount,
      quoteExpiresAt: quote.expiresAt,
      paymentNetwork: quote.network,
      quoteRateNgnPerNim: quote.rateNgnPerNim,
      quoteLunaAmount: quote.lunaAmount,
      quoteSource: quote.source,
      quoteObservedAt: quote.observedAt,
      paymentMemo: quote.memo,
      paymentReceiver: quote.receiver,
      paymentStatus: 'READY_FOR_PAYMENT',
      updatedAt: new Date().toISOString(),
    }
    this.orders.set(orderId, updated)
    return updated
  }

  async recordPaymentIntent(userId: string, orderId: string, nowIso: string): Promise<PaymentOrder | null> {
    const order = await this.getOrder(userId, orderId)
    if (!order) return null
    if (order.paymentStatus !== 'READY_FOR_PAYMENT' && order.paymentStatus !== 'AWAITING_WALLET_APPROVAL') return null
    if (!isFreshQuote(order, nowIso)) return null
    const updated: PaymentOrder = { ...order, paymentStatus: 'AWAITING_WALLET_APPROVAL', updatedAt: new Date().toISOString() }
    this.orders.set(orderId, updated)
    return updated
  }

  async recordPaymentSubmission(userId: string, orderId: string, transactionHash: string, nowIso: string): Promise<PaymentOrder | null> {
    const order = await this.getOrder(userId, orderId)
    if (!order) return null
    if (order.paymentStatus !== 'READY_FOR_PAYMENT' && order.paymentStatus !== 'AWAITING_WALLET_APPROVAL') return null
    if (!isFreshQuote(order, nowIso)) return null
    if (order.walletTxRef && order.walletTxRef.toLowerCase() !== transactionHash.toLowerCase()) return null
    const updated: PaymentOrder = {
      ...order,
      walletTxRef: transactionHash,
      paymentStatus: 'ONCHAIN_PENDING',
      updatedAt: new Date().toISOString(),
    }
    this.orders.set(orderId, updated)
    return updated
  }

  async recordVerifiedPayment(userId: string, orderId: string, payment: VerifiedNimPayment): Promise<PaymentOrder | null> {
    const order = await this.getOrder(userId, orderId)
    if (!order) return null
    if (order.paymentStatus !== 'ONCHAIN_PENDING') return null
    if (!order.walletTxRef || order.walletTxRef.toLowerCase() !== payment.transactionHash.toLowerCase()) return null
    const updated: PaymentOrder = {
      ...order,
      paymentSender: payment.sender,
      paymentReceiver: payment.receiver,
      quoteLunaAmount: order.quoteLunaAmount,
      paymentBlockNumber: payment.blockNumber,
      paymentConfirmations: payment.confirmations,
      paymentVerifiedAt: payment.verifiedAt,
      paymentFailureReason: undefined,
      paymentStatus: 'PAID',
      updatedAt: new Date().toISOString(),
    }
    this.orders.set(orderId, updated)
    return updated
  }

  async recordPaymentFailure(userId: string, orderId: string, reason: string): Promise<PaymentOrder | null> {
    const order = await this.getOrder(userId, orderId)
    if (!order) return null
    if (order.paymentStatus !== 'ONCHAIN_PENDING') return null
    const updated: PaymentOrder = {
      ...order,
      paymentFailureReason: reason,
      paymentStatus: 'PAYMENT_FAILED',
      updatedAt: new Date().toISOString(),
    }
    this.orders.set(orderId, updated)
    return updated
  }
}

function isFreshQuote(order: PaymentOrder, nowIso: string): boolean {
  if (!order.quotedCryptoAmount || !order.quoteLunaAmount || !order.quoteExpiresAt) return false
  return Date.parse(order.quoteExpiresAt) > Date.parse(nowIso)
}

export class PostgresPaymentRepository implements PaymentRepository {
  constructor(private readonly database: DatabasePool) {}

  async listOrders(userId: string): Promise<PaymentOrder[]> {
    const result = await this.run('list payment orders', () => this.database.query(
      `SELECT * FROM payment_orders
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId],
    ))
    return result.rows.map((row) => mapPaymentOrder(row))
  }

  async getOrder(userId: string, orderId: string): Promise<PaymentOrder | null> {
    const result = await this.run('load payment order', () => this.database.query(
      `SELECT * FROM payment_orders
       WHERE id = $1 AND user_id = $2`,
      [orderId, userId],
    ))
    return result.rows[0] ? mapPaymentOrder(result.rows[0]) : null
  }

  async createOrder(userId: string, draft: ValidatedPaymentOrderDraft): Promise<PaymentOrder> {
    const result = await this.run('create payment order', () => this.database.query(
      `INSERT INTO payment_orders
        (user_id, service_type, payment_asset, recipient_phone, recipient_network,
         recipient_country, requested_amount, requested_currency,
         provider_plan_id, plan_display_label, plan_data_allowance, plan_validity,
         essential_request_id,
         payment_status, fulfilment_status)
       VALUES ($1, $2, $3, $4, $5, 'NG', $6, 'NGN', $7, $8, $9, $10, $11, 'DRAFT', 'NOT_STARTED')
       RETURNING *`,
      [userId, draft.serviceType, draft.paymentAsset, draft.recipientPhone, draft.recipientNetwork ?? null, draft.requestedAmount, draft.providerPlanId ?? null, draft.planDisplayLabel ?? null, draft.planDataAllowance ?? null, draft.planValidity ?? null, draft.essentialRequestId ?? null],
    ))
    return mapPaymentOrder(requireRow(result.rows[0], 'Payment order'))
  }

  async findOrderByProviderReference(providerRequestId?: string, providerOrderId?: string): Promise<PaymentOrder | null> {
    if (!providerRequestId && !providerOrderId) return null
    const conditions: string[] = []
    const values: unknown[] = []
    if (providerRequestId) {
      values.push(providerRequestId)
      conditions.push(`provider_request_id = $${values.length}`)
    }
    if (providerOrderId) {
      values.push(providerOrderId)
      conditions.push(`provider_ref = $${values.length}`)
    }
    const result = await this.run('find payment order by provider reference', () => this.database.query(
      `SELECT * FROM payment_orders
       WHERE ${conditions.join(' OR ')}
       ORDER BY updated_at DESC
       LIMIT 1`,
      values,
    ))
    return result.rows[0] ? mapPaymentOrder(result.rows[0]) : null
  }

  async findOrderById(orderId: string): Promise<PaymentOrder | null> {
    const result = await this.run('find payment order by id', () => this.database.query(
      `SELECT * FROM payment_orders
       WHERE id = $1
       LIMIT 1`,
      [orderId],
    ))
    return result.rows[0] ? mapPaymentOrder(result.rows[0]) : null
  }

  async startFulfilment(userId: string, orderId: string, start: FulfilmentStart): Promise<PaymentOrder | null> {
    const result = await this.run('start payment order fulfilment', () => this.database.query(
      `UPDATE payment_orders
       SET provider = $3,
           provider_request_id = $4,
           fulfilment_status = 'FULFILLING',
           fulfilment_started_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
         AND user_id = $2
         AND payment_status = 'PAID'
         AND fulfilment_status = 'NOT_STARTED'
       RETURNING *`,
      [orderId, userId, start.provider, start.providerRequestId],
    ))
    return result.rows[0] ? mapPaymentOrder(result.rows[0]) : null
  }

  async recordProviderUpdate(userId: string, orderId: string, evidence: ProviderEvidenceUpdate): Promise<PaymentOrder | null> {
    const result = await this.run('record provider evidence', () => this.database.query(
      `UPDATE payment_orders
       SET provider_ref = COALESCE($3, provider_ref),
           provider_status_code = COALESCE($4, provider_status_code),
           provider_status = COALESCE($5, provider_status),
           provider_amount_charged = COALESCE($6, provider_amount_charged),
           provider_remark = COALESCE($7, provider_remark),
           fulfilment_status = $8,
           fulfilled_at = COALESCE($9, fulfilled_at),
           updated_at = NOW()
       WHERE id = $1
         AND user_id = $2
         AND fulfilment_status IN ('NOT_STARTED', 'FULFILLING', 'RECOVERY_REQUIRED')
       RETURNING *`,
      [orderId, userId, evidence.providerOrderId ?? null, evidence.providerStatusCode ?? null, evidence.providerStatus ?? null, evidence.providerAmountCharged ?? null, evidence.providerRemark ?? null, evidence.fulfilmentStatus, evidence.fulfilledAt ?? null],
    ))
    return result.rows[0] ? mapPaymentOrder(result.rows[0]) : null
  }

  async recordQuote(userId: string, orderId: string, quote: NimQuoteRecord): Promise<PaymentOrder | null> {
    const result = await this.run('record payment quote', () => this.database.query(
      `UPDATE payment_orders
       SET quoted_crypto_amount = $3,
           quote_expires_at = $4,
           payment_network = $5,
           quote_rate_ngn_per_nim = $6,
           quote_luna_amount = $7,
           quote_source = $8,
           quote_observed_at = $9,
           payment_memo = $10,
           payment_receiver = $11,
           payment_status = 'READY_FOR_PAYMENT',
           updated_at = NOW()
       WHERE id = $1
         AND user_id = $2
         AND service_type IN ('AIRTIME', 'DATA')
         AND payment_asset = 'NIM'
         AND payment_status IN ('DRAFT', 'READY_FOR_PAYMENT')
       RETURNING *`,
      [orderId, userId, quote.nimAmount, quote.expiresAt, quote.network, quote.rateNgnPerNim, quote.lunaAmount, quote.source, quote.observedAt, quote.memo, quote.receiver],
    ))
    return result.rows[0] ? mapPaymentOrder(result.rows[0]) : null
  }

  async recordPaymentIntent(userId: string, orderId: string, nowIso: string): Promise<PaymentOrder | null> {
    const result = await this.run('record payment intent', () => this.database.query(
      `UPDATE payment_orders
       SET payment_status = 'AWAITING_WALLET_APPROVAL',
           updated_at = NOW()
       WHERE id = $1
         AND user_id = $2
         AND payment_status IN ('READY_FOR_PAYMENT', 'AWAITING_WALLET_APPROVAL')
         AND quoted_crypto_amount IS NOT NULL
         AND quote_luna_amount IS NOT NULL
         AND quote_expires_at > $3
       RETURNING *`,
      [orderId, userId, nowIso],
    ))
    return result.rows[0] ? mapPaymentOrder(result.rows[0]) : null
  }

  async recordPaymentSubmission(userId: string, orderId: string, transactionHash: string, nowIso: string): Promise<PaymentOrder | null> {
    const result = await this.run('record payment submission', () => this.database.query(
      `UPDATE payment_orders
       SET wallet_tx_ref = $3,
           payment_status = 'ONCHAIN_PENDING',
           updated_at = NOW()
       WHERE id = $1
         AND user_id = $2
         AND payment_status IN ('READY_FOR_PAYMENT', 'AWAITING_WALLET_APPROVAL')
         AND quoted_crypto_amount IS NOT NULL
         AND quote_luna_amount IS NOT NULL
         AND quote_expires_at > $4
         AND (wallet_tx_ref IS NULL OR LOWER(wallet_tx_ref) = LOWER($3))
       RETURNING *`,
      [orderId, userId, transactionHash, nowIso],
    ))
    return result.rows[0] ? mapPaymentOrder(result.rows[0]) : null
  }

  async recordVerifiedPayment(userId: string, orderId: string, payment: VerifiedNimPayment): Promise<PaymentOrder | null> {
    const result = await this.run('record verified payment', () => this.database.query(
      `UPDATE payment_orders
       SET payment_sender = $3,
           payment_receiver = $4,
           payment_block_number = $5,
           payment_confirmations = $6,
           payment_verified_at = $7,
           payment_failure_reason = NULL,
           payment_status = 'PAID',
           updated_at = NOW()
       WHERE id = $1
         AND user_id = $2
         AND payment_status = 'ONCHAIN_PENDING'
         AND LOWER(wallet_tx_ref) = LOWER($8)
       RETURNING *`,
      [orderId, userId, payment.sender, payment.receiver, payment.blockNumber, payment.confirmations, payment.verifiedAt, payment.transactionHash],
    ))
    return result.rows[0] ? mapPaymentOrder(result.rows[0]) : null
  }

  async recordPaymentFailure(userId: string, orderId: string, reason: string): Promise<PaymentOrder | null> {
    const result = await this.run('record payment failure', () => this.database.query(
      `UPDATE payment_orders
       SET payment_failure_reason = $3,
           payment_status = 'PAYMENT_FAILED',
           updated_at = NOW()
       WHERE id = $1
         AND user_id = $2
         AND payment_status = 'ONCHAIN_PENDING'
       RETURNING *`,
      [orderId, userId, reason],
    ))
    return result.rows[0] ? mapPaymentOrder(result.rows[0]) : null
  }

  private async run<T>(label: string, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof PaymentRepositoryError) throw error
      throw new Error(`Could not ${label}: ${errorMessage(error)}`, { cause: error })
    }
  }
}

function mapPaymentOrder(row: Record<string, unknown>): PaymentOrder {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    serviceType: row.service_type as PaymentOrder['serviceType'],
    paymentAsset: row.payment_asset as PaymentOrder['paymentAsset'],
    recipientPhone: String(row.recipient_phone),
    recipientNetwork: (row.recipient_network ?? undefined) as PaymentOrder['recipientNetwork'],
    recipientCountry: 'NG',
    requestedAmount: String(row.requested_amount),
    requestedCurrency: 'NGN',
    providerPlanId: row.provider_plan_id ? String(row.provider_plan_id) : undefined,
    essentialRequestId: row.essential_request_id ? String(row.essential_request_id) : undefined,
    planDisplayLabel: row.plan_display_label ? String(row.plan_display_label) : undefined,
    planDataAllowance: row.plan_data_allowance ? String(row.plan_data_allowance) : undefined,
    planValidity: row.plan_validity ? String(row.plan_validity) : undefined,
    quotedCryptoAmount: row.quoted_crypto_amount ? String(row.quoted_crypto_amount) : undefined,
    quoteExpiresAt: row.quote_expires_at ? timestampString(row.quote_expires_at) : undefined,
    walletTxRef: row.wallet_tx_ref ? String(row.wallet_tx_ref) : undefined,
    providerRef: row.provider_ref ? String(row.provider_ref) : undefined,
    provider: row.provider ? String(row.provider) : undefined,
    providerRequestId: row.provider_request_id ? String(row.provider_request_id) : undefined,
    providerStatusCode: row.provider_status_code ? String(row.provider_status_code) : undefined,
    providerStatus: row.provider_status ? String(row.provider_status) : undefined,
    providerAmountCharged: row.provider_amount_charged ? String(row.provider_amount_charged) : undefined,
    providerRemark: row.provider_remark ? String(row.provider_remark) : undefined,
    fulfilmentStartedAt: row.fulfilment_started_at ? timestampString(row.fulfilment_started_at) : undefined,
    fulfilledAt: row.fulfilled_at ? timestampString(row.fulfilled_at) : undefined,
    paymentNetwork: (row.payment_network ?? undefined) as PaymentOrder['paymentNetwork'],
    quoteRateNgnPerNim: row.quote_rate_ngn_per_nim ? String(row.quote_rate_ngn_per_nim) : undefined,
    quoteLunaAmount: row.quote_luna_amount ? String(row.quote_luna_amount) : undefined,
    quoteSource: row.quote_source ? String(row.quote_source) : undefined,
    quoteObservedAt: row.quote_observed_at ? timestampString(row.quote_observed_at) : undefined,
    paymentMemo: row.payment_memo ? String(row.payment_memo) : undefined,
    paymentReceiver: row.payment_receiver ? String(row.payment_receiver) : undefined,
    paymentSender: row.payment_sender ? String(row.payment_sender) : undefined,
    paymentBlockNumber: row.payment_block_number ? String(row.payment_block_number) : undefined,
    paymentConfirmations: row.payment_confirmations === null || row.payment_confirmations === undefined ? undefined : Number(row.payment_confirmations),
    paymentVerifiedAt: row.payment_verified_at ? timestampString(row.payment_verified_at) : undefined,
    paymentFailureReason: row.payment_failure_reason ? String(row.payment_failure_reason) : undefined,
    paymentStatus: row.payment_status as PaymentOrder['paymentStatus'],
    fulfilmentStatus: row.fulfilment_status as PaymentOrder['fulfilmentStatus'],
    createdAt: timestampString(row.created_at),
    updatedAt: timestampString(row.updated_at),
  }
}

function requireRow(row: Record<string, unknown> | undefined, label: string): Record<string, unknown> {
  if (!row) throw new Error(`${label} was not returned by the database.`)
  return row
}

function timestampString(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
