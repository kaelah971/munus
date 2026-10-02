import { shortenNimiqAccount, type NimiqConnectionState, type NimiqWalletState } from '../integration/nimiq'
import type { MunusSession } from '../domain/auth'
import { Icon, IconBadge, QuietButton, StatusPill } from './Primitives'

export function WalletCard({
  connection,
  wallet,
  session,
  onCopyAddress,
  onSignIn,
  authBusy = false,
}: {
  connection: NimiqConnectionState
  wallet: NimiqWalletState
  session: MunusSession | null
  onCopyAddress: () => void
  onSignIn: () => void
  authBusy?: boolean
}) {
  const canSignIn = connection.status === 'ready' && connection.accounts.length > 0
  const networkLabel = wallet.network === 'unknown' ? 'Network not reported' : wallet.network

  return (
    <section className="wallet-card munus-card-elevated">
      <div className="wallet-card-topline">
        <div>
          <p className="card-eyebrow">Wallet balance</p>
          <h2>Available NIM</h2>
        </div>
        <IconBadge icon="wallet" tone="ready" />
      </div>

      <div className="wallet-balance-line">
        <strong>
          {wallet.status === 'available' || wallet.status === 'zero' ? wallet.nimBalance : '—'}
        </strong>
        <span>NIM</span>
      </div>

      <div className="wallet-status-row">
        <StatusPill label={walletStatusLabel(wallet)} tone={wallet.status === 'error' ? 'attention' : 'quiet'} />
        <span className="wallet-network">{networkLabel}</span>
      </div>

      <div className="wallet-address-row">
        <div>
          <span className="wallet-label">Connected address</span>
          <code title={wallet.address}>{wallet.address ? shortenNimiqAccount(wallet.address) : 'Not available'}</code>
        </div>
        {wallet.address ? (
          <QuietButton aria-label="Copy wallet address" onClick={onCopyAddress}>
            <Icon name="check" size={16} />
            Copy
          </QuietButton>
        ) : null}
      </div>

      {!session ? (
        <div className="wallet-auth-row">
          <div>
            <strong>Set up your Munus account</strong>
            <p>
              {canSignIn
                ? 'Sign a one-time login challenge. This never moves NIM.'
                : 'Open Munus in Nimiq Pay to connect your wallet.'}
            </p>
          </div>
          <QuietButton disabled={!canSignIn || authBusy} onClick={onSignIn}>
            {authBusy ? 'Signing…' : 'Connect'}
          </QuietButton>
        </div>
      ) : (
        <div className="wallet-auth-row wallet-auth-row--connected">
          <div>
            <strong>Munus account connected</strong>
            <p>
              {session.trust === 'server-verified'
                ? 'Session verified by the Munus auth boundary.'
                : 'Local development session; production signature verification is not enabled.'}
            </p>
          </div>
          <StatusPill
            label={session.trust === 'server-verified' ? 'Verified' : 'Development'}
            tone={session.trust === 'server-verified' ? 'ready' : 'attention'}
          />
        </div>
      )}
    </section>
  )
}

function walletStatusLabel(wallet: NimiqWalletState): string {
  switch (wallet.status) {
    case 'loading':
      return 'Loading balance'
    case 'available':
      return 'Balance available'
    case 'zero':
      return 'Zero balance'
    case 'error':
      return 'Balance unavailable'
    default:
      return 'Wallet unavailable'
  }
}
