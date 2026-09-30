import { useState } from 'react'
import { createAuthGateway } from './auth/session'
import { requestNimiqSignature } from './integration/nimiq'
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
import { sessionStore } from './persistence/sessionStore'
import { preferencesStore } from './persistence/preferencesStore'
import { pinStore } from './persistence/pinStore'
import { createPinRecord, verifyPin, type PinRecord } from './security/appLock'

const ONBOARDING_STORAGE_KEY = 'munus:onboarding-complete'

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
  const [session, setSession] = useState<MunusSession | null>(() => sessionStore.get())
  const [profile, setProfile] = useState<MunusProfile | null>(() => {
    const savedSession = sessionStore.get()
    return savedSession ? profileStore.get(savedSession.userId) : null
  })
  const [pinRecord, setPinRecord] = useState<PinRecord | null>(() => {
    const savedSession = sessionStore.get()
    return savedSession ? pinStore.get(savedSession.userId) : null
  })
  const [unlocked, setUnlocked] = useState(() => {
    const savedSession = sessionStore.get()
    return !savedSession || !pinStore.get(savedSession.userId)
  })
  const [destination, setDestination] = useState<AppDestination>('home')
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  const { state: connection, retry: retryConnection } = useNimiq()
  const wallet = useNimiqWallet(connection)

  async function signIn() {
    const walletAddress = connection.accounts[0]
    if (!walletAddress) {
      setAuthError('Open Munus inside Nimiq Pay and share an account before connecting.')
      return
    }

    setAuthBusy(true)
    setAuthError(null)
    try {
      const gateway = createAuthGateway()
      const nextSession = await gateway.signIn(
        walletAddress,
        (message) => requestNimiqSignature(connection, message),
      )
      const nextProfile = profileStore.get(nextSession.userId)
      const nextPin = pinStore.get(nextSession.userId)
      sessionStore.save(nextSession)
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

  function signOut() {
    const currentSession = session
    sessionStore.clear()
    setSession(null)
    setProfile(null)
    setPinRecord(null)
    setUnlocked(true)
    setAuthError(null)
    setDestination('home')

    if (currentSession) {
      void createAuthGateway().signOut(currentSession).catch(() => {
        // Local state is already cleared if a remote revoke is unavailable.
      })
    }
  }

  async function saveProfile(draft: ProfileDraft, destinationAfterSave: AppDestination = 'home') {
    if (!session) throw new Error('Connect a Munus account before saving a profile.')
    const nextProfile = profile
      ? updateProfile(profile, draft)
      : createProfile(session.userId, draft)
    profileStore.save(nextProfile)
    setProfile(nextProfile)
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
