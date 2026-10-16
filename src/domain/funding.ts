import { formatNimFromLunaBigint } from './orders'
import type { AssetBalanceResult, NgnQuoteResult } from './accountPresentation'

/**
 * Source-of-funds preview math. Everything is computed in integer luna
 * (BigInt) — never binary floating point. Amounts shown as deducted come
 * exclusively from the server quote passed in; nothing here invents a
 * competing payment amount.
 *
 * Payer-identity safety: Munus never assumes the displayed (session)
 * wallet is the account Nimiq Pay will actually debit — the wallet
 * chooses the sender at approval time. Callers must therefore present
 * `remainingNim` / `shortfallNim` as conditional ("if paid from this
 * connected wallet") and must never disable payment or promise an exact
 * post-payment balance on their basis.
 */

export interface FundingPreview {
  /** Exact server-quoted NIM about to leave, display only. */
  quoteNim: string
  quoteLuna: string
  balanceNim: string
  balanceLuna: string
  sufficient: boolean
  /** Exact remainder if this wallet pays. Conditional wording required. */
  remainingNim: string | null
  /** Exact gap if this wallet pays. Informational only, never blocking. */
  shortfallNim: string | null
}

function parseLuna(value: string): bigint | null {
  if (!/^\d{1,24}$/.test(value.trim())) return null
  try {
    return BigInt(value.trim())
  } catch {
    return null
  }
}

function parseDecimalParts(value: string): { digits: bigint; scale: number } | null {
  const text = value.trim()
  if (text.length > 64 || !/^\d+(?:\.\d+)?$/.test(text)) return null
  const [whole, fractional = ''] = text.split('.')
  return { digits: BigInt(whole + fractional), scale: fractional.length }
}

export interface IndicativeNimEstimate {
  /** Display NIM, rounded half-up to 5 decimals (NIM precision). */
  nim: string
  /** Conservative integer luna (ceiled) for shortfall comparison. */
  luna: string
}

/**
 * Informational form estimate only: ngnAmount / ngnPerNim in exact
 * decimal arithmetic. Never payment authority — the server quote
 * (ceil to integer luna) alone decides what leaves the wallet.
 * Returns null for non-positive or malformed input: show nothing.
 */
export function estimateNimFromNgn(ngnAmount: string, ngnPerNim: string): IndicativeNimEstimate | null {
  const ngn = parseDecimalParts(ngnAmount)
  const rate = parseDecimalParts(ngnPerNim)
  if (!ngn || !rate || ngn.digits <= 0n || rate.digits <= 0n) return null
  // nim = ngn / rate at 5-decimal NIM precision, half-up:
  // floor the scaled quotient, then round up when remainder >= half.
  const numerator = ngn.digits * 10n ** BigInt(rate.scale + 5)
  const denominator = rate.digits * 10n ** BigInt(ngn.scale)
  const q = numerator / denominator
  const r = numerator % denominator
  const halfUp = r * 2n >= denominator ? q + 1n : q
  const units = halfUp / 100000n
  const frac = (halfUp % 100000n).toString().padStart(5, '0').replace(/0+$/, '')
  const ceilLuna = (numerator + denominator - 1n) / denominator
  return {
    nim: frac === '' ? `${units}` : `${units}.${frac}`,
    luna: ceilLuna.toString(),
  }
}

/**
 * Builds the preview, or null when inputs are not exact non-negative
 * integer luna with a non-empty display amount. Null means "show no
 * preview" — never guess.
 */
export function buildFundingPreview(
  balanceLuna: string,
  balanceNim: string,
  quoteLuna: string,
  quoteNim: string,
): FundingPreview | null {
  const balance = parseLuna(balanceLuna)
  const quote = parseLuna(quoteLuna)
  if (balance === null || quote === null || quote <= 0n) return null
  if (!balanceNim.trim() || !quoteNim.trim()) return null
  if (balance >= quote) {
    return {
      quoteNim,
      quoteLuna: quote.toString(),
      balanceNim,
      balanceLuna: balance.toString(),
      sufficient: true,
      remainingNim: formatNimFromLunaBigint(balance - quote),
      shortfallNim: null,
    }
  }
  return {
    quoteNim,
    quoteLuna: quote.toString(),
    balanceNim,
    balanceLuna: balance.toString(),
    sufficient: false,
    remainingNim: null,
    shortfallNim: formatNimFromLunaBigint(quote - balance),
  }
}

/** Masked account hint. Only first/last groups ever reach the UI. */
export function maskFundingAccount(address: string): string {
  const compact = address.replace(/\s+/g, '')
  return compact.length > 10 ? `${compact.slice(0, 4)} •••• ${compact.slice(-4)}` : '••••'
}

export type NetworkProvenance = 'host' | 'rpc' | 'aggregate' | 'session' | 'none'

export interface NimFundingView {
  amountText: string
  estimateText: string | null
  statusText: string
  networkText: string
  networkProvenance: NetworkProvenance
  accountHint: string | null
}

/**
 * Single shared NIM funding view-model for Home, Airtime/Data review,
 * and Essential payer review. Pure presentation over already-resolved
 * balance + estimate truth — it never fetches, never formats money with
 * floats, and never decides payer identity.
 */
export function buildNimFundingView(input: {
  balance: AssetBalanceResult
  estimateNgn: string | null
  connectionReady: boolean
  walletNetwork: string
  hideAmounts: boolean
  /**
   * True while no usable rate exists yet and the shared loop is still
   * trying (initial mount, no error). Distinguishes "still loading"
   * from a prolonged rate failure so Home never flashes "unavailable"
   * the moment it mounts.
   */
  rateLoading?: boolean
  /**
   * Server/session-verified network, used ONLY when the host exposes
   * none. Rendered labeled (e.g. "Mainnet (session)") — never silently
   * substituted for host truth.
   */
  fallbackNetwork?: 'mainnet' | 'testnet'
}): NimFundingView {
  const { balance, estimateNgn, connectionReady, walletNetwork, hideAmounts, fallbackNetwork, rateLoading = false } = input
  // No ordering assumption between balance and rate: either may arrive
  // first and the view rerenders when the other lands. The copy names
  // exactly which leg is still missing.
  const rpcAttested = balance.status === 'available' && balance.source === 'rpc'
  const network: { text: string; provenance: NetworkProvenance } = networkDisplay(walletNetwork, fallbackNetwork, rpcAttested)
  const statusText = balance.status === 'loading'
    ? 'Loading balance'
    : balance.status === 'available'
      ? connectionReady ? 'Connected to Nimiq Pay' : 'Wallet unavailable'
      : 'Balance unavailable'
  if (hideAmounts) {
    const hiddenNetwork = balance.status === 'available'
      ? networkDisplay(balance.network, fallbackNetwork, rpcAttested)
      : network
    return {
      amountText: '••••',
      estimateText: 'NGN estimate hidden',
      statusText,
      networkText: hiddenNetwork.text,
      networkProvenance: hiddenNetwork.provenance,
      accountHint: balance.status === 'available' && balance.accountReference ? maskFundingAccount(balance.accountReference) : null,
    }
  }
  if (balance.status === 'loading') {
    return {
      amountText: '—',
      estimateText: rateLoading ? 'Getting current NIM rate…' : 'NGN estimate unavailable',
      statusText: 'Loading balance',
      networkText: network.text,
      networkProvenance: network.provenance,
      accountHint: null,
    }
  }
  if (balance.status !== 'available') {
    return {
      amountText: '—',
      estimateText: rateLoading ? 'Getting current NIM rate…' : 'NGN estimate unavailable',
      statusText,
      networkText: network.text,
      networkProvenance: network.provenance,
      accountHint: null,
    }
  }
  const liveNetwork = networkDisplay(balance.network, fallbackNetwork, rpcAttested)
  return {
    amountText: balance.amount,
    estimateText: estimateNgn !== null
      ? `≈ ₦${estimateNgn}`
      : rateLoading
        ? 'Getting current NIM rate…'
        : 'NGN estimate temporarily unavailable',
    statusText,
    networkText: liveNetwork.text,
    networkProvenance: liveNetwork.provenance,
    accountHint: balance.accountReference ? maskFundingAccount(balance.accountReference) : null,
  }
}

/**
 * Attribute a confirmed host balance to the resolved FX network for the
 * indicative estimate only. Returns the balance untouched unless it is
 * available, mismatched with an available quote, and the quote network
 * is the resolved effective network — i.e. the quote was fetched for a
 * session/aggregate-verified network while the host exposes none.
 */
export function nimBalanceForEstimate(
  balance: AssetBalanceResult,
  quote: NgnQuoteResult,
  quoteNetwork: string,
): AssetBalanceResult {
  if (balance.status !== 'available' || quote.status !== 'available') return balance
  if (balance.network === quote.network) return balance
  const resolved = quoteNetwork === 'mainnet' || quoteNetwork === 'testnet' ? quoteNetwork : null
  if (!resolved || quote.network !== resolved) return balance
  return { ...balance, network: resolved, environment: resolved }
}

function networkLabel(network: string): string {
  if (network === 'mainnet') return 'Mainnet'
  if (network === 'testnet') return 'Testnet'
  if (network === 'unknown') return 'Network unavailable'
  return network
}

/**
 * Display-only NGN amount: strips database decimal scale ("50.00000000"
 * → "50") without ever changing the value. Pure trailing-zero
 * removal plus leading-zero tidy, string-only — no floats, no rounding,
 * and fractional intent ("50.25") is preserved, never truncated.
 * Unparseable input returns untouched so display never crashes.
 */
export function formatNgnAmount(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) return value
  const trimmed = value.trim()
  const match = /^(\d+)(?:\.(\d+))?$/.exec(trimmed)
  if (!match) return value
  const whole = match[1].replace(/^0+(?=\d)/, '')
  const fraction = (match[2] ?? '').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole
}

/**
 * Aggregate funding view across host-exposed accounts. Same NimFundingView
 * shape so Home and review reuse one card; the amount is the exact
 * server-computed aggregate, the status names the funding context instead
 * of implying one auth address, and no account suffix ever renders here.
 */
export function buildAggregateFundingView(input: {
  nim: string
  estimateNgn: string | null
  network: 'mainnet' | 'testnet'
  /** Same loading-vs-failed distinction as the single-wallet view. */
  rateLoading?: boolean
}): NimFundingView {
  return {
    amountText: input.nim,
    estimateText: input.estimateNgn !== null
      ? `≈ ₦${input.estimateNgn}`
      : input.rateLoading
        ? 'Getting current NIM rate…'
        : 'NGN estimate temporarily unavailable',
    statusText: 'Available in Nimiq Pay',
    networkText: networkLabel(input.network),
    networkProvenance: 'aggregate',
    accountHint: null,
  }
}

function networkDisplay(
  walletNetwork: string,
  fallbackNetwork: 'mainnet' | 'testnet' | undefined,
  rpcAttested: boolean,
): { text: string; provenance: NetworkProvenance } {
  if (walletNetwork === 'mainnet' || walletNetwork === 'testnet') {
    // A live RPC balance attests its own network via server config;
    // host truth still wins for the word whenever the host is known.
    return { text: networkLabel(walletNetwork), provenance: rpcAttested ? 'rpc' : 'host' }
  }
  if (fallbackNetwork === 'mainnet' || fallbackNetwork === 'testnet') {
    return { text: `${networkLabel(fallbackNetwork)} (session)`, provenance: 'session' }
  }
  return { text: networkLabel(walletNetwork), provenance: 'none' }
}
