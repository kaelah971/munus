import type { NimIndicativeRate } from './paymentApi'

/**
 * Global public NIM/NGN market data. No session, no wallet, no user —
 * this endpoint serves the same informational shape as the authenticated
 * one and is safe to call at application bootstrap, before any sign-in.
 * Never payment authority: quotes are priced server-side per order.
 */
export const PUBLIC_NIM_NGN_PATH = '/public/rates/nim-ngn'

function isRateShape(value: unknown): value is NimIndicativeRate {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.ngnPerNim === 'string' &&
    record.ngnPerNim.trim() !== '' &&
    typeof record.source === 'string' &&
    record.source.trim() !== '' &&
    typeof record.asOf === 'string' &&
    Number.isFinite(Date.parse(record.asOf)) &&
    typeof record.expiresAt === 'string' &&
    Number.isFinite(Date.parse(record.expiresAt))
  )
}

/**
 * Fetch the global informational rate. Deliberately wallet- and
 * session-independent: network truth, balances, profiles, and routes
 * must never gate public market data.
 */
export async function fetchPublicNimRate(baseUrl: string, signal?: AbortSignal): Promise<NimIndicativeRate> {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}${PUBLIC_NIM_NGN_PATH}`, { signal })
  if (!response.ok) throw new Error('NIM rate unavailable.')
  const body = (await response.json()) as unknown
  if (!isRateShape(body)) throw new Error('NIM rate unavailable.')
  return body
}

/** Builds the fetcher feeding the single shared client rate store. */
export function createPublicNimRateFetcher(baseUrl: string) {
  return (signal: AbortSignal): Promise<NimIndicativeRate> => fetchPublicNimRate(baseUrl, signal)
}
