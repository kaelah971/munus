import { useState } from 'react'
import { ProfileForm } from '../components/ProfileForm'
import { BottomNav } from '../components/BottomNav'
import { ConnectionPill } from '../components/ConnectionStatus'
import { ProfileAvatar } from '../components/ProfileAvatar'
import { Icon, QuietButton, SectionHeading, StatusPill, TopBar } from '../components/Primitives'
import { profileToDraft, type MunusProfile, type ProfileDraft } from '../domain/profile'
import type { MunusSession } from '../domain/auth'
import type { AppDestination } from '../navigation'
import { shortenNimiqAccount, type NimiqConnectionState } from '../integration/nimiq'
import type { PinRecord } from '../security/appLock'

export function ProfilePage({
  connection,
  session,
  profile,
  pinRecord,
  authBusy = false,
  authError,
  onNavigate,
  onSignIn,
  onSignOut,
  onSave,
  onSavePin,
  onRemovePin,
}: {
  connection: NimiqConnectionState
  session: MunusSession | null
  authBusy?: boolean
  authError?: string | null
  profile: MunusProfile | null
  pinRecord: PinRecord | null
  onNavigate: (destination: AppDestination) => void
  onSignIn: () => void
  onSignOut: () => void
  onSave: (draft: ProfileDraft) => Promise<void> | void
  onSavePin: (pin: string) => Promise<void>
  onRemovePin: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [pinSetup, setPinSetup] = useState(false)
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [pinError, setPinError] = useState<string | null>(null)

  async function savePin() {
    if (!/^\d{6}$/.test(pin) || pin !== confirmPin) {
      setPinError('Enter the same 6-digit PIN twice.')
      return
    }
    setPinError(null)
    try {
      await onSavePin(pin)
      setPin('')
      setConfirmPin('')
      setPinSetup(false)
    } catch (error) {
      setPinError(error instanceof Error ? error.message : 'PIN could not be saved.')
    }
  }

  return (
    <div className="app-shell">
      <div className="app-frame">
        <TopBar connection={<ConnectionPill state={connection} />} />
        <main className="screen-content profile-page" aria-labelledby="profile-title">
          <section className="profile-heading">
            <ProfileAvatar name={profile?.displayName} />
            <div><p className="eyebrow">Your Munus account</p><h1 id="profile-title">Profile & settings</h1></div>
          </section>

          {!session ? (
            <section className="profile-connect-card">
              <h2>Connect your Munus account</h2>
              <p>Sign a one-time challenge with Nimiq Pay to save a profile. This never moves NIM.</p>
              {authError ? <p className="inline-error" role="alert">{authError}</p> : null}
              <QuietButton disabled={authBusy || connection.status !== 'ready' || connection.accounts.length === 0} onClick={onSignIn}>{authBusy ? 'Connecting…' : 'Connect with Nimiq Pay'}</QuietButton>
            </section>
          ) : null}

          {session && profile ? (
            <>
              <section className="profile-summary-card">
                <ProfileAvatar name={profile.displayName} />
                <div><h2>{profile.displayName}</h2><p>{profile.country} · {profile.localCurrency} · {profile.preferredPaymentAsset}</p></div>
                <StatusPill label={session.trust === 'server-verified' ? 'Verified' : 'Development'} tone={session.trust === 'server-verified' ? 'ready' : 'attention'} />
              </section>

              {editing ? (
                <section className="profile-section"><SectionHeading>Edit profile</SectionHeading><ProfileForm initialDraft={profileToDraft(profile)} onCancel={() => setEditing(false)} onSubmit={async (draft) => { await onSave(draft); setEditing(false) }} submitLabel="Save changes" /></section>
              ) : (
                <section className="profile-section">
                  <div className="section-heading-row"><SectionHeading>Personal details</SectionHeading><QuietButton onClick={() => setEditing(true)}>Edit</QuietButton></div>
                  <div className="settings-list">
                    <SettingRow label="Country" value={`${profile.country} · ${profile.localCurrency}`} />
                    <SettingRow label="Default phone" value={profile.defaultPhone ?? 'Not added'} />
                    <SettingRow label="Default network" value={profile.defaultNetwork ?? 'Choose when needed'} />
                    <SettingRow label="Preferred asset" value="NIM" />
                  </div>
                </section>
              )}

              <section className="profile-section"><SectionHeading>Wallet & privacy</SectionHeading><div className="settings-list"><SettingRow label="Connected address" value={shortenNimiqAccount(session.walletAddress)} mono /><SettingRow label="Privacy" value="Munus stores profile context, not wallet keys." /><SettingRow label="Notifications" value="Preferences boundary ready; delivery settings coming later." /></div></section>

              <section className="profile-section security-section">
                <div className="section-heading-row"><SectionHeading>Security</SectionHeading><Icon name="lock" size={18} /></div>
                <p className="section-copy">A Munus app lock protects personal data on this device. It never authorizes a NIM transaction.</p>
                {!pinRecord && !pinSetup ? <QuietButton onClick={() => setPinSetup(true)}>Set a 6-digit app PIN</QuietButton> : null}
                {pinRecord && !pinSetup ? <div className="security-enabled"><StatusPill label="App lock enabled" tone="ready" /><QuietButton onClick={onRemovePin}>Remove PIN</QuietButton></div> : null}
                {pinSetup ? <div className="pin-setup"><label><span>New 6-digit PIN</span><input inputMode="numeric" maxLength={6} onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))} type="password" value={pin} /></label><label><span>Confirm PIN</span><input inputMode="numeric" maxLength={6} onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, ''))} type="password" value={confirmPin} /></label>{pinError ? <p className="form-error" role="alert">{pinError}</p> : null}<div className="form-actions"><QuietButton onClick={() => setPinSetup(false)}>Cancel</QuietButton><QuietButton onClick={() => void savePin()}>Enable lock</QuietButton></div></div> : null}
              </section>

              <QuietButton className="profile-signout" onClick={onSignOut}>Sign out of Munus</QuietButton>
            </>
          ) : null}
        </main>
        <BottomNav destination="profile" onNavigate={onNavigate} />
      </div>
    </div>
  )
}

function SettingRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="setting-row"><span>{label}</span><strong className={mono ? 'setting-value-mono' : ''} title={value}>{value}</strong></div>
}
