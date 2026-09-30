import { shortenNimiqAccount } from '../integration/nimiq'
import type { ProfileDraft } from '../domain/profile'
import { ProfileForm } from '../components/ProfileForm'
import { BrandLockup, QuietButton, StatusPill } from '../components/Primitives'

export function ProfileSetupPage({
  walletAddress,
  initialDraft,
  onSubmit,
  onSignOut,
}: {
  walletAddress: string
  initialDraft?: ProfileDraft
  onSubmit: (draft: ProfileDraft) => Promise<void> | void
  onSignOut: () => void
}) {
  return (
    <div className="app-shell">
      <main className="app-frame setup-screen">
        <header className="setup-header">
          <BrandLockup />
          <StatusPill label="Munus profile" tone="ready" />
        </header>
        <section className="setup-intro">
          <p className="eyebrow">One small setup</p>
          <h1>Make Munus yours.</h1>
          <p>
            Your profile lives above the wallet. Add only what helps Munus organize everyday money.
          </p>
          <div className="setup-wallet-row">
            <span>Connected Nimiq address</span>
            <code>{shortenNimiqAccount(walletAddress)}</code>
          </div>
        </section>
        <ProfileForm initialDraft={initialDraft} onSubmit={onSubmit} submitLabel="Create profile" />
        <QuietButton className="setup-signout" onClick={onSignOut}>Sign out</QuietButton>
      </main>
    </div>
  )
}
