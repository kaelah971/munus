import { useState } from 'react'
import { BottomNav } from '../components/BottomNav'
import { ConnectionCard, ConnectionPill } from '../components/ConnectionStatus'
import { ProfileAvatar } from '../components/ProfileAvatar'
import { WalletCard } from '../components/WalletCard'
import {
  EmptyState,
  HighlightCard,
  Icon,
  SectionHeading,
  TopBar,
} from '../components/Primitives'
import type { MunusSession } from '../domain/auth'
import type { MunusProfile } from '../domain/profile'
import type { AppDestination } from '../navigation'
import type { NimiqConnectionState, NimiqWalletState } from '../integration/nimiq'

export function HomePage({
  connection,
  wallet,
  session,
  profile,
  authBusy,
  authError,
  onNavigate,
  onProfile,
  onRetryConnection,
  onSignIn,
  onCopyAddress,
}: {
  connection: NimiqConnectionState
  wallet: NimiqWalletState
  session: MunusSession | null
  profile: MunusProfile | null
  authBusy: boolean
  authError: string | null
  onNavigate: (destination: AppDestination) => void
  onProfile: () => void
  onRetryConnection: () => void
  onSignIn: () => void
  onCopyAddress: () => void
}) {
  const [notice, setNotice] = useState<string | null>(null)
  const greeting = profile ? `Good to see you, ${profile.displayName}.` : 'Your everyday money, in one place.'

  return (
    <div className="app-shell">
      <div className="app-frame">
        <TopBar
          action={<ProfileAvatar name={profile?.displayName} onClick={onProfile} />}
          connection={<ConnectionPill state={connection} />}
        />
        <main className="screen-content" aria-labelledby="home-title">
          <section className="dashboard-hero">
            <p className="eyebrow">Munus dashboard</p>
            <h1 id="home-title">{greeting}</h1>
            <p>Put NIM to work in everyday life, with a clearer view of what matters.</p>
          </section>

          <WalletCard
            authBusy={authBusy}
            connection={connection}
            onCopyAddress={onCopyAddress}
            onSignIn={onSignIn}
            session={session}
            wallet={wallet}
          />

          {authError ? <p className="inline-error" role="alert">{authError}</p> : null}

          <section className="quick-actions-section">
            <SectionHeading>Quick actions</SectionHeading>
            <div className="quick-actions">
              <button className="quick-action" onClick={() => onNavigate('pay')} type="button"><Icon name="wallet" size={19} /><span>Pay</span></button>
              <button className="quick-action" onClick={() => onNavigate('pockets')} type="button"><Icon name="pocket" size={19} /><span>Save</span></button>
              <button className="quick-action" onClick={() => setNotice('Support will have a dedicated home here. Nothing has been opened yet.')} type="button"><Icon name="info" size={19} /><span>Support</span></button>
              <button className="quick-action" onClick={() => setNotice('Request links are not live yet. No request has been sent.')} type="button"><Icon name="arrow" size={19} /><span>Request</span></button>
            </div>
            {notice ? <p className="quick-action-notice" role="status">{notice}</p> : null}
          </section>

          <HighlightCard
            description="A calm account of your wallet, profile, and the things you choose to handle next."
            eyebrow="Your Munus context"
            icon="spark"
            title="Plan with the full picture."
          />

          {connection.status !== 'ready' ? <ConnectionCard onRetry={onRetryConnection} state={connection} /> : null}

          <div className="home-sections">
            <section><SectionHeading>Due soon</SectionHeading><EmptyState description="Nothing is scheduled yet. Upcoming essentials will appear here." icon="calendar" title="Your schedule is clear" /></section>
            <section><SectionHeading>Life Pockets</SectionHeading><EmptyState description="A quiet place for recurring essentials. Pockets are not live yet." icon="pocket" title="Pockets are waiting" /></section>
            <section><SectionHeading>Recent activity</SectionHeading><EmptyState description="Wallet activity will appear here when there is activity to review." icon="receipt" title="No activity yet" /></section>
            <section><SectionHeading>Needs review</SectionHeading><EmptyState description="No items have been added for review." icon="review" title="Nothing needs your attention" /></section>
          </div>
        </main>
        <BottomNav destination="home" onNavigate={onNavigate} />
      </div>
    </div>
  )
}
