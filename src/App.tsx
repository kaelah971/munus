import { useState } from 'react'
import {
  BrandLockup,
  EmptyState,
  HighlightCard,
  Icon,
  IconBadge,
  ListRow,
  PrimaryButton,
  QuietButton,
  SectionHeading,
  StatusPill,
  TopBar,
  type IconName,
} from './components/Primitives'
import {
  shortenNimiqAccount,
  type NimiqConnectionState,
} from './integration/nimiq'
import {
  ESSENTIAL_CATEGORIES,
  type EssentialCategoryId,
} from './domain/payment'
import { useNimiq } from './hooks/useNimiq'

type AppScreen = 'home' | 'essentials'

const ONBOARDING_STORAGE_KEY = 'munus:onboarding-complete'

const categoryIcons: Record<EssentialCategoryId, IconName> = {
  airtime: 'phone',
  data: 'data',
  electricity: 'bolt',
  'cable-internet': 'wifi',
}

function readOnboardingState(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    return window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function saveOnboardingState() {
  try {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, 'true')
  } catch {
    // Private browsing can disable local storage. The in-memory state still works.
  }
}

function ConnectionPill({ state }: { state: NimiqConnectionState }) {
  if (state.status === 'initializing') {
    return <StatusPill label="Connecting" />
  }

  if (state.status === 'ready') {
    return (
      <StatusPill
        label={state.accounts.length > 0 ? 'Nimiq Pay connected' : 'Nimiq Pay ready'}
        tone="ready"
      />
    )
  }

  if (state.status === 'error') {
    return <StatusPill label="Needs attention" tone="attention" />
  }

  return <StatusPill label="Browser preview" tone="attention" />
}

function ConnectionCard({
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
        <p className="connection-copy">
          Checking for an injected Nimiq Pay connection. You can keep browsing while Munus checks.
        </p>
      ) : null}

      {state.status === 'ready' && account ? (
        <div className="account-display">
          <span>Account shared with Munus</span>
          <code title={account}>{shortenNimiqAccount(account)}</code>
        </div>
      ) : null}

      {state.status === 'ready' && !account ? (
        <p className="connection-copy">
          Nimiq Pay is available, but no account has been shared with Munus yet.
        </p>
      ) : null}

      {state.status === 'unavailable' ? (
        <p className="connection-copy">
          This is a browser preview. Open Munus inside Nimiq Pay to connect an account; no wallet
          address is shown here.
        </p>
      ) : null}

      {state.status === 'error' ? (
        <p className="connection-copy">
          Munus could not read the Nimiq Pay connection. No payment was attempted.
        </p>
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

function OnboardingScreen({ onComplete }: { onComplete: () => void }) {
  return (
    <div className="app-shell">
      <main className="app-frame onboarding-screen">
        <div className="onboarding-topbar">
          <BrandLockup />
          <StatusPill label="NIM first" tone="ready" />
        </div>

        <div className="onboarding-content">
          <div className="onboarding-mark" aria-hidden="true">
            <span>M</span>
          </div>
          <p className="eyebrow">Everyday essentials, made deliberate</p>
          <h1>Put NIM to work in everyday life.</h1>
          <p className="onboarding-lede">
            Munus helps you plan, pay, and prove the essentials you choose to handle.
          </p>

          <div className="principles-card">
            <div className="principle-row">
              <span className="principle-number">01</span>
              <div>
                <strong>Plan it.</strong>
                <span>See what needs handling.</span>
              </div>
            </div>
            <div className="principle-row">
              <span className="principle-number">02</span>
              <div>
                <strong>Pay it.</strong>
                <span>Use NIM when a flow is live.</span>
              </div>
            </div>
            <div className="principle-row">
              <span className="principle-number">03</span>
              <div>
                <strong>Prove it.</strong>
                <span>Keep a clear record.</span>
              </div>
            </div>
          </div>

          <PrimaryButton onClick={onComplete}>
            Open Munus
            <Icon name="arrow" size={19} />
          </PrimaryButton>
          <p className="onboarding-footnote">
            Built for Nimiq Pay. Browser preview works without a wallet.
          </p>
        </div>
      </main>
    </div>
  )
}

function HomeScreen({
  connection,
  onRetry,
  onPayEssentials,
  onNavigate,
}: {
  connection: NimiqConnectionState
  onRetry: () => void
  onPayEssentials: () => void
  onNavigate: (screen: AppScreen) => void
}) {
  return (
    <div className="app-shell">
      <div className="app-frame">
        <TopBar connection={<ConnectionPill state={connection} />} />

        <main className="screen-content" aria-labelledby="home-title">
          <section className="hero-block">
            <p className="eyebrow">Put NIM to work in everyday life.</p>
            <h1 id="home-title">What do you need to handle today?</h1>
            <p className="hero-lede">
              A calm starting point for the essentials that matter now.
            </p>
            <PrimaryButton onClick={onPayEssentials}>
              Pay an essential
              <Icon name="arrow" size={19} />
            </PrimaryButton>
          </section>

          <HighlightCard
            description="Munus keeps the path clear: choose an essential, use NIM when the payment flow is ready, and keep the proof close."
            eyebrow="The Munus way"
            icon="spark"
            title="Plan it. Pay it. Prove it."
          />

          <ConnectionCard onRetry={onRetry} state={connection} />

          <div className="home-sections">
            <section>
              <SectionHeading>Due soon</SectionHeading>
              <EmptyState
                description="Nothing is scheduled yet. Upcoming essentials will appear here."
                icon="calendar"
                title="Your schedule is clear"
              />
            </section>

            <section>
              <SectionHeading>Life Pockets</SectionHeading>
              <EmptyState
                description="A quiet place for recurring essentials. This is not live in the foundation preview."
                icon="pocket"
                title="Pockets are waiting"
              />
            </section>

            <section>
              <SectionHeading>Recent receipts</SectionHeading>
              <EmptyState
                description="Completed payments will appear here once the payment flow is live."
                icon="receipt"
                title="No receipts yet"
              />
            </section>

            <section>
              <SectionHeading>Needs review</SectionHeading>
              <EmptyState
                description="No items have been added for review."
                icon="review"
                title="Nothing needs your attention"
              />
            </section>
          </div>
        </main>

        <BottomNav onNavigate={onNavigate} screen="home" />
      </div>
    </div>
  )
}

function EssentialsScreen({
  connection,
  onNavigate,
}: {
  connection: NimiqConnectionState
  onNavigate: (screen: AppScreen) => void
}) {
  return (
    <div className="app-shell">
      <div className="app-frame">
        <TopBar
          connection={<ConnectionPill state={connection} />}
          onBack={() => onNavigate('home')}
        />

        <main className="screen-content" aria-labelledby="essentials-title">
          <section className="screen-intro">
            <p className="eyebrow">Everyday essentials</p>
            <h1 id="essentials-title">Pay Essentials</h1>
            <p>
              Choose a category to see what Munus is preparing. Nothing here sends NIM or connects
              to a provider yet.
            </p>
          </section>

          <section aria-label="Essential categories" className="category-list">
            {ESSENTIAL_CATEGORIES.map((category) => (
              <ListRow
                description={category.description}
                disabled
                icon={categoryIcons[category.id]}
                key={category.id}
                meta={
                  <StatusPill
                    label={category.availability === 'next' ? 'Coming next' : 'Not live'}
                  />
                }
                title={category.name}
              />
            ))}
          </section>

          <div className="truth-note" role="note">
            <IconBadge icon="info" />
            <p>
              Airtime and data are planned for the next payment slice. Electricity and cable/internet
              are not available in this preview.
            </p>
          </div>
        </main>

        <BottomNav onNavigate={onNavigate} screen="essentials" />
      </div>
    </div>
  )
}

function BottomNav({
  screen,
  onNavigate,
}: {
  screen: AppScreen
  onNavigate: (screen: AppScreen) => void
}) {
  return (
    <nav aria-label="Primary navigation" className="bottom-nav">
      <button
        aria-current={screen === 'home' ? 'page' : undefined}
        className={screen === 'home' ? 'bottom-nav-item bottom-nav-item--active' : 'bottom-nav-item'}
        onClick={() => onNavigate('home')}
        type="button"
      >
        <Icon name="home" size={19} />
        <span>Home</span>
      </button>
      <button
        aria-current={screen === 'essentials' ? 'page' : undefined}
        className={
          screen === 'essentials'
            ? 'bottom-nav-item bottom-nav-item--active'
            : 'bottom-nav-item'
        }
        onClick={() => onNavigate('essentials')}
        type="button"
      >
        <Icon name="wallet" size={19} />
        <span>Pay Essentials</span>
      </button>
    </nav>
  )
}

export function App() {
  const [onboardingComplete, setOnboardingComplete] = useState(readOnboardingState)
  const [screen, setScreen] = useState<AppScreen>('home')
  const { state: connection, retry } = useNimiq()

  if (!onboardingComplete) {
    return (
      <OnboardingScreen
        onComplete={() => {
          saveOnboardingState()
          setOnboardingComplete(true)
        }}
      />
    )
  }

  if (screen === 'essentials') {
    return <EssentialsScreen connection={connection} onNavigate={setScreen} />
  }

  return (
    <HomeScreen
      connection={connection}
      onNavigate={setScreen}
      onPayEssentials={() => setScreen('essentials')}
      onRetry={retry}
    />
  )
}
