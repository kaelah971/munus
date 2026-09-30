import { useState } from 'react'
import { BrandLockup, PrimaryButton, QuietButton } from '../components/Primitives'
export function AppLockScreen({
  onUnlock,
  onSignOut,
}: {
  onUnlock: (pin: string) => Promise<boolean>
  onSignOut: () => void
}) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (await onUnlock(pin)) {
        setPin('')
      } else {
        setError('That PIN did not unlock Munus.')
        setPin('')
      }
    } catch (unlockError) {
      setError(unlockError instanceof Error ? unlockError.message : 'Munus could not verify the PIN.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app-shell">
      <main className="app-frame lock-screen">
        <div className="onboarding-topbar"><BrandLockup /><span className="lock-mark">•••</span></div>
        <div className="lock-content">
          <p className="eyebrow">Munus app lock</p>
          <h1>Welcome back.</h1>
          <p>Your PIN protects Munus personal data only. Nimiq Pay still controls wallet approvals.</p>
          <form className="pin-form" onSubmit={handleSubmit}>
            <label><span>6-digit PIN</span><input autoComplete="one-time-code" autoFocus inputMode="numeric" maxLength={6} onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))} type="password" value={pin} /></label>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <PrimaryButton disabled={busy || pin.length !== 6} type="submit">{busy ? 'Checking…' : 'Unlock Munus'}</PrimaryButton>
          </form>
          <QuietButton className="lock-signout" onClick={onSignOut}>Sign out</QuietButton>
        </div>
      </main>
    </div>
  )
}
