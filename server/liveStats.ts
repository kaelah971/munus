import { formatNimFromLunaBigint } from '../src/domain/orders'
import type { PaymentOrder } from '../src/domain/orders'
import type { EssentialRequest } from '../src/domain/essentialRequests'
import type { SupportRequest } from '../src/domain/support'
import type { DatabasePool } from './database'

/**
 * Munus Live is a public proof surface, not analytics. Every number below
 * is derived from production evidence with explicit, conservative
 * definitions. Anything that cannot be evidenced is omitted, never padded.
 *
 * Metric definitions (enforced identically by every LiveStatsSource):
 *
 * - verifiedWallets: DISTINCT users whose wallet row exists on mainnet. A
 *   user row is created only after a successful Nimiq Pay signature
 *   verification, so each counted wallet authenticated at least once.
 *   Duplicate sessions never inflate this: it counts wallets, not logins.
 * - activeUsers7d: DISTINCT mainnet users with a persisted session, order,
 *   or support request created in the trailing 7 days. Page views and
 *   anonymous visits are not persisted and cannot count.
 * - deliveredEssentials: AIRTIME/DATA orders with payment_status PAID,
 *   fulfilment_status DELIVERED, payment_network mainnet, and a non-null
 *   payment_verified_at. Legacy orders without network evidence are
 *   excluded rather than guessed.
 * - nimUsed: SUM of quote_luna_amount (bigint, the exact integer the
 *   on-chain verification matched) over verified mainnet NIM payments
 *   (PAID + payment_verified_at, AIRTIME/DATA). Quoted-but-unpaid orders
 *   never sum. Fulfilment state does not gate this: moved NIM is moved NIM.
 * - usdtCashedOut: SUM of usdt_total_amount over CASH_OUT orders with
 *   PAID + provider-settled DELIVERED. The cash-out rail carries no Nimiq
 *   network field; mainnet-only creation is enforced by CashoutService on
 *   mainnet deployments, so settled evidence is the production filter.
 * - requestsCompleted: essential_status COMPLETED rows with a linked order
 *   that is itself PAID + DELIVERED on mainnet. Manually closed or
 *   unlinked requests never count.
 *
 * Test/demo exclusion is by persisted evidence only (mainnet markers plus
 * verified/settled timestamps). No source/environment guessing exists.
 */

/** Live stats recompute at most once per minute; the DTO carries updatedAt. */
export const LIVE_STATS_CACHE_TTL_MS = 60_000
/** Bounded public feed size. No query parameter may change it. */
export const LIVE_FEED_LIMIT = 10
/** Trailing activity window for the active-users metric, in days. */
export const LIVE_ACTIVE_WINDOW_DAYS = 7

export interface LiveMetrics {
  verifiedWallets: number
  activeUsers7d: number
  deliveredEssentials: number
  /** Exact NIM decimal rendered from verified luna evidence. */
  nimUsed: string
  /** Verified mainnet NIM payments backing nimUsed. */
  nimPayments: number
  /** Settled CASH_OUT orders backing usdtCashedOut. */
  cashoutOrders: number
  /** Exact USDT decimal rendered from settled provider evidence. */
  usdtCashedOut: string
  requestsCompleted: number
}

export type LiveActivityEvent =
  | { kind: 'wallet-joined'; walletMasked: string; at: string }
  | { kind: 'airtime-delivered'; network?: string; amountNgn: string; walletMasked: string; at: string }
  | { kind: 'data-delivered'; network?: string; dataAllowance?: string; walletMasked: string; at: string }
  | { kind: 'request-completed'; serviceLabel: string; detail: string; at: string }
  | { kind: 'cashout-settled'; usdtAmount: string; walletMasked: string; at: string }

export interface LiveStatsSnapshot {
  metrics: LiveMetrics
  /** Newest first, bounded to LIVE_FEED_LIMIT, fully redacted server-side. */
  recentActivity: LiveActivityEvent[]
  updatedAt: string
}

/**
 * Privacy: only the first and last four characters of the compact wallet
 * address ever leave the server (e.g. `NQ47…BCKQ`). Phones, bank details,
 * account names, provider references, tx hashes, and internal ids never
 * enter the public DTO.
 */
export function maskLiveWallet(walletAddress: string): string {
  const compact = walletAddress.replace(/\s+/g, '')
  if (compact.length <= 8) return '••••'
  return `${compact.slice(0, 4)}…${compact.slice(-4)}`
}

/** Exact decimal string without float arithmetic (`100.50000000`→`100.5`). */
export function normalizeDecimalAmount(value: string): string {
  const text = value.trim()
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error('Amount is not a plain decimal string.')
  if (!text.includes('.')) return text.replace(/^0+(?=\d)/, '') || '0'
  const [whole, fraction] = text.split('.') as [string, string]
  const trimmedFraction = fraction.replace(/0+$/, '')
  const normalizedWhole = whole.replace(/^0+(?=\d)/, '') || '0'
  return trimmedFraction === '' ? normalizedWhole : `${normalizedWhole}.${trimmedFraction}`
}

export interface LiveStatsSource {
  countVerifiedWallets(): Promise<number>
  countActiveUsers(sinceIso: string): Promise<number>
  summarizeDeliveredEssentials(): Promise<{ deliveredOrders: number; nimPayments: number; lunaTotal: bigint }>
  summarizeSettledCashouts(): Promise<{ orders: number; usdtTotal: string }>
  countCompletedRequests(): Promise<number>
  listRecentActivity(limit: number): Promise<LiveActivityEvent[]>
}

export class LiveStatsService {
  private cached: { snapshot: LiveStatsSnapshot; expiresAt: number } | null = null

  constructor(
    private readonly source: LiveStatsSource,
    private readonly options: { now?: () => number; ttlMs?: number } = {},
  ) {}

  async getSnapshot(): Promise<LiveStatsSnapshot> {
    const now = this.options.now?.() ?? Date.now()
    if (this.cached && this.cached.expiresAt > now) return this.cached.snapshot
    const ttlMs = this.options.ttlMs ?? LIVE_STATS_CACHE_TTL_MS
    const sinceIso = new Date(now - LIVE_ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const [verifiedWallets, activeUsers7d, essentials, cashouts, requestsCompleted, recentActivity] = await Promise.all([
      this.source.countVerifiedWallets(),
      this.source.countActiveUsers(sinceIso),
      this.source.summarizeDeliveredEssentials(),
      this.source.summarizeSettledCashouts(),
      this.source.countCompletedRequests(),
      this.source.listRecentActivity(LIVE_FEED_LIMIT),
    ])
    const snapshot: LiveStatsSnapshot = {
      metrics: {
        verifiedWallets,
        activeUsers7d,
        deliveredEssentials: essentials.deliveredOrders,
        nimUsed: formatNimFromLunaBigint(essentials.lunaTotal),
        nimPayments: essentials.nimPayments,
        cashoutOrders: cashouts.orders,
        usdtCashedOut: normalizeDecimalAmount(cashouts.usdtTotal),
        requestsCompleted,
      },
      recentActivity,
      updatedAt: new Date(now).toISOString(),
    }
    this.cached = { snapshot, expiresAt: now + ttlMs }
    return snapshot
  }
}

function isMainnetOrderForLive(order: PaymentOrder): boolean {
  return order.paymentNetwork === 'mainnet'
}

function isVerifiedEssentialDelivery(order: PaymentOrder): boolean {
  return (
    (order.serviceType === 'AIRTIME' || order.serviceType === 'DATA') &&
    order.paymentStatus === 'PAID' &&
    order.fulfilmentStatus === 'DELIVERED' &&
    isMainnetOrderForLive(order) &&
    Boolean(order.paymentVerifiedAt)
  )
}

function isVerifiedNimPayment(order: PaymentOrder): boolean {
  return (
    (order.serviceType === 'AIRTIME' || order.serviceType === 'DATA') &&
    order.paymentAsset === 'NIM' &&
    order.paymentStatus === 'PAID' &&
    isMainnetOrderForLive(order) &&
    Boolean(order.paymentVerifiedAt) &&
    Boolean(order.quoteLunaAmount)
  )
}

function isSettledCashout(order: PaymentOrder): boolean {
  return (
    order.serviceType === 'CASH_OUT' &&
    order.paymentAsset === 'USDT' &&
    order.paymentStatus === 'PAID' &&
    order.fulfilmentStatus === 'DELIVERED' &&
    Boolean(order.usdtTotalAmount)
  )
}

export interface InMemoryLiveTables {
  // Suppliers (not one-shot iterators): each metric reads a fresh view so
  // later mutations remain visible across calls.
  users: () => Iterable<{ id: string; walletAddress: string; network: string }>
  sessions: () => Iterable<{ userId: string; createdAt: number | string }>
  orders: () => Iterable<PaymentOrder>
  essentialRequests: () => Iterable<EssentialRequest>
  supportRequests: () => Iterable<Pick<SupportRequest, 'ownerUserId' | 'createdAt'>>
}

function toMs(value: number | string): number {
  return typeof value === 'number' ? value : Date.parse(value)
}

/** Same definitions as Postgres, over in-memory tables. Used by tests/dev. */
export class InMemoryLiveStatsSource implements LiveStatsSource {
  constructor(private readonly tables: InMemoryLiveTables) {}

  async countVerifiedWallets(): Promise<number> {
    const wallets = new Set<string>()
    for (const user of this.tables.users()) {
      if (user.network === 'mainnet') wallets.add(user.id)
    }
    return wallets.size
  }

  async countActiveUsers(sinceIso: string): Promise<number> {
    const sinceMs = Date.parse(sinceIso)
    const mainnetUsers = new Set<string>()
    for (const user of this.tables.users()) {
      if (user.network === 'mainnet') mainnetUsers.add(user.id)
    }
    const active = new Set<string>()
    for (const session of this.tables.sessions()) {
      if (mainnetUsers.has(session.userId) && toMs(session.createdAt) >= sinceMs) active.add(session.userId)
    }
    for (const order of this.tables.orders()) {
      if (mainnetUsers.has(order.userId) && Date.parse(order.createdAt) >= sinceMs) active.add(order.userId)
    }
    for (const request of this.tables.supportRequests()) {
      if (mainnetUsers.has(request.ownerUserId) && Date.parse(request.createdAt) >= sinceMs) active.add(request.ownerUserId)
    }
    return active.size
  }

  async summarizeDeliveredEssentials(): Promise<{ deliveredOrders: number; nimPayments: number; lunaTotal: bigint }> {
    let deliveredOrders = 0
    let nimPayments = 0
    let lunaTotal = 0n
    for (const order of this.tables.orders()) {
      if (isVerifiedEssentialDelivery(order)) deliveredOrders += 1
      if (isVerifiedNimPayment(order)) {
        nimPayments += 1
        lunaTotal += BigInt(order.quoteLunaAmount as string)
      }
    }
    return { deliveredOrders, nimPayments, lunaTotal }
  }

  async summarizeSettledCashouts(): Promise<{ orders: number; usdtTotal: string }> {
    let orders = 0
    let totalHundredths = 0n
    // Exact decimal addition at 8 places (Paycrest numeric scale), no floats.
    const SCALE = 8n
    for (const order of this.tables.orders()) {
      if (!isSettledCashout(order)) continue
      orders += 1
      const [whole, fraction = ''] = (order.usdtTotalAmount as string).split('.')
      totalHundredths += BigInt(whole) * 10n ** SCALE + BigInt((fraction + '0'.repeat(8)).slice(0, 8))
    }
    const whole = totalHundredths / 10n ** SCALE
    const fraction = (totalHundredths % 10n ** SCALE).toString().padStart(8, '0')
    return { orders, usdtTotal: `${whole}.${fraction}` }
  }

  async countCompletedRequests(): Promise<number> {
    const ordersById = new Map<string, PaymentOrder>()
    for (const order of this.tables.orders()) ordersById.set(order.id, order)
    let count = 0
    for (const request of this.tables.essentialRequests()) {
      if (request.essentialStatus !== 'COMPLETED' || !request.paymentOrderId) continue
      const linked = ordersById.get(request.paymentOrderId)
      if (linked && isVerifiedEssentialDelivery(linked)) count += 1
    }
    return count
  }

  async listRecentActivity(limit: number): Promise<LiveActivityEvent[]> {
    const walletsByUser = new Map<string, string>()
    for (const user of this.tables.users()) {
      if (user.network === 'mainnet') walletsByUser.set(user.id, user.walletAddress)
    }
    const joinedAt = new Map<string, number>()
    for (const session of this.tables.sessions()) {
      if (!walletsByUser.has(session.userId)) continue
      const at = toMs(session.createdAt)
      if (!Number.isFinite(at)) continue
      const earliest = joinedAt.get(session.userId)
      if (earliest === undefined || at < earliest) joinedAt.set(session.userId, at)
    }
    const events: Array<LiveActivityEvent & { atMs: number }> = []
    for (const [userId, atMs] of joinedAt) {
      const wallet = walletsByUser.get(userId)
      if (!wallet) continue
      events.push({ kind: 'wallet-joined', walletMasked: maskLiveWallet(wallet), at: new Date(atMs).toISOString(), atMs })
    }
    for (const order of this.tables.orders()) {
      const wallet = walletsByUser.get(order.userId)
      if (!wallet || !order.fulfilledAt) continue
      const atMs = Date.parse(order.fulfilledAt)
      if (!Number.isFinite(atMs)) continue
      if (isVerifiedEssentialDelivery(order)) {
        events.push(order.serviceType === 'DATA'
          ? {
            kind: 'data-delivered',
            ...(order.recipientNetwork ? { network: order.recipientNetwork } : {}),
            ...(order.planDataAllowance ? { dataAllowance: order.planDataAllowance } : {}),
            walletMasked: maskLiveWallet(wallet),
            at: order.fulfilledAt,
            atMs,
          }
          : {
            kind: 'airtime-delivered',
            ...(order.recipientNetwork ? { network: order.recipientNetwork } : {}),
            amountNgn: order.requestedAmount,
            walletMasked: maskLiveWallet(wallet),
            at: order.fulfilledAt,
            atMs,
          })
      } else if (isSettledCashout(order)) {
        events.push({
          kind: 'cashout-settled',
          usdtAmount: normalizeDecimalAmount(order.usdtTotalAmount as string),
          walletMasked: maskLiveWallet(wallet),
          at: order.fulfilledAt,
          atMs,
        })
      }
    }
    for (const request of this.tables.essentialRequests()) {
      if (request.essentialStatus !== 'COMPLETED' || !request.fulfilledAt) continue
      const atMs = Date.parse(request.fulfilledAt)
      if (!Number.isFinite(atMs)) continue
      const isData = request.serviceType === 'DATA'
      events.push({
        kind: 'request-completed',
        serviceLabel: isData ? 'Data' : 'Airtime',
        detail: isData
          ? [request.planDataAllowance, request.network].filter(Boolean).join(' · ')
          : `₦${request.requestedAmount}`,
        at: request.fulfilledAt,
        atMs,
      })
    }
    events.sort((a, b) => b.atMs - a.atMs)
    return events.slice(0, limit).map((entry) => {
      const { atMs: _atMs, ...event } = entry
      void _atMs
      return event
    })
  }
}

function requireCount(value: unknown, label: string): number {
  const count = Number(value)
  if (!Number.isSafeInteger(count) || count < 0) throw new Error(`Live ${label} aggregate was not a count.`)
  return count
}

function requireIso(value: unknown): string {
  const text = value instanceof Date ? value.toISOString() : String(value ?? '')
  if (!Number.isFinite(Date.parse(text))) throw new Error('Live aggregate timestamp was not valid.')
  return new Date(text).toISOString()
}

/** Aggregate SQL over production tables. Bounded; no raw user input. */
export class PostgresLiveStatsSource implements LiveStatsSource {
  constructor(private readonly database: DatabasePool) {}

  async countVerifiedWallets(): Promise<number> {
    const result = await this.database.query(
      `SELECT COUNT(DISTINCT id) AS count FROM public.users WHERE wallet_network = 'mainnet'`,
    )
    return requireCount(result.rows[0]?.count, 'verified-wallet')
  }

  async countActiveUsers(sinceIso: string): Promise<number> {
    const result = await this.database.query(
      `SELECT COUNT(DISTINCT u.id) AS count
       FROM public.users u
       WHERE u.wallet_network = 'mainnet' AND (
         EXISTS (SELECT 1 FROM public.sessions s WHERE s.user_id = u.id AND s.created_at >= $1::timestamptz)
         OR EXISTS (SELECT 1 FROM public.payment_orders o WHERE o.user_id = u.id AND o.created_at >= $1::timestamptz)
         OR EXISTS (SELECT 1 FROM public.support_requests r WHERE r.owner_user_id = u.id AND r.created_at >= $1::timestamptz)
       )`,
      [sinceIso],
    )
    return requireCount(result.rows[0]?.count, 'active-user')
  }

  async summarizeDeliveredEssentials(): Promise<{ deliveredOrders: number; nimPayments: number; lunaTotal: bigint }> {
    const result = await this.database.query(
      `SELECT COUNT(*) FILTER (WHERE fulfilment_status = 'DELIVERED') AS delivered,
              COUNT(*) AS payments,
              COALESCE(SUM(CASE WHEN payment_asset = 'NIM' AND quote_luna_amount IS NOT NULL THEN quote_luna_amount END), 0) AS luna
       FROM public.payment_orders
       WHERE service_type IN ('AIRTIME', 'DATA')
         AND payment_status = 'PAID'
         AND payment_network = 'mainnet'
         AND payment_verified_at IS NOT NULL`,
    )
    const row = result.rows[0] as Record<string, unknown> | undefined
    return {
      deliveredOrders: requireCount(row?.delivered, 'delivered-essential'),
      nimPayments: requireCount(row?.payments, 'verified-nim-payment'),
      lunaTotal: BigInt(String(row?.luna ?? '0')),
    }
  }

  async summarizeSettledCashouts(): Promise<{ orders: number; usdtTotal: string }> {
    const result = await this.database.query(
      `SELECT COUNT(*) AS orders, COALESCE(SUM(usdt_total_amount), 0) AS usdt
       FROM public.payment_orders
       WHERE service_type = 'CASH_OUT'
         AND payment_status = 'PAID'
         AND fulfilment_status = 'DELIVERED'
         AND usdt_total_amount IS NOT NULL`,
    )
    const row = result.rows[0] as Record<string, unknown> | undefined
    return { orders: requireCount(row?.orders, 'settled-cashout'), usdtTotal: String(row?.usdt ?? '0') }
  }

  async countCompletedRequests(): Promise<number> {
    const result = await this.database.query(
      `SELECT COUNT(*) AS count
       FROM public.support_requests r
       WHERE r.essential_status = 'COMPLETED'
         AND r.payment_order_id IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM public.payment_orders o
           WHERE o.id = r.payment_order_id
             AND o.service_type IN ('AIRTIME', 'DATA')
             AND o.payment_status = 'PAID'
             AND o.fulfilment_status = 'DELIVERED'
             AND o.payment_network = 'mainnet'
             AND o.payment_verified_at IS NOT NULL
         )`,
    )
    return requireCount(result.rows[0]?.count, 'completed-request')
  }

  async listRecentActivity(limit: number): Promise<LiveActivityEvent[]> {
    const [deliveries, cashouts, requests, wallets] = await Promise.all([
      this.database.query(
        `SELECT o.service_type AS service, o.recipient_network AS network,
                o.requested_amount AS amount, o.plan_data_allowance AS allowance,
                o.fulfilled_at AS at, u.wallet_address AS wallet
         FROM public.payment_orders o
         JOIN public.users u ON u.id = o.user_id
         WHERE o.service_type IN ('AIRTIME', 'DATA')
           AND o.payment_status = 'PAID'
           AND o.fulfilment_status = 'DELIVERED'
           AND o.payment_network = 'mainnet'
           AND o.payment_verified_at IS NOT NULL
           AND o.fulfilled_at IS NOT NULL
         ORDER BY o.fulfilled_at DESC
         LIMIT $1`,
        [limit],
      ),
      this.database.query(
        `SELECT o.usdt_total_amount AS usdt, o.fulfilled_at AS at, u.wallet_address AS wallet
         FROM public.payment_orders o
         JOIN public.users u ON u.id = o.user_id
         WHERE o.service_type = 'CASH_OUT'
           AND o.payment_status = 'PAID'
           AND o.fulfilment_status = 'DELIVERED'
           AND o.usdt_total_amount IS NOT NULL
           AND o.fulfilled_at IS NOT NULL
         ORDER BY o.fulfilled_at DESC
         LIMIT $1`,
        [limit],
      ),
      this.database.query(
        `SELECT r.service_type AS service, r.network AS network,
                r.requested_amount AS amount, r.plan_data_allowance AS allowance,
                r.fulfilled_at AS at
         FROM public.support_requests r
         WHERE r.essential_status = 'COMPLETED'
           AND r.fulfilled_at IS NOT NULL
           AND r.payment_order_id IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM public.payment_orders o
             WHERE o.id = r.payment_order_id
               AND o.service_type IN ('AIRTIME', 'DATA')
               AND o.payment_status = 'PAID'
               AND o.fulfilment_status = 'DELIVERED'
               AND o.payment_network = 'mainnet'
               AND o.payment_verified_at IS NOT NULL
           )
         ORDER BY r.fulfilled_at DESC
         LIMIT $1`,
        [limit],
      ),
      this.database.query(
        `SELECT u.wallet_address AS wallet, MIN(s.created_at) AS at
         FROM public.users u
         JOIN public.sessions s ON s.user_id = u.id
         WHERE u.wallet_network = 'mainnet'
         GROUP BY u.wallet_address
         ORDER BY MIN(s.created_at) DESC
         LIMIT $1`,
        [limit],
      ),
    ])
    type Row = Record<string, unknown>
    const events: Array<LiveActivityEvent & { atMs: number }> = []
    const push = (event: LiveActivityEvent, at: unknown) => {
      const atMs = Date.parse(requireIso(at))
      events.push({ ...event, atMs })
    }
    for (const row of deliveries.rows as Row[]) {
      const at = requireIso(row.at)
      push(row.service === 'DATA'
        ? {
          kind: 'data-delivered',
          ...(row.network ? { network: String(row.network) } : {}),
          ...(row.allowance ? { dataAllowance: String(row.allowance) } : {}),
          walletMasked: maskLiveWallet(String(row.wallet)),
          at,
        }
        : {
          kind: 'airtime-delivered',
          ...(row.network ? { network: String(row.network) } : {}),
          amountNgn: String(row.amount),
          walletMasked: maskLiveWallet(String(row.wallet)),
          at,
        }, at)
    }
    for (const row of cashouts.rows as Row[]) {
      const at = requireIso(row.at)
      push({
        kind: 'cashout-settled',
        usdtAmount: normalizeDecimalAmount(String(row.usdt)),
        walletMasked: maskLiveWallet(String(row.wallet)),
        at,
      }, at)
    }
    for (const row of requests.rows as Row[]) {
      const at = requireIso(row.at)
      const isData = row.service === 'DATA'
      push({
        kind: 'request-completed',
        serviceLabel: isData ? 'Data' : 'Airtime',
        detail: isData
          ? [row.allowance ? String(row.allowance) : '', row.network ? String(row.network) : ''].filter(Boolean).join(' · ')
          : `₦${String(row.amount)}`,
        at,
      }, at)
    }
    for (const row of wallets.rows as Row[]) {
      const at = requireIso(row.at)
      push({ kind: 'wallet-joined', walletMasked: maskLiveWallet(String(row.wallet)), at }, at)
    }
    events.sort((a, b) => b.atMs - a.atMs)
    return events.slice(0, limit).map((entry) => {
      const { atMs: _atMs, ...event } = entry
      void _atMs
      return event
    })
  }
}
