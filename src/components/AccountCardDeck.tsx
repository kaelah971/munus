import { useEffect, useState } from 'react'
import {
  accountDataSources, estimateNgn, mapNimBalance,
  type AccountAsset, type AccountDataSources, type AssetBalanceResult,
  type NgnQuoteResult, type UsdtAccountContext,
} from '../domain/accountPresentation'
import type { NimiqConnectionState, NimiqWalletState } from '../integration/nimiq'

const unavailableQuote: NgnQuoteResult = { status: 'unavailable' }
const unavailableUsdt: AssetBalanceResult = { status: 'unavailable', asset: 'USDT' }

export function AccountCardDeck({ wallet, connection, hideBalances, sources = accountDataSources, usdtAccount }: {
  wallet: NimiqWalletState
  connection: NimiqConnectionState
  hideBalances: boolean
  sources?: AccountDataSources
  usdtAccount?: UsdtAccountContext
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
              <p className="account-card-balance">{hideBalances ? '••••' : balance.status === 'available' ? balance.amount : '—'} {asset}</p>
              <p className="account-card-estimate">{hideBalances ? 'NGN estimate hidden' : estimate !== null ? `≈ ₦${estimate}` : 'NGN estimate unavailable'}</p>
              <div className="account-card-meta">
                <span>{balance.status === 'loading' ? 'Loading balance' : balance.status === 'available' ? asset === 'NIM' ? connectionLabel(connection) : 'Balance available' : 'Balance unavailable'}</span>
                <span>{balance.status === 'available' ? networkLabel(balance.network) : asset === 'NIM' ? networkLabel(wallet.network) : 'USDT'}</span>
              </div>
              {balance.status === 'available' && balance.accountReference ? <p className="account-card-reference">{maskAccount(balance.accountReference)}</p> : null}
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

function connectionLabel(connection: NimiqConnectionState): string {
  return connection.status === 'ready' ? 'Connected to Nimiq Pay' : 'Wallet unavailable'
}

function networkLabel(network: string): string {
  if (network === 'mainnet') return 'Mainnet'
  if (network === 'testnet') return 'Testnet'
  if (network === 'unknown') return 'Network unavailable'
  return network
}

function maskAccount(address: string): string {
  const compact = address.replace(/\s+/g, '')
  return compact.length > 10 ? `${compact.slice(0, 4)} •••• ${compact.slice(-4)}` : '••••'
}
