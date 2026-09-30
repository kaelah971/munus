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
import {
  calculatePocketProgress,
  formatPlanningAmount,
  isDueSoon,
  type Pocket,
  type Reminder,
} from '../domain/planning'
import type { AppDestination } from '../navigation'
import type { NimiqConnectionState, NimiqWalletState } from '../integration/nimiq'

export function HomePage({
  connection,
  wallet,
  session,
  profile,
  authBusy,
  authError,
  planningLoading,
  pockets,
  reminders,
  supportRequests,
  supportDrafts,
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
  planningLoading: boolean
  pockets: Pocket[]
  reminders: Reminder[]
  supportRequests: { id: string; requestedProduct: string; status: string }[]
  supportDrafts: { id: string; recipientName: string; status: string }[]
  onNavigate: (destination: AppDestination) => void
  onProfile: () => void
  onRetryConnection: () => void
  onSignIn: () => void
  onCopyAddress: () => void
}) {
  const pendingSupportRequest = supportRequests.find((request) => request.status === 'pending')
  const draftSupport = supportDrafts.find((draft) => draft.status === 'draft')
  const greeting = profile ? `Good to see you, ${profile.displayName}.` : 'Your everyday money, in one place.'
  const activePockets = pockets.filter((pocket) => pocket.status !== 'archived').slice(0, 3)
  const dueSoonReminder = reminders.find((reminder) => reminder.status === 'open' && isDueSoon(reminder.dueAt))
  const dueSoonPocket = pockets.find((pocket) => pocket.deadline && isDueSoon(pocket.deadline) && pocket.status !== 'archived')

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
              <button className="quick-action" onClick={() => onNavigate('support')} type="button"><Icon name="info" size={19} /><span>Support</span></button>
              <button className="quick-action" onClick={() => onNavigate('request')} type="button"><Icon name="arrow" size={19} /><span>Request</span></button>
            </div>
          </section>

          <HighlightCard
            description="A calm account of your wallet, profile, and the things you choose to handle next."
            eyebrow="Your Munus context"
            icon="spark"
            title="Plan with the full picture."
          />

          {connection.status !== 'ready' ? <ConnectionCard onRetry={onRetryConnection} state={connection} /> : null}

          <div className="home-sections">
            <section>
              <div className="section-heading-row"><SectionHeading>Due soon</SectionHeading>{dueSoonReminder || dueSoonPocket ? <button className="section-link" type="button" onClick={() => onNavigate('pockets')}>View plans</button> : null}</div>
              {planningLoading ? <p className="section-copy">Checking your plans…</p> : dueSoonReminder ? <button className="home-planning-row" type="button" onClick={() => onNavigate('pockets')}><Icon name="calendar" size={18} /><span><strong>{dueSoonReminder.title}</strong><small>Due {formatDate(dueSoonReminder.dueAt)}</small></span></button> : dueSoonPocket ? <button className="home-planning-row" type="button" onClick={() => onNavigate('pockets')}><Icon name="pocket" size={18} /><span><strong>{dueSoonPocket.name}</strong><small>Target due {formatDate(dueSoonPocket.deadline ?? '')}</small></span></button> : <EmptyState description="Nothing is scheduled yet. Upcoming essentials will appear here." icon="calendar" title="Your schedule is clear" />}
            </section>
            <section>
              <div className="section-heading-row"><SectionHeading>Life Pockets</SectionHeading>{pockets.length ? <button className="section-link" type="button" onClick={() => onNavigate('pockets')}>See all</button> : null}</div>
              {planningLoading ? <p className="section-copy">Loading your planning context…</p> : activePockets.length ? <div className="home-pocket-list">{activePockets.map((pocket) => <HomePocketRow key={pocket.id} pocket={pocket} onClick={() => onNavigate('pockets')} />)}</div> : <EmptyState description="Give an upcoming need a place to grow. Nothing is reserved or moved." icon="pocket" title="Start a Life Pocket" />}
            </section>
            <section><SectionHeading>Support context</SectionHeading>{pendingSupportRequest ? <button className="home-planning-row" type="button" onClick={() => onNavigate('request')}><Icon name="arrow" size={18} /><span><strong>{pendingSupportRequest.requestedProduct}</strong><small>Request waiting for your review</small></span></button> : draftSupport ? <button className="home-planning-row" type="button" onClick={() => onNavigate('support')}><Icon name="info" size={18} /><span><strong>Support draft for {draftSupport.recipientName}</strong><small>Review before any payment</small></span></button> : <EmptyState description="Prepare a specific support draft or request help from someone you trust." icon="info" title="Support is ready when you are" />}</section>
            <section><SectionHeading>Recent activity</SectionHeading><EmptyState description="Wallet activity will appear here when there is activity to review." icon="receipt" title="No activity yet" /></section>
            <section><SectionHeading>Needs review</SectionHeading><EmptyState description="No items have been added for review." icon="review" title="Nothing needs your attention" /></section>
          </div>
        </main>
        <BottomNav destination="home" onNavigate={onNavigate} />
      </div>
    </div>
  )
}

function HomePocketRow({ pocket, onClick }: { pocket: Pocket; onClick: () => void }) {
  const progress = calculatePocketProgress(pocket.targetAmount, pocket.plannedAmount)
  return <button className="home-pocket-row" type="button" onClick={onClick}><span><strong>{pocket.name}</strong><small>{formatPlanningAmount(pocket.plannedAmount, pocket.unit)} of {formatPlanningAmount(pocket.targetAmount, pocket.unit)}</small></span><span className="home-pocket-progress"><span className="progress-track"><span style={{ width: `${progress}%` }} /></span><small>{Math.round(progress)}%</small></span></button>
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'date not set' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
