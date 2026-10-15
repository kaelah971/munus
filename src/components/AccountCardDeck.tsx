import { useEffect, useState } from 'react'
import {
  accountDataSources, estimateNgn, mapNimBalance,
  type AccountAsset, type AccountDataSources, type AssetBalanceResult,
  type NgnQuoteResult, type UsdtAccountContext,
} from '../domain/accountPresentation'
import { buildNimFundingView } from '../domain/funding'
import { NimFundingCard } from './NimFundingCard'
import type { NimiqConnectionState, NimiqWalletState } from '../integration/nimiq'

const unavailableQuote: NgnQuoteResult = { status: 'unavailable' }
const unavailableUsdt: AssetBalanceResult = { status: 'unavailable', asset: 'USDT' }

export function AccountCardDeck({ wallet, connection, hideBalances, sources = accountDataSources, usdtAccount, fallbackNetwork }: {
  wallet: NimiqWalletState
  connection: NimiqConnectionState
  hideBalances: boolean
  sources?: AccountDataSources
  usdtAccount?: UsdtAccountContext
  /** Session-verified network shown labeled when the host exposes none. */
  fallbackNetwork?: 'mainnet' | 'testnet'
}) {
  const [selectedAsset, setSelectedAsset] = useState<AccountAsset>('NIM')
  const [quotes, setQuotes] = useState<{ key: string; NIM: NgnQuoteResult; USDT: NgnQuoteResult } | null>(null)
  const [usdtResult, setUsdtResult] = useState<{ key: string; balance: AssetBalanceResult } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const accountKey = JSON.stringify([connection.status, wallet.address, wallet.network, usdtAccount])
  const nim = currentNimBalance(wallet, connection)
  const usdt = usdtResult?.key === accountKey ? usdtResult.balance : unavailableUsdt
  const nimQuote = quotes?.key === accountKey ? quotes.NIM : unavailableQuote
  const usdtQuote = quotes?.key === accountKey ? quotes.USDT : unavailableQuote

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    const readQuote = (asset: AccountAsset, network: string) => sources.getNgnQuote(asset, network, controller.signal).catch((): NgnQuoteResult => ({ status: 'unavailable' }))
    // Currency data sources are independent; a future USDT failure must not suppress NIM's quote.
    void readQuote('NIM', wallet.network).then((NIM) => {
      if (active) setQuotes((previous) => ({ key: accountKey, NIM, USDT: previous?.key === accountKey ? previous.USDT : unavailableQuote }))
    })
    void sources.readUsdtBalance(usdtAccount, controller.signal).then(async (balance) => {
      const validBalance = balance.asset === 'USDT' ? balance : unavailableUsdt
      if (active) setUsdtResult({ key: accountKey, balance: validBalance })
      const USDT = validBalance.status === 'available' ? await readQuote('USDT', validBalance.network) : unavailableQuote
      if (active) setQuotes((previous) => ({ key: accountKey, NIM: previous?.key === accountKey ? previous.NIM : unavailableQuote, USDT }))
    }).catch(() => {
      if (active) setUsdtResult({ key: accountKey, balance: { status: 'error', asset: 'USDT', error: 'Balance unavailable' } })
    })
    return () => { active = false; controller.abort() }
  }, [accountKey, sources, usdtAccount, wallet.network])

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
        const quote = asset === 'NIM' ? nimQuote : usdtQuote
        const estimate = estimateNgn(balance, quote, now)
        const selected = selectedAsset === asset
        return (
          <article key={asset} className={`account-card munus-card ${asset === 'NIM' ? 'munus-card-elevated' : ''} account-card--${asset.toLowerCase()} ${selected ? 'account-card--front' : 'account-card--rear'}`}>
            <button className="account-card-select" type="button" aria-label={`View ${asset} account`} aria-pressed={selected} onClick={() => setSelectedAsset(asset)}>
              <span>{asset}</span><span aria-hidden="true">{selected ? '●' : '↑'}</span>
            </button>
            <div className="account-card-details" aria-hidden={!selected}>
              {asset === 'NIM' ? (
                <NimFundingCard view={buildNimFundingView({
                  balance: nim,
                  estimateNgn: estimate,
                  connectionReady: connection.status === 'ready',
                  walletNetwork: wallet.network,
                  hideAmounts: hideBalances,
                  fallbackNetwork,
                })} />
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
