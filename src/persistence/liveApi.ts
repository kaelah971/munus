/** Public Munus Live proof DTO. Mirrors server/liveStats.ts shapes; every
 *  field is pre-redacted server-side — the client never hides privates. */

export interface LiveMetrics {
  verifiedWallets: number
  activeUsers7d: number
  deliveredEssentials: number
  nimUsed: string
  nimPayments: number
  cashoutOrders: number
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
  recentActivity: LiveActivityEvent[]
  updatedAt: string
}

function isLiveSnapshot(value: unknown): value is LiveStatsSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Record<string, unknown>
  return Boolean(snapshot.metrics) && Array.isArray(snapshot.recentActivity) && typeof snapshot.updatedAt === 'string'
}

export async function fetchPublicLive(apiBaseUrl: string): Promise<LiveStatsSnapshot> {
  const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/public/live`)
  if (!response.ok) {
    throw new Error('Munus Live is unavailable right now.')
  }
  const body = (await response.json()) as unknown
  if (!isLiveSnapshot(body)) {
    throw new Error('Munus Live returned an unexpected response.')
  }
  return body
}
