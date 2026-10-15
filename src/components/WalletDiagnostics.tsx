import { useState } from 'react'
import { QuietButton } from './Primitives'
import type { HostAccountBalances } from '../persistence/paymentApi'
import type { NimiqConnectionState, NimiqWalletState } from '../integration/nimiq'

function suffix(address: string | undefined): string {
  if (!address) return '—'
  const compact = address.replace(/\s+/g, '')
  return compact.length >= 4 ? `…${compact.slice(-4)}` : '—'
}

type AccountsState =
  | { status: 'idle' }
  | { status: 'listing' }
  | { status: 'checking'; addresses: string[] }
  | { status: 'ready'; addresses: string[]; report: HostAccountBalances }
  | { status: 'failed'; message: string }

/**
 * Read-only wallet diagnostics for the operator. Shows only safe,
 * already-local facts: provider state, address suffixes, which address
 * spelling was used, the provider result discriminator, error
 * type/message/code, and network provenance. Never cookies, signatures,
 * keys, tokens, or full addresses. Authenticated Profile context only.
 */
export function WalletDiagnostics({ connection, wallet, sessionWallet, onListAccounts, onCheckBalances }: {
  connection: NimiqConnectionState
  wallet: NimiqWalletState
  sessionWallet?: string
  /**
   * Explicit-tap-only host account listing (may surface a wallet prompt
   * on some hosts — never called on mount). Wired to requestAccounts.
   */
  onListAccounts?: () => Promise<readonly string[]>
  /** Authenticated per-address RPC balances for host-exposed addresses. */
  onCheckBalances?: (addresses: string[]) => Promise<HostAccountBalances>
}) {
  const debug = wallet.debug
  const [accounts, setAccounts] = useState<AccountsState>({ status: 'idle' })
  const canCheck = onListAccounts !== undefined && onCheckBalances !== undefined

  async function checkHostAccounts() {
    if (!onListAccounts || !onCheckBalances) return
    setAccounts({ status: 'listing' })
    let listed: readonly string[]
    try {
      listed = await onListAccounts()
    } catch (error) {
      setAccounts({ status: 'failed', message: error instanceof Error ? error.message : 'Nimiq Pay did not share its accounts.' })
      return
    }
    const addresses = listed.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
    if (addresses.length === 0) {
      setAccounts({ status: 'failed', message: 'Nimiq Pay shared no accounts.' })
      return
    }
    setAccounts({ status: 'checking', addresses })
    try {
      const report = await onCheckBalances(addresses)
      setAccounts({ status: 'ready', addresses, report })
    } catch (error) {
      setAccounts({ status: 'failed', message: error instanceof Error ? error.message : 'Balance lookup failed.' })
    }
  }
  return (
    <section className="profile-settings-group" aria-labelledby="settings-diagnostics">
      <h2 className="settings-group-title" id="settings-diagnostics">Wallet diagnostics</h2>
      <div className="settings-list">
        <div className="setting-row"><span>Provider</span><strong>{connection.status === 'ready' ? 'Initialized' : connection.status}</strong></div>
        <div className="setting-row"><span>Session wallet</span><strong className="setting-value-mono">{suffix(sessionWallet)}</strong></div>
        <div className="setting-row"><span>Balance address source</span><strong>{debug?.addressSource ?? '—'}</strong></div>
        <div className="setting-row"><span>Balance method</span><strong className="setting-value-mono">{debug?.method ?? 'not attempted'}</strong></div>
        <div className="setting-row"><span>Balance result</span><strong>{debug ? `${debug.ok ? 'ok' : 'error'} · ${debug.balanceType}` : '—'}</strong></div>
        {debug && !debug.ok && debug.errorName ? (
          <div className="setting-row"><span>Provider error</span><strong>{[debug.errorName, debug.errorMessage, debug.errorCode !== undefined ? `code ${debug.errorCode}` : ''].filter(Boolean).join(' · ')}</strong></div>
        ) : null}
        {debug?.addressVariant && debug.addressVariant !== 'none' ? (
          <div className="setting-row"><span>Address spelling</span><strong>{debug.addressVariant}</strong></div>
        ) : null}
        <div className="setting-row"><span>Host network</span><strong>{debug?.hostNetworkPresent ? debug.hostNetwork ?? 'present' : 'Not injected by host'}</strong></div>
        <div className="setting-row"><span>Wallet network</span><strong>{wallet.network}</strong></div>
      </div>
      <p className="section-copy">Read-only: no prompts, no transactions. Share these lines with the operator when the balance fails.</p>
      {canCheck ? <HostAccountsBlock state={accounts} sessionWallet={sessionWallet} hostBalance={wallet.nimBalance} onCheck={checkHostAccounts} /> : null}
    </section>
  )
}

function HostAccountsBlock({ state, sessionWallet, hostBalance, onCheck }: {
  state: AccountsState
  sessionWallet?: string
  hostBalance?: string
  onCheck: () => void
}) {
  const sessionSuffix = suffix(sessionWallet)
  return (
    <div className="settings-list">
      {state.status === 'idle' ? (
        <QuietButton onClick={onCheck}>Check Nimiq Pay accounts</QuietButton>
      ) : null}
      {state.status === 'listing' ? <p className="section-copy" role="status">Reading Nimiq Pay accounts…</p> : null}
      {state.status === 'failed' ? <p className="inline-error" role="alert">{state.message}</p> : null}
      {state.status === 'failed' ? <QuietButton onClick={onCheck}>Try again</QuietButton> : null}
      {state.status === 'checking' || state.status === 'ready' ? (
        <>
          <div className="setting-row"><span>Host accounts</span><strong>{state.addresses.length}</strong></div>
          {state.status === 'checking' ? <p className="section-copy" role="status">Reading confirmed balances…</p> : null}
        </>
      ) : null}
      {state.status === 'ready' ? (
        <>
          {state.report.accounts.map((entry, index) => (
            <div className="setting-row" key={`${entry.suffix}-${index}`}>
              <span>{entry.suffix}{sessionSuffix !== '—' && entry.suffix === sessionSuffix ? ' · session signer' : ''}</span>
              <strong>{entry.ok && entry.balanceNim !== undefined ? `${entry.balanceNim} NIM` : `failed${entry.error ? ` · ${entry.error}` : ''}`}</strong>
            </div>
          ))}
          <div className="setting-row"><span>Aggregate exposed</span><strong>{state.report.okCount > 0 ? `${state.report.aggregateNim} NIM` : 'no readable account'}</strong></div>
          <div className="setting-row"><span>Host getBalance</span><strong>{hostBalance ?? 'failed'}</strong></div>
          <p className="section-copy">Suffixes only. Auth identity is unchanged: this decides display context, never who pays.</p>
        </>
      ) : null}
    </div>
  )
}
