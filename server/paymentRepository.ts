import { randomUUID } from 'node:crypto'
import type {
  FulfilmentStatus,
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

export interface PaymentRepository {
  listOrders(userId: string): Promise<PaymentOrder[]>
  getOrder(userId: string, orderId: string): Promise<PaymentOrder | null>
  createOrder(userId: string, draft: ValidatedPaymentOrderDraft): Promise<PaymentOrder>
  findOrderByProviderReference(providerRequestId?: string, providerOrderId?: string): Promise<PaymentOrder | null>
  startFulfilment(userId: string, orderId: string, start: FulfilmentStart): Promise<PaymentOrder | null>
  recordProviderUpdate(userId: string, orderId: string, evidence: ProviderEvidenceUpdate): Promise<PaymentOrder | null>
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
      paymentStatus: 'DRAFT',
      fulfilmentStatus: 'NOT_STARTED',
      createdAt: now,
      updatedAt: now,
    }
    this.orders.set(order.id, order)
    return order
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
         payment_status, fulfilment_status)
       VALUES ($1, $2, $3, $4, $5, 'NG', $6, 'NGN', 'DRAFT', 'NOT_STARTED')
       RETURNING *`,
      [userId, draft.serviceType, draft.paymentAsset, draft.recipientPhone, draft.recipientNetwork ?? null, draft.requestedAmount],
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
