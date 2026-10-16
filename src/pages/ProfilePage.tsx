import { useEffect, useState } from 'react'
import { ProfileForm } from '../components/ProfileForm'
import { ProfileAvatar } from '../components/ProfileAvatar'
import { Icon, QuietButton, StatusPill } from '../components/Primitives'
import { profileToDraft, type MunusProfile, type ProfileDraft } from '../domain/profile'
import type { MunusSession } from '../domain/auth'
import type { NimIndicativeRate, RailStatus, ReadinessReport } from '../persistence/paymentApi'
import type { AppDestination } from '../navigation'
import { shortenNimiqAccount, type NimiqConnectionState, type NimiqWalletState } from '../integration/nimiq'
import { WalletDiagnostics } from '../components/WalletDiagnostics'
import type { HostAccountBalances } from '../persistence/paymentApi'
import type { PinRecord } from '../security/appLock'

export function ProfilePage({
  connection, session, profile, pinRecord, authBusy = false, authError,
  onNavigate, onSignIn, onSignOut, onSave, onSavePin, onRemovePin,
  hideBalances = false, onToggleBalances, onOpenContacts, onCopyAddress, wallet,
  getReadiness, getNimRate, onListAccounts, onCheckBalances,
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
  /** Authenticated readiness loader. Same session cookie as every other API call. */
  getReadiness?: () => Promise<ReadinessReport>
  /** Authenticated indicative-rate loader for the diagnostics below. */
  getNimRate?: () => Promise<NimIndicativeRate>
  wallet?: NimiqWalletState
  /**
   * Explicit-tap-only host account listing plus authenticated per-address
   * balances for the diagnostics section. Never called on mount.
   */
  onListAccounts?: () => Promise<readonly string[]>
  onCheckBalances?: (addresses: string[]) => Promise<HostAccountBalances>
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

          {session && getReadiness ? <ReadinessSection load={getReadiness} /> : null}
          {session && getNimRate ? <RateDiagnosticsSection load={getNimRate} /> : null}
          {session && wallet ? <WalletDiagnostics connection={connection} wallet={wallet} sessionWallet={session.walletAddress} onListAccounts={onListAccounts} onCheckBalances={onCheckBalances} /> : null}

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

/**
 * Temporary operator diagnostics for the live /nim/rate path: shows
 * whether the authenticated request was attempted, the inferred HTTP
 * outcome, and the parsed rate or the exact error. Same session cookie
 * as every other call; no wallet contact; nothing secret can appear.
 */
function RateDiagnosticsSection({ load }: { load: () => Promise<NimIndicativeRate> }) {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'ok'; rate: NimIndicativeRate }
    | { status: 'error'; message: string }
  >({ status: 'loading' })

  useEffect(() => {
    let active = true
    load().then((rate) => {
      if (active) setState({ status: 'ok', rate })
    }).catch((loadError: unknown) => {
      if (active) setState({ status: 'error', message: loadError instanceof Error ? loadError.message : 'NIM rate check failed.' })
    })
    return () => {
      active = false
    }
  }, [load])

  return (
    <section className="profile-settings-group" aria-labelledby="settings-rate">
      <h2 className="settings-group-title" id="settings-rate">NIM rate diagnostics</h2>
      {state.status === 'loading' ? <p className="section-copy" role="status">Checking…</p> : null}
      {state.status === 'error' ? <p className="inline-error" role="alert">{state.message}</p> : null}
      {state.status !== 'loading' ? (
        <div className="settings-list">
          <SettingRow label="Request" value="GET /nim/rate · attempted" />
          <SettingRow label="HTTP" value={state.status === 'ok' ? '200 · parsed' : inferRateHttp(state.message)} />
          {state.status === 'ok'
            ? <SettingRow label="Parsed rate" value={`1 NIM ≈ ₦${state.rate.ngnPerNim}`} mono />
            : null}
        </div>
      ) : null}
    </section>
  )
}

function inferRateHttp(message: string): string {
  if (message.includes('not configured')) return '503 · unconfigured'
  if (message.includes('unavailable')) return '502 · upstream failed'
  const match = /failed \((\d{3})\)/.exec(message)
  if (match) return `${match[1]} · transport/route failure`
  return 'unknown · see message'
}

function SettingRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="setting-row"><span>{label}</span><strong className={mono ? 'setting-value-mono' : ''}>{value}</strong></div>
}

function railTone(status: RailStatus): 'quiet' | 'ready' | 'attention' {
  if (status === 'verified') return 'ready'
  if (status === 'configured') return 'attention'
  return 'quiet'
}

/**
 * Operator-facing production readiness, loaded with the same session
 * cookie as every other authenticated call. Renders only fields from the
 * already-safe readiness DTO — no secrets can appear here because the
 * server never sends them.
 */
function ReadinessSection({ load }: { load: () => Promise<ReadinessReport> }) {
  const [report, setReport] = useState<ReadinessReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    load().then((next) => {
      if (!active) return
      setReport(next)
      setError(null)
    }).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : 'Munus could not load readiness.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => {
      active = false
    }
  }, [load])

  return (
    <section className="profile-settings-group" aria-labelledby="settings-readiness">
      <h2 className="settings-group-title" id="settings-readiness">Production readiness</h2>
      {loading ? <p className="section-copy" role="status">Checking…</p> : null}
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
      {report ? (
        <div className="settings-list">
          <SettingRow label="Database" value={report.database === 'ready' ? 'Ready' : 'Unreachable'} />
          <SettingRow label="Network" value={report.network === 'mainnet' ? 'Mainnet' : 'Testnet'} />
          <SettingRow label="NIM receiver" value={report.nimReceiver ? 'Configured' : 'Missing'} />
          <SettingRow label="Nimiq RPC" value={report.nimiqRpc ? 'Configured' : 'Missing'} />
          <SettingRow
            label="ClubKonnect"
            value={report.clubKonnect ? (report.clubKonnectCallback ? 'Configured + callback' : 'Configured, no callback') : 'Missing'}
          />
          {(['airtime', 'data', 'cashout'] as const).map((rail) => (
            <div className="setting-row" key={rail}>
              <span style={{ textTransform: 'capitalize' }}>{rail === 'cashout' ? 'Cash out' : rail}</span>
              <strong><StatusPill label={report.rails[rail].status} tone={railTone(report.rails[rail].status)} /></strong>
            </div>
          ))}
        </div>
      ) : null}
      {report ? <p className="section-copy">Same safe data as the operator endpoint, loaded with your session.</p> : null}
    </section>
  )
}
