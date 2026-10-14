import { normalizeMoney } from '../domain/planning'
import { normalizePhone } from '../domain/support'
import {
  PAYMENT_ASSETS,
  PAYMENT_SERVICE_TYPES,
  type PaymentOrder,
  type PaymentOrderDraft,
} from '../domain/orders'
import type { PaymentApi, PaymentIntentResponse } from './paymentApi'

const PAYMENT_KEY_PREFIX = 'munus:payments:'

/**
 * Development/test persistence only. Production uses RemotePaymentApi against
 * the authenticated Munus API; this adapter never leaves the device.
 */
export class LocalPaymentApi implements PaymentApi {
  constructor(private readonly userId: string, private readonly storage: Storage | null = getStorage()) {}

  async list(): Promise<PaymentOrder[]> {
    return this.readData()
  }

  async get(id: string): Promise<PaymentOrder> {
    const order = this.readData().find((entry) => entry.id === id)
    if (!order) throw new Error('Payment order was not found.')
    return order
  }

  async createQuote(id: string): Promise<PaymentOrder> {
    void id
    throw new Error('NIM payment quotes require the Munus API.')
  }

  async createPaymentIntent(id: string): Promise<PaymentIntentResponse> {
    void id
    throw new Error('NIM payments require the Munus API.')
  }

  async submitPayment(id: string, transactionHash: string): Promise<PaymentOrder> {
    void id
    void transactionHash
    throw new Error('NIM payments require the Munus API.')
  }

  async reconcilePayment(id: string): Promise<PaymentOrder> {
    void id
    throw new Error('NIM payments require the Munus API.')
  }

  async createOrder(draft: PaymentOrderDraft): Promise<PaymentOrder> {
    if (!PAYMENT_SERVICE_TYPES.includes(draft.serviceType)) throw new Error('serviceType is not supported.')
    if (!PAYMENT_ASSETS.includes(draft.paymentAsset)) throw new Error('paymentAsset is not supported.')
    const now = new Date().toISOString()
    const order: PaymentOrder = {
      id: createId(),
      userId: this.userId,
      serviceType: draft.serviceType,
      paymentAsset: draft.paymentAsset,
      recipientPhone: normalizePhone(draft.recipientPhone),
      recipientNetwork: draft.recipientNetwork || undefined,
      recipientCountry: 'NG',
      requestedAmount: normalizeMoney(draft.requestedAmount, false),
      requestedCurrency: 'NGN',
      paymentStatus: 'DRAFT',
      fulfilmentStatus: 'NOT_STARTED',
      createdAt: now,
      updatedAt: now,
    }
    const data = this.readData()
    data.unshift(order)
    this.writeData(data)
    return order
  }

  private readData(): PaymentOrder[] {
    const raw = this.storage?.getItem(`${PAYMENT_KEY_PREFIX}${this.userId}`)
    if (!raw) return []
    try {
      const value = JSON.parse(raw) as unknown
      return Array.isArray(value) ? (value as PaymentOrder[]) : []
    } catch {
      return []
    }
  }

  private writeData(data: PaymentOrder[]): void {
    this.storage?.setItem(`${PAYMENT_KEY_PREFIX}${this.userId}`, JSON.stringify(data))
  }
}

function createId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}
