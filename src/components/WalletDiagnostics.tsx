import type { NimiqConnectionState, NimiqWalletState } from '../integration/nimiq'

function suffix(address: string | undefined): string {
  if (!address) return '—'
  const compact = address.replace(/\s+/g, '')
  return compact.length >= 4 ? `…${compact.slice(-4)}` : '—'
}

/**
 * Read-only wallet diagnostics for the operator. Shows only safe,
 * already-local facts: provider state, address suffixes, which address
 * spelling was used, the provider result discriminator, error
 * type/message/code, and network provenance. Never cookies, signatures,
 * keys, tokens, or full addresses. Authenticated Profile context only.
 */
export function WalletDiagnostics({ connection, wallet, sessionWallet }: {
  connection: NimiqConnectionState
  wallet: NimiqWalletState
  sessionWallet?: string
}) {
  const debug = wallet.debug
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
    </section>
  )
}
