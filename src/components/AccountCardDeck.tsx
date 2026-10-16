import { useEffect, useState } from 'react'
import {
  accountDataSources, estimateNgn, mapNimBalance,
  type AccountAsset, type AccountDataSources, type AssetBalanceResult,
  type NgnQuoteResult, type UsdtAccountContext,
} from '../domain/accountPresentation'
import { buildAggregateFundingView, buildNimFundingView, nimBalanceForEstimate } from '../domain/funding'
import { NimFundingCard } from './NimFundingCard'
import { RECENT_RATE_TTL_MS, useNimRate } from '../hooks/useNimRate'
import type { NimiqConnectionState, NimiqWalletState } from '../integration/nimiq'

const unavailableQuote: NgnQuoteResult = { status: 'unavailable' }
const unavailableUsdt: AssetBalanceResult = { status: 'unavailable', asset: 'USDT' }

export function AccountCardDeck({ wallet, connection, hideBalances, sources = accountDataSources, usdtAccount, fallbackNetwork, aggregate }: {
  wallet: NimiqWalletState
  connection: NimiqConnectionState
  hideBalances: boolean
  sources?: AccountDataSources
  usdtAccount?: UsdtAccountContext
  /** Session-verified network shown labeled when the host exposes none. */
  fallbackNetwork?: 'mainnet' | 'testnet'
  /**
   * Confirmed aggregate across host-exposed accounts. Takes precedence
   * over the single-wallet view when ready; hideAmounts still masks it.
   */
  aggregate?: { luna: string; nim: string; network: 'mainnet' | 'testnet' } | null
}) {
  const [selectedAsset, setSelectedAsset] = useState<AccountAsset>('NIM')
  const [usdtQuote, setUsdtQuote] = useState<{ key: string; quote: NgnQuoteResult } | null>(null)
  const [usdtResult, setUsdtResult] = useState<{ key: string; balance: AssetBalanceResult } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const accountKey = JSON.stringify([connection.status, wallet.address, wallet.network, usdtAccount])
  const nim = currentNimBalance(wallet, connection)
  const usdt = usdtResult?.key === accountKey ? usdtResult.balance : unavailableUsdt
  // The NIM/NGN rate is network-independent market data. Resolve the
  // lookup network host → aggregate → session fallback so an unknown host
  // network never suppresses a real estimate; display provenance stays
  // labeled in the funding view.
  const quoteNetwork = wallet.network === 'mainnet' || wallet.network === 'testnet'
    ? wallet.network
    : aggregate?.network ?? fallbackNetwork ?? wallet.network
  const nimRate = useNimRate(now)
  // Informational horizon: the hook retains a displayable rate for up to
  // 15 minutes past observation, so the mapped quote carries that horizon
  // — not the 120s server payment TTL. Payment quotes never see this
  // object; they price server-side with their own strict expiry.
  const nimQuote: NgnQuoteResult = (() => {
    const rate = nimRate.rate
    if (!rate) return unavailableQuote
    const asOf = Date.parse(rate.asOf)
    if (!Number.isFinite(asOf)) return unavailableQuote
    return {
      status: 'available',
      asset: 'NIM',
      network: quoteNetwork,
      ngnPerUnit: rate.ngnPerNim,
      source: rate.source,
      asOf,
      expiresAt: asOf + RECENT_RATE_TTL_MS,
    }
  })()
  const usdtQuoteValue = usdtQuote?.key === accountKey ? usdtQuote.quote : unavailableQuote

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    const readQuote = (asset: AccountAsset, network: string) => sources.getNgnQuote(asset, network, controller.signal).catch((): NgnQuoteResult => ({ status: 'unavailable' }))
    // Currency data sources are independent; a future USDT failure must not suppress NIM's quote.
    void sources.readUsdtBalance(usdtAccount, controller.signal).then(async (balance) => {
      const validBalance = balance.asset === 'USDT' ? balance : unavailableUsdt
      if (active) setUsdtResult({ key: accountKey, balance: validBalance })
      const USDT = validBalance.status === 'available' ? await readQuote('USDT', validBalance.network) : unavailableQuote
      if (active) setUsdtQuote({ key: accountKey, quote: USDT })
    }).catch(() => {
      if (active) setUsdtResult({ key: accountKey, balance: { status: 'error', asset: 'USDT', error: 'Balance unavailable' } })
    })
    return () => { active = false; controller.abort() }
  }, [accountKey, sources, usdtAccount])

  useEffect(() => {
    const refresh = () => setNow(Date.now())
    const interval = window.setInterval(refresh, 1000)
    window.addEventListener('focus', refresh)
    return () => { window.clearInterval(interval); window.removeEventListener('focus', refresh) }
  }, [])

  return (
    <section className="account-deck" aria-label="Your accounts">
      {(['NIM', 'USDT'] as const).map((asset) => {
        const balance = asset === 'NIM' ? nim : usdt
        const quote = asset === 'NIM' ? nimQuote : usdtQuoteValue
        const estimate = estimateNgn(
          asset === 'NIM' ? nimBalanceForEstimate(balance, quote, quoteNetwork) : balance,
          quote,
          now,
        )
        const selected = selectedAsset === asset
        return (
          <article key={asset} className={`account-card munus-card ${asset === 'NIM' ? 'munus-card-elevated' : ''} account-card--${asset.toLowerCase()} ${selected ? 'account-card--front' : 'account-card--rear'}`}>
            <button className="account-card-select" type="button" aria-label={`View ${asset} account`} aria-pressed={selected} onClick={() => setSelectedAsset(asset)}>
              <span>{asset}</span><span aria-hidden="true">{selected ? '●' : '↑'}</span>
            </button>
            <div className="account-card-details" aria-hidden={!selected}>
              {asset === 'NIM' ? (
                <NimFundingCard view={(() => {
                  if (aggregate && !hideBalances) {
                    const aggregateBalance: AssetBalanceResult = {
                      status: 'available',
                      asset: 'NIM',
                      amount: aggregate.nim,
                      network: aggregate.network,
                      environment: aggregate.network,
                      observedAt: Date.now(),
                      source: 'rpc',
                    }
                    return buildAggregateFundingView({
                      nim: aggregate.nim,
                      estimateNgn: estimateNgn(aggregateBalance, nimQuote, now),
                      network: aggregate.network,
                    })
                  }
                  return buildNimFundingView({
                    balance: nim,
                    estimateNgn: estimate,
                    connectionReady: connection.status === 'ready',
                    walletNetwork: wallet.network,
                    hideAmounts: hideBalances,
                    fallbackNetwork,
                  })
                })()} />
              ) : (
                <>
                  <p className="account-card-balance">{hideBalances ? '••••' : balance.status === 'available' ? balance.amount : '—'} {asset}</p>
                  <p className="account-card-estimate">{hideBalances ? 'NGN estimate hidden' : estimate !== null ? `≈ ₦${estimate}` : 'NGN estimate unavailable'}</p>
                  <div className="account-card-meta">
                    <span>{balance.status === 'loading' ? 'Loading balance' : balance.status === 'available' ? 'Balance available' : 'Balance unavailable'}</span>
                    <span>USDT</span>
                  </div>
                </>
              )}
            </div>
          </article>
        )
      })}
    </section>
  )
}

function currentNimBalance(wallet: NimiqWalletState, connection: NimiqConnectionState): AssetBalanceResult {
  if (connection.status === 'initializing') return { status: 'loading', asset: 'NIM' }
  if (connection.status !== 'ready') return { status: 'unavailable', asset: 'NIM' }
  if (!wallet.address) return wallet.status === 'loading'
    ? { status: 'loading', asset: 'NIM' }
    : { status: 'unavailable', asset: 'NIM' }
  return mapNimBalance(wallet)
}
