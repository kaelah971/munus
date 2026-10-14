import type { PaymentOrder, PaymentOrderDraft } from '../domain/orders'

export interface PaymentApi {
  list(): Promise<PaymentOrder[]>
  get(id: string): Promise<PaymentOrder>
  createOrder(draft: PaymentOrderDraft): Promise<PaymentOrder>
}

export class RemotePaymentApi implements PaymentApi {
  constructor(private readonly baseUrl: string) {}

  async list(): Promise<PaymentOrder[]> {
    const response = await this.request('/payment-orders')
    return ((await response.json()) as { paymentOrders: PaymentOrder[] }).paymentOrders
  }

  async get(id: string): Promise<PaymentOrder> {
    const response = await this.request(`/payment-orders/${encodeURIComponent(id)}`)
    return (await response.json()) as PaymentOrder
  }

  async createOrder(draft: PaymentOrderDraft): Promise<PaymentOrder> {
    const response = await this.request('/payment-orders', {
      method: 'POST',
      body: JSON.stringify(draft),
    })
    return (await response.json()) as PaymentOrder
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
      ...init,
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    })
    if (!response.ok) {
      const message = await readError(response)
      throw new Error(message ?? `Munus payment request failed (${response.status}).`)
    }
    return response
  }
}

async function readError(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: string }
    return typeof body.error === 'string' ? body.error : null
  } catch {
    return null
  }
}
