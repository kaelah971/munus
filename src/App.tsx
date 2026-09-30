import { useEffect, useState } from 'react'
import { createAuthGateway } from './auth/session'
import { munusConfig } from './config'
import { requestNimiqSignature, getNimiqNetwork } from './integration/nimiq'
import { useNimiq } from './hooks/useNimiq'
import { useNimiqWallet } from './hooks/useNimiqWallet'
import type { AppDestination } from './navigation'
import {
  AppLockScreen,
  EmptyPage,
  HomePage,
  OnboardingPage,
  PayPage,
  ProfilePage,
  ProfileSetupPage,
} from './pages'
import {
  createProfile,
  updateProfile,
  type MunusProfile,
  type ProfileDraft,
} from './domain/profile'
import type { MunusSession } from './domain/auth'
import { profileStore } from './persistence/profileStore'
import { RemoteProfileApi } from './persistence/profileApi'
import { sessionStore } from './persistence/sessionStore'
import { preferencesStore } from './persistence/preferencesStore'
import { pinStore } from './persistence/pinStore'
import { createPinRecord, verifyPin, type PinRecord } from './security/appLock'

const ONBOARDING_STORAGE_KEY = 'munus:onboarding-complete'
const usesRemotePersistence = munusConfig.productionAuth || Boolean(munusConfig.apiBaseUrl)
const remoteProfileApi = new RemoteProfileApi(munusConfig.apiBaseUrl)

function readOnboardingState(): boolean {
  if (typeof window === 'undefined') return false

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
    // The current session can still continue if local storage is unavailable.
  }
}

export function App() {
  const [onboardingComplete, setOnboardingComplete] = useState(readOnboardingState)
  const [session, setSession] = useState<MunusSession | null>(() =>
    usesRemotePersistence ? null : sessionStore.get(),
  )
  const [profile, setProfile] = useState<MunusProfile | null>(() => {
    if (usesRemotePersistence) return null
    const savedSession = sessionStore.get()
    return savedSession ? profileStore.get(savedSession.userId) : null
  })
  const [pinRecord, setPinRecord] = useState<PinRecord | null>(() => {
    if (usesRemotePersistence) return null
    const savedSession = sessionStore.get()
    return savedSession ? pinStore.get(savedSession.userId) : null
  })
  const [unlocked, setUnlocked] = useState(() => {
    if (usesRemotePersistence) return true
    const savedSession = sessionStore.get()
    return !savedSession || !pinStore.get(savedSession.userId)
  })
  const [destination, setDestination] = useState<AppDestination>('home')
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [authHydrating, setAuthHydrating] = useState(usesRemotePersistence)
  const [profileLoadError, setProfileLoadError] = useState<string | null>(null)

  const { state: connection, retry: retryConnection } = useNimiq()
  const wallet = useNimiqWallet(connection)

  useEffect(() => {
    if (!usesRemotePersistence) return

    let active = true
    const gateway = createAuthGateway()

    async function restoreRemoteSession() {
      try {
        const restoredSession = await gateway.restoreSession()
        if (!active) return

        if (!restoredSession) {
          setSession(null)
          setProfile(null)
          setPinRecord(null)
          setUnlocked(true)
          return
        }

        const restoredProfile = await remoteProfileApi.getProfile()
        if (!active) return

        const restoredPin = pinStore.get(restoredSession.userId)
        setSession(restoredSession)
        setProfile(restoredProfile)
        setPinRecord(restoredPin)
        setUnlocked(!restoredPin)
        setProfileLoadError(null)
      } catch (error) {
        if (!active) return
        setProfileLoadError(
          error instanceof Error
            ? error.message
            : 'Munus could not restore your account from the server.',
        )
      } finally {
        if (active) setAuthHydrating(false)
      }
    }

    void restoreRemoteSession()
    return () => {
      active = false
    }
  }, [])

  async function signIn() {
    const walletAddress = connection.accounts[0]
    if (!walletAddress) {
      setAuthError('Open Munus inside Nimiq Pay and share an account before connecting.')
      return
    }

    setAuthBusy(true)
    setAuthError(null)
    setProfileLoadError(null)
    try {
      const gateway = createAuthGateway()
      const network = getNimiqNetwork() === 'testnet' ? 'testnet' : 'mainnet'
      const nextSession = await gateway.signIn(
        walletAddress,
        (message) => requestNimiqSignature(connection, message),
        network,
      )
      const nextProfile = usesRemotePersistence
        ? await remoteProfileApi.getProfile()
        : profileStore.get(nextSession.userId)
      const nextPin = pinStore.get(nextSession.userId)

      if (!usesRemotePersistence) sessionStore.save(nextSession)
      setSession(nextSession)
      setProfile(nextProfile)
      setPinRecord(nextPin)
      setUnlocked(!nextPin)
      setDestination('home')
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Munus could not connect this account.')
    } finally {
      setAuthBusy(false)
    }
  }

  async function signOut() {
    const currentSession = session
    if (currentSession && usesRemotePersistence) {
      try {
        await createAuthGateway().signOut(currentSession)
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : 'Munus could not revoke this session.')
        return
      }
    }

    sessionStore.clear()
    setSession(null)
    setProfile(null)
    setPinRecord(null)
    setUnlocked(true)
    setAuthError(null)
    setProfileLoadError(null)
    setDestination('home')
  }

  async function saveProfile(draft: ProfileDraft, destinationAfterSave: AppDestination = 'home') {
    if (!session) throw new Error('Connect a Munus account before saving a profile.')

    const nextProfile = usesRemotePersistence
      ? await remoteProfileApi.saveProfile(draft)
      : profile
        ? updateProfile(profile, draft)
        : createProfile(session.userId, draft)

    if (!usesRemotePersistence) profileStore.save(nextProfile)
    setProfile(nextProfile)
    setProfileLoadError(null)
    setDestination(destinationAfterSave)
  }

  async function savePin(pin: string) {
    if (!session) throw new Error('Connect a Munus account before enabling app lock.')
    const nextRecord = await createPinRecord(pin)
    pinStore.save(session.userId, nextRecord)
    preferencesStore.save({
      ...preferencesStore.get(session.userId),
      appLockEnabled: true,
    })
    setPinRecord(nextRecord)
    setUnlocked(true)
  }

  function removePin() {
    if (!session) return
    pinStore.clear(session.userId)
    preferencesStore.save({
      ...preferencesStore.get(session.userId),
      appLockEnabled: false,
    })
    setPinRecord(null)
    setUnlocked(true)
  }

  async function unlock(pin: string): Promise<boolean> {
    if (!pinRecord) return true
    const valid = await verifyPin(pin, pinRecord)
    if (valid) setUnlocked(true)
    return valid
  }

  function copyWalletAddress() {
    if (!wallet.address || !navigator.clipboard) return
    void navigator.clipboard.writeText(wallet.address)
  }

  if (!onboardingComplete) {
    return (
      <OnboardingPage
        onComplete={() => {
          saveOnboardingState()
          setOnboardingComplete(true)
        }}
      />
    )
  }

  if (authHydrating) {
    return (
      <main className="page-state" aria-live="polite">
        <p className="eyebrow">Munus</p>
        <h1>Restoring your account</h1>
        <p>Checking your secure session and profile.</p>
      </main>
    )
  }

  if (profileLoadError && session) {
    return (
      <main className="page-state">
        <p className="eyebrow">Munus</p>
        <h1>We could not load your profile</h1>
        <p>{profileLoadError}</p>
        <button className="primary-button" type="button" onClick={() => window.location.reload()}>
          Try again
        </button>
        <button className="quiet-button" type="button" onClick={signOut}>
          Sign out
        </button>
      </main>
    )
  }

  if (session && pinRecord && !unlocked) {
    return <AppLockScreen onSignOut={() => void signOut()} onUnlock={unlock} />
  }

  if (session && !profile) {
    return (
      <ProfileSetupPage
        onSignOut={() => void signOut()}
        onSubmit={saveProfile}
        walletAddress={session.walletAddress}
      />
    )
  }

  if (destination === 'profile') {
    return (
      <ProfilePage
        authBusy={authBusy}
        authError={authError}
        connection={connection}
        onNavigate={setDestination}
        onRemovePin={removePin}
        onSave={(draft) => saveProfile(draft, 'profile')}
        onSavePin={savePin}
        onSignIn={() => void signIn()}
        onSignOut={() => void signOut()}
        pinRecord={pinRecord}
        profile={profile}
        session={session}
      />
    )
  }

  if (destination === 'pay') {
    return <PayPage connection={connection} onNavigate={setDestination} />
  }

  if (destination === 'pockets' || destination === 'activity') {
    return <EmptyPage connection={connection} destination={destination} onNavigate={setDestination} />
  }

  return (
    <HomePage
      authBusy={authBusy}
      authError={authError}
      connection={connection}
      onCopyAddress={copyWalletAddress}
      onNavigate={setDestination}
      onProfile={() => setDestination('profile')}
      onRetryConnection={retryConnection}
      onSignIn={() => void signIn()}
      profile={profile}
      session={session}
      wallet={wallet}
    />
  )
}
