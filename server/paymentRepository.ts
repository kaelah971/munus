import { randomUUID } from 'node:crypto'
import type {
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

export interface PaymentRepository {
  listOrders(userId: string): Promise<PaymentOrder[]>
  getOrder(userId: string, orderId: string): Promise<PaymentOrder | null>
  createOrder(userId: string, draft: ValidatedPaymentOrderDraft): Promise<PaymentOrder>
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
