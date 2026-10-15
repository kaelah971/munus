import type { DataNetwork, DataPlan, PaymentOrder, PaymentOrderDraft } from '../domain/orders'
import type { CashoutBank, CashoutIntent, CashoutOrderInput, CashoutRatePreview } from '../domain/cashout'
import type { SupportNetwork } from '../domain/support'

export interface CashoutIntentResponse {
  order: PaymentOrder
  intent: CashoutIntent
}

/** Server-decided rail capability. Mirrors server/readiness.ts shapes. */
export type RailStatus = 'unavailable' | 'configured' | 'verified'

export interface RailCapability {
  status: RailStatus
  reason: string
}

export interface ReadinessReport {
  network: 'mainnet' | 'testnet'
  database: 'ready' | 'unreachable'
  nimReceiver: boolean
  nimiqRpc: boolean
  clubKonnect: boolean
  clubKonnectCallback: boolean
  paycrest: boolean
  polygonUsdt: boolean
  rails: {
    airtime: RailCapability
    data: RailCapability
    cashout: RailCapability
  }
}

export interface PaymentIntentResponse {
  order: PaymentOrder
  intent: {
    receiver: string
    lunaAmount: string
    memo: string
    network: 'mainnet' | 'testnet'
    quoteExpiresAt: string
  }
}

export interface DataOrderInput {
  providerPlanId: string
  recipientPhone: string
  recipientNetwork: SupportNetwork
}

export interface PaymentApi {
  list(): Promise<PaymentOrder[]>
  get(id: string): Promise<PaymentOrder>
  createOrder(draft: PaymentOrderDraft): Promise<PaymentOrder>
  createQuote(id: string): Promise<PaymentOrder>
  createPaymentIntent(id: string): Promise<PaymentIntentResponse>
  submitPayment(id: string, transactionHash: string): Promise<PaymentOrder>
  reconcilePayment(id: string): Promise<PaymentOrder>
  reconcileOrder(id: string): Promise<PaymentOrder>
  retryDelivery(id: string): Promise<PaymentOrder>
  listDataNetworks(): Promise<DataNetwork[]>
  listDataPlans(network: SupportNetwork): Promise<DataPlan[]>
  createDataOrder(input: DataOrderInput): Promise<PaymentOrder>
  listCashoutBanks(): Promise<CashoutBank[]>
  verifyCashoutAccount(input: { institution: string; accountNumber: string }): Promise<{
    bankCode: string
    bankName: string
    accountNumber: string
    accountName: string
  }>
  previewCashoutRate(usdtAmount: string): Promise<CashoutRatePreview>
  createCashoutOrder(input: CashoutOrderInput): Promise<PaymentOrder>
  createCashoutQuote(id: string): Promise<PaymentOrder>
  createCashoutIntent(id: string): Promise<CashoutIntentResponse>
  submitCashoutPayment(id: string, transactionHash: string): Promise<PaymentOrder>
  reconcileCashoutOrder(id: string): Promise<PaymentOrder>
  refreshCashoutQuote(id: string): Promise<PaymentOrder>
  getReadiness(): Promise<ReadinessReport>
  getNimRate(): Promise<NimIndicativeRate>
  getWalletNimBalance(): Promise<RpcNimBalance>
  listAccountBalances(addresses: string[]): Promise<HostAccountBalances>
}

export interface NimIndicativeRate {
  ngnPerNim: string
  source: string
  asOf: string
  expiresAt: string
}

export interface RpcNimBalance {
  balanceLuna: string
  balanceNim: string
  network: 'mainnet' | 'testnet'
  source: 'rpc'
}

export interface HostAccountBalance {
  suffix: string
  ok: boolean
  balanceLuna?: string
  balanceNim?: string
  error?: string
}

export interface HostAccountBalances {
  accounts: HostAccountBalance[]
  aggregateLuna: string
  aggregateNim: string
  okCount: number
  network: 'mainnet' | 'testnet'
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

  async createQuote(id: string): Promise<PaymentOrder> {
    const response = await this.request(`/payment-orders/${encodeURIComponent(id)}/quote`, { method: 'POST' })
    return (await response.json()) as PaymentOrder
  }

  async createPaymentIntent(id: string): Promise<PaymentIntentResponse> {
    const response = await this.request(`/payment-orders/${encodeURIComponent(id)}/payment-intent`, { method: 'POST' })
    return (await response.json()) as PaymentIntentResponse
  }

  async submitPayment(id: string, transactionHash: string): Promise<PaymentOrder> {
    const response = await this.request(`/payment-orders/${encodeURIComponent(id)}/payment-submission`, {
      method: 'POST',
      body: JSON.stringify({ transactionHash }),
    })
    return (await response.json()) as PaymentOrder
  }

  async reconcilePayment(id: string): Promise<PaymentOrder> {
    const response = await this.request(`/payment-orders/${encodeURIComponent(id)}/reconcile-payment`, { method: 'POST' })
    return (await response.json()) as PaymentOrder
  }

  async reconcileOrder(id: string): Promise<PaymentOrder> {
    const response = await this.request(`/payment-orders/${encodeURIComponent(id)}/reconcile`, { method: 'POST' })
    return (await response.json()) as PaymentOrder
  }

  async retryDelivery(id: string): Promise<PaymentOrder> {
    const response = await this.request(`/payment-orders/${encodeURIComponent(id)}/recovery/retry`, { method: 'POST' })
    return (await response.json()) as PaymentOrder
  }

  async listDataNetworks(): Promise<DataNetwork[]> {
    const response = await this.request('/data-networks')
    return ((await response.json()) as { networks: DataNetwork[] }).networks
  }

  async listDataPlans(network: SupportNetwork): Promise<DataPlan[]> {
    const response = await this.request(`/data-plans?network=${encodeURIComponent(network)}`)
    return ((await response.json()) as { plans: DataPlan[] }).plans
  }

  async createDataOrder(input: DataOrderInput): Promise<PaymentOrder> {
    const response = await this.request('/payment-orders', {
      method: 'POST',
      body: JSON.stringify({ serviceType: 'DATA', ...input }),
    })
    return (await response.json()) as PaymentOrder
  }

  async listCashoutBanks(): Promise<CashoutBank[]> {
    const response = await this.request('/cashout/banks')
    return ((await response.json()) as { banks: CashoutBank[] }).banks
  }

  async verifyCashoutAccount(input: { institution: string; accountNumber: string }) {
    const response = await this.request('/cashout/verify-account', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    return (await response.json()) as { bankCode: string; bankName: string; accountNumber: string; accountName: string }
  }

  async previewCashoutRate(usdtAmount: string): Promise<CashoutRatePreview> {
    const response = await this.request(`/cashout/rate?amount=${encodeURIComponent(usdtAmount)}`)
    return (await response.json()) as CashoutRatePreview
  }

  async createCashoutOrder(input: CashoutOrderInput): Promise<PaymentOrder> {
    const response = await this.request('/cashout/orders', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    return (await response.json()) as PaymentOrder
  }

  async createCashoutQuote(id: string): Promise<PaymentOrder> {
    const response = await this.request(`/cashout/${encodeURIComponent(id)}/quote`, { method: 'POST' })
    return (await response.json()) as PaymentOrder
  }

  async createCashoutIntent(id: string): Promise<CashoutIntentResponse> {
    const response = await this.request(`/cashout/${encodeURIComponent(id)}/intent`, { method: 'POST' })
    return (await response.json()) as CashoutIntentResponse
  }

  async submitCashoutPayment(id: string, transactionHash: string): Promise<PaymentOrder> {
    const response = await this.request(`/cashout/${encodeURIComponent(id)}/submit`, {
      method: 'POST',
      body: JSON.stringify({ transactionHash }),
    })
    return (await response.json()) as PaymentOrder
  }

  async reconcileCashoutOrder(id: string): Promise<PaymentOrder> {
    const response = await this.request(`/cashout/${encodeURIComponent(id)}/reconcile`, { method: 'POST' })
    return (await response.json()) as PaymentOrder
  }

  async refreshCashoutQuote(id: string): Promise<PaymentOrder> {
    const response = await this.request(`/cashout/${encodeURIComponent(id)}/refresh`, { method: 'POST' })
    return (await response.json()) as PaymentOrder
  }

  async getReadiness(): Promise<ReadinessReport> {
    const response = await this.request('/readiness')
    return (await response.json()) as ReadinessReport
  }

  async getNimRate(): Promise<NimIndicativeRate> {
    const response = await this.request('/nim/rate')
    return (await response.json()) as NimIndicativeRate
  }

  async getWalletNimBalance(): Promise<RpcNimBalance> {
    const response = await this.request('/wallet/nim-balance')
    return (await response.json()) as RpcNimBalance
  }

  async listAccountBalances(addresses: string[]): Promise<HostAccountBalances> {
    const response = await this.request('/wallet/account-balances', {
      method: 'POST',
      body: JSON.stringify({ addresses }),
    })
    return (await response.json()) as HostAccountBalances
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
