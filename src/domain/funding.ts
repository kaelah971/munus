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
   * Server/session-verified network, used ONLY when the host exposes
   * none. Rendered labeled (e.g. "Mainnet (session)") — never silently
   * substituted for host truth.
   */
  fallbackNetwork?: 'mainnet' | 'testnet'
}): NimFundingView {
  const { balance, estimateNgn, connectionReady, walletNetwork, hideAmounts, fallbackNetwork } = input
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
      estimateText: 'NGN estimate unavailable',
      statusText: 'Loading balance',
      networkText: network.text,
      networkProvenance: network.provenance,
      accountHint: null,
    }
  }
  if (balance.status !== 'available') {
    return {
      amountText: '—',
      estimateText: 'NGN estimate unavailable',
      statusText,
      networkText: network.text,
      networkProvenance: network.provenance,
      accountHint: null,
    }
  }
  const liveNetwork = networkDisplay(balance.network, fallbackNetwork, rpcAttested)
  return {
    amountText: balance.amount,
    estimateText: estimateNgn !== null ? `≈ ₦${estimateNgn}` : 'NGN estimate unavailable',
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
 * Aggregate funding view across host-exposed accounts. Same NimFundingView
 * shape so Home and review reuse one card; the amount is the exact
 * server-computed aggregate, the status names the funding context instead
 * of implying one auth address, and no account suffix ever renders here.
 */
export function buildAggregateFundingView(input: {
  nim: string
  estimateNgn: string | null
  network: 'mainnet' | 'testnet'
}): NimFundingView {
  return {
    amountText: input.nim,
    estimateText: input.estimateNgn !== null ? `≈ ₦${input.estimateNgn}` : 'NGN estimate unavailable',
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
