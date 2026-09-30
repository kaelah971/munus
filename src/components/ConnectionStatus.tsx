import { Icon, IconBadge, QuietButton, StatusPill } from './Primitives'
import type { NimiqConnectionState } from '../integration/nimiq'

export function ConnectionPill({ state }: { state: NimiqConnectionState }) {
  if (state.status === 'initializing') return <StatusPill label="Connecting" />
  if (state.status === 'ready') {
    return (
      <StatusPill
        label={state.accounts.length > 0 ? 'Nimiq Pay connected' : 'Nimiq Pay ready'}
        tone="ready"
      />
    )
  }
  if (state.status === 'error') return <StatusPill label="Needs attention" tone="attention" />
  return <StatusPill label="Browser preview" tone="attention" />
}

export function ConnectionCard({
  state,
  onRetry,
}: {
  state: NimiqConnectionState
  onRetry: () => void
}) {
  const account = state.accounts[0]

  return (
    <section aria-live="polite" className="connection-card">
      <div className="connection-card-header">
        <div className="connection-card-title">
          <IconBadge icon="wallet" tone="ready" />
          <div>
            <p className="card-eyebrow">Wallet connection</p>
            <h2>Nimiq Pay</h2>
          </div>
        </div>
        <ConnectionPill state={state} />
      </div>

      {state.status === 'initializing' ? (
        <p className="connection-copy">Checking the Nimiq Pay wallet session.</p>
      ) : null}
      {state.status === 'ready' && account ? (
        <p className="connection-copy">An account is available to Munus for wallet state.</p>
      ) : null}
      {state.status === 'ready' && !account ? (
        <p className="connection-copy">
          Nimiq Pay is available, but no account has been shared with Munus yet.
        </p>
      ) : null}
      {state.status === 'unavailable' ? (
        <p className="connection-copy">
          This browser preview cannot authenticate a Munus account or read a wallet balance.
        </p>
      ) : null}
      {state.status === 'error' ? (
        <p className="connection-copy">Munus could not read the Nimiq Pay connection.</p>
      ) : null}

      {state.status === 'unavailable' || state.status === 'error' ? (
        <QuietButton onClick={onRetry}>
          <Icon name="refresh" size={17} />
          Check again
        </QuietButton>
      ) : null}
    </section>
  )
}
