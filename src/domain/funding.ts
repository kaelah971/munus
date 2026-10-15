import { formatNimFromLunaBigint } from './orders'
import type { AssetBalanceResult } from './accountPresentation'

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

export type NetworkProvenance = 'host' | 'session' | 'none'

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
  const network: { text: string; provenance: NetworkProvenance } = networkDisplay(walletNetwork, fallbackNetwork)
  const statusText = balance.status === 'loading'
    ? 'Loading balance'
    : balance.status === 'available'
      ? connectionReady ? 'Connected to Nimiq Pay' : 'Wallet unavailable'
      : 'Balance unavailable'
  if (hideAmounts) {
    const hiddenNetwork = balance.status === 'available'
      ? networkDisplay(balance.network, fallbackNetwork)
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
  const liveNetwork = networkDisplay(balance.network, fallbackNetwork)
  return {
    amountText: balance.amount,
    estimateText: estimateNgn !== null ? `≈ ₦${estimateNgn}` : 'NGN estimate unavailable',
    statusText,
    networkText: liveNetwork.text,
    networkProvenance: liveNetwork.provenance,
    accountHint: balance.accountReference ? maskFundingAccount(balance.accountReference) : null,
  }
}

function networkLabel(network: string): string {
  if (network === 'mainnet') return 'Mainnet'
  if (network === 'testnet') return 'Testnet'
  if (network === 'unknown') return 'Network unavailable'
  return network
}

function networkDisplay(
  walletNetwork: string,
  fallbackNetwork: 'mainnet' | 'testnet' | undefined,
): { text: string; provenance: NetworkProvenance } {
  if (walletNetwork === 'mainnet' || walletNetwork === 'testnet') {
    return { text: networkLabel(walletNetwork), provenance: 'host' }
  }
  if (fallbackNetwork === 'mainnet' || fallbackNetwork === 'testnet') {
    return { text: `${networkLabel(fallbackNetwork)} (session)`, provenance: 'session' }
  }
  return { text: networkLabel(walletNetwork), provenance: 'none' }
}
