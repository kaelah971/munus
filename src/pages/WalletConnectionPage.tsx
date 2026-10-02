import { Icon, PrimaryButton } from '../components/Primitives'
import type { NimiqConnectionState } from '../integration/nimiq'

export function WalletConnectionPage({ connection, authenticated, busy, saving, error, onConnect, onRetryConnection, onBack }: {
  connection: NimiqConnectionState
  authenticated: boolean
  busy: boolean
  saving: boolean
  error: string | null
  onConnect: () => void
  onRetryConnection: () => void
  onBack: () => void
}) {
  const available = connection.status === 'ready'
  return <main className="setup-screen" aria-labelledby="connect-title">
    <button className="icon-button setup-back" aria-label="Back to name" type="button" disabled={busy} onClick={onBack}><Icon name="back" /></button>
    <div className="setup-body">
      <span className="setup-symbol" aria-hidden="true"><Icon name="wallet" size={28} /></span>
      <h1 id="connect-title">Connect your wallet</h1>
      <p className="setup-lede">Continue with Nimiq Pay to save your name and open Munus.</p>
      <div className="connection-feedback" aria-live="polite">
        {!authenticated && connection.status === 'initializing' && <p>Initializing Nimiq Pay…</p>}
        {!authenticated && connection.status === 'unavailable' && <p>Open inside Nimiq Pay to connect your wallet</p>}
        {!authenticated && connection.status === 'error' && <p>{connection.error ?? 'Nimiq Pay could not connect.'}</p>}
        {!authenticated && connection.status === 'ready' && <p>{connection.accounts.length > 0 ? 'An account is available to Munus.' : 'Tap connect to share an account from Nimiq Pay.'}</p>}
        {busy && <p>{saving ? 'Saving your profile…' : 'Waiting for Nimiq Pay…'}</p>}
      </div>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <PrimaryButton disabled={busy || (!authenticated && !available)} onClick={onConnect}>
        {busy ? (saving ? 'Saving your profile…' : 'Connecting…') : authenticated ? 'Save and open Munus' : 'Connect with Nimiq Pay'}
      </PrimaryButton>
      {!authenticated && (connection.status === 'error' || connection.status === 'unavailable') && <button className="quiet-button" type="button" onClick={onRetryConnection}>Check Nimiq Pay again</button>}
      <p className="setup-reassurance">Signing in does not move your money.</p>
    </div>
  </main>
}
