import type { NimiqWalletState } from '../integration/nimiq'

export type AccountAsset = 'NIM' | 'USDT'
export type AccountEnvironment = 'mainnet' | 'testnet' | 'unknown'

export type AssetBalanceResult =
  | { status: 'loading'; asset: AccountAsset }
  | { status: 'unavailable'; asset: AccountAsset; reason?: string }
  | { status: 'error'; asset: AccountAsset; error: string }
  | {
      status: 'available'
      asset: AccountAsset
      /** Non-negative decimal units, never a floating point monetary value. */
      amount: string
      network: string
      environment: AccountEnvironment
      accountReference?: string
      observedAt: number
    }

/** A future USDT integration must supply its own chain account, not a Nimiq address. */
export interface UsdtAccountContext {
  chain: string
  network: string
  environment: AccountEnvironment
  address: string
  tokenIdentifier: string
}

export type NgnQuoteResult =
  | { status: 'loading' | 'unavailable' }
  | { status: 'error'; error: string }
  | {
      status: 'available'
      asset: AccountAsset
      network: string
      ngnPerUnit: string
      source: string
      asOf: number
      expiresAt: number
    }

export interface AccountDataSources {
  readUsdtBalance: (account: UsdtAccountContext | undefined, signal: AbortSignal) => Promise<AssetBalanceResult>
  getNgnQuote: (asset: AccountAsset, network: string, signal: AbortSignal) => Promise<NgnQuoteResult>
}

export function mapNimBalance(wallet: NimiqWalletState): AssetBalanceResult {
  if (wallet.status === 'loading') return { status: 'loading', asset: 'NIM' }
  if (wallet.status === 'error') return { status: 'error', asset: 'NIM', error: wallet.error ?? 'Balance unavailable' }
  if (wallet.status === 'unavailable') return { status: 'unavailable', asset: 'NIM' }
  const amount = wallet.status === 'zero' ? '0' : wallet.nimBalance
  if (!amount || !parseDecimal(amount)) return { status: 'error', asset: 'NIM', error: 'Balance unavailable' }
  return {
    status: 'available', asset: 'NIM', amount, network: wallet.network,
    environment: wallet.network, accountReference: wallet.address, observedAt: Date.now(),
  }
}

export async function readUsdtBalance(account: UsdtAccountContext | undefined, signal: AbortSignal): Promise<AssetBalanceResult> {
  signal.throwIfAborted()
  // This production seam intentionally has no chain or provider integration yet.
  void account
  return { status: 'unavailable', asset: 'USDT', reason: 'Balance unavailable' }
}

export async function getNgnQuote(asset: AccountAsset, network: string, signal: AbortSignal): Promise<NgnQuoteResult> {
  signal.throwIfAborted()
  // No FX source is configured. The UI must not infer a conversion rate.
  void asset
  void network
  return { status: 'unavailable' }
}

export const accountDataSources: AccountDataSources = { readUsdtBalance, getNgnQuote }

/** Exact multiplication and half-up rounding to NGN's two decimal places. */
export function estimateNgn(balance: AssetBalanceResult, quote: NgnQuoteResult, now = Date.now()): string | null {
  if (balance.status !== 'available' || quote.status !== 'available') return null
  if (balance.environment !== 'mainnet' || balance.network !== quote.network || balance.asset !== quote.asset) return null
  if (!quote.source.trim() || !Number.isFinite(quote.asOf) || !Number.isFinite(quote.expiresAt) || quote.asOf > now || quote.expiresAt <= now || quote.expiresAt <= quote.asOf) return null
  const amount = parseDecimal(balance.amount)
  const rate = parseDecimal(quote.ngnPerUnit)
  if (!amount || !rate || rate.value === 0n) return null
  const product = amount.value * rate.value
  const scale = amount.scale + rate.scale
  const cents = scale <= 2
    ? product * 10n ** BigInt(2 - scale)
    : (product + 10n ** BigInt(scale - 2) / 2n) / 10n ** BigInt(scale - 2)
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`
}

function parseDecimal(value: string): { value: bigint; scale: number } | null {
  // Bound external payload size before constructing BigInts or powers of ten.
  if (value.length > 128 || !/^\d+(?:\.\d+)?$/.test(value)) return null
  const [whole, fractional = ''] = value.split('.')
  return { value: BigInt(whole + fractional), scale: fractional.length }
}
