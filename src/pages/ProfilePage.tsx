import { useState } from 'react'
import { ProfileForm } from '../components/ProfileForm'
import { ProfileAvatar } from '../components/ProfileAvatar'
import { Icon, QuietButton, StatusPill } from '../components/Primitives'
import { profileToDraft, type MunusProfile, type ProfileDraft } from '../domain/profile'
import type { MunusSession } from '../domain/auth'
import type { AppDestination } from '../navigation'
import { shortenNimiqAccount, type NimiqConnectionState, type NimiqWalletState } from '../integration/nimiq'
import type { PinRecord } from '../security/appLock'

export function ProfilePage({
  connection, session, profile, pinRecord, authBusy = false, authError,
  onNavigate, onSignIn, onSignOut, onSave, onSavePin, onRemovePin,
  hideBalances = false, onToggleBalances, onOpenContacts, onCopyAddress, wallet,
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
  hideBalances?: boolean
  onToggleBalances?: () => void
  onOpenContacts?: () => void
  onCopyAddress?: () => void
  wallet?: NimiqWalletState
}) {
  const [editing, setEditing] = useState(false)
  const [pinSetup, setPinSetup] = useState(false)
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [pinError, setPinError] = useState<string | null>(null)
  const [pinBusy, setPinBusy] = useState(false)

  async function savePin() {
    if (!/^\d{6}$/.test(pin) || pin !== confirmPin) {
      setPinError('Enter the same 6-digit PIN twice.')
      return
    }
    setPinError(null)
    setPinBusy(true)
    try {
      await onSavePin(pin)
      setPin('')
      setConfirmPin('')
      setPinSetup(false)
    } catch (error) {
      setPinError(error instanceof Error ? error.message : 'PIN could not be saved.')
    } finally {
      setPinBusy(false)
    }
  }

  const network = wallet?.network && wallet.network !== 'unknown' ? wallet.network : session?.network
  const networkLabel = network === 'mainnet' ? 'Mainnet' : network === 'testnet' ? 'Testnet' : 'Network unavailable'

  return (
    <section className="profile-page" aria-label="Profile settings">
      <h1>Profile &amp; settings</h1>
      {session && authError ? <p className="inline-error" role="alert">{authError}</p> : null}
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
          <section className="profile-settings-group" aria-labelledby="settings-identity">
            <h2 className="settings-group-title" id="settings-identity">Identity</h2>
            <div className="profile-identity-row">
              <ProfileAvatar name={profile.displayName} />
              <div><h3>{profile.displayName}</h3><p>{profile.country} · {profile.localCurrency}</p></div>
            </div>
            {editing ? (
              <ProfileForm initialDraft={profileToDraft(profile)} onCancel={() => setEditing(false)} onSubmit={async (draft) => { await onSave(draft); setEditing(false) }} submitLabel="Save changes" />
            ) : <QuietButton className="settings-action-row" onClick={() => setEditing(true)}><Icon name="user" size={18} /><span>Edit profile</span><Icon name="arrow" size={18} /></QuietButton>}
          </section>

          <section className="profile-settings-group" aria-labelledby="settings-app">
            <h2 className="settings-group-title" id="settings-app">App settings</h2>
            <div className="settings-list">
              <button aria-checked={hideBalances} className="settings-action-row balance-visibility-toggle" disabled={!onToggleBalances} onClick={onToggleBalances} role="switch" type="button">
                <Icon name="wallet" size={18} /><span>Hide balances</span><span aria-hidden="true" className={`settings-switch${hideBalances ? ' settings-switch--on' : ''}`}><span /></span>
              </button>
              <div className="settings-app-lock">
                <div className="settings-lock-heading"><Icon name="lock" size={18} /><h3>App lock</h3></div>
                <p className="section-copy">Protect your Munus data on this device with a PIN. Payments still need approval in Nimiq Pay.</p>
                {!pinRecord && !pinSetup ? <QuietButton className="settings-action-row" onClick={() => setPinSetup(true)}>Set a 6-digit app PIN</QuietButton> : null}
                {pinRecord && !pinSetup ? <div className="security-enabled"><StatusPill label="App lock enabled" tone="ready" /><QuietButton onClick={onRemovePin}>Remove PIN</QuietButton></div> : null}
                {pinSetup ? (
                  <form className="pin-setup" onSubmit={(event) => { event.preventDefault(); void savePin() }}>
                    <label><span>New 6-digit PIN</span><input autoComplete="new-password" inputMode="numeric" maxLength={6} onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))} type="password" value={pin} /></label>
                    <label><span>Confirm PIN</span><input autoComplete="new-password" inputMode="numeric" maxLength={6} onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, ''))} type="password" value={confirmPin} /></label>
                    {pinError ? <p className="form-error" role="alert">{pinError}</p> : null}
                    <div className="form-actions"><QuietButton disabled={pinBusy} onClick={() => { setPinSetup(false); setPin(''); setConfirmPin(''); setPinError(null) }}>Cancel</QuietButton><QuietButton disabled={pinBusy} type="submit">{pinBusy ? 'Saving…' : 'Enable lock'}</QuietButton></div>
                  </form>
                ) : null}
              </div>
            </div>
          </section>

          <section className="profile-settings-group" aria-labelledby="settings-wallet">
            <h2 className="settings-group-title" id="settings-wallet">Wallet</h2>
            <div className="settings-list">
              <SettingRow label="Connected wallet" value={shortenNimiqAccount(session.walletAddress)} mono />
              <QuietButton className="settings-action-row" disabled={!onCopyAddress} onClick={onCopyAddress}><Icon name="wallet" size={18} /><span>Copy address</span><Icon name="arrow" size={18} /></QuietButton>
              <SettingRow label="Network" value={networkLabel} />
            </div>
            <p className="section-copy">Your wallet keys stay in Nimiq Pay. You approve every payment there.</p>
          </section>

          <section className="profile-settings-group" aria-labelledby="settings-people">
            <h2 className="settings-group-title" id="settings-people">People</h2>
            <QuietButton className="settings-action-row" onClick={onOpenContacts ?? (() => onNavigate('contacts'))}><Icon name="user" size={18} /><span>Saved contacts</span><Icon name="arrow" size={18} /></QuietButton>
          </section>

          <section className="profile-settings-group" aria-labelledby="settings-account">
            <h2 className="settings-group-title" id="settings-account">Account</h2>
            <QuietButton className="settings-action-row profile-signout" disabled={authBusy} onClick={onSignOut}>Sign out</QuietButton>
          </section>
        </>
      ) : null}
    </section>
  )
}

function SettingRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="setting-row"><span>{label}</span><strong className={mono ? 'setting-value-mono' : ''}>{value}</strong></div>
}
