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
  PocketsPage,
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
import type {
  PocketAllocationDraft,
  PocketDraft,
  PlanningData,
  ReminderDraft,
  ReminderStatus,
  SpendRuleDraft,
} from './domain/planning'
import { profileStore } from './persistence/profileStore'
import { LocalPlanningApi } from './persistence/planningStore'
import { RemotePlanningApi, type PlanningApi } from './persistence/planningApi'
import { RemoteProfileApi } from './persistence/profileApi'
import { sessionStore } from './persistence/sessionStore'
import { preferencesStore } from './persistence/preferencesStore'
import { pinStore } from './persistence/pinStore'
import { createPinRecord, verifyPin, type PinRecord } from './security/appLock'

const ONBOARDING_STORAGE_KEY = 'munus:onboarding-complete'
const usesRemotePersistence = munusConfig.productionAuth || Boolean(munusConfig.apiBaseUrl)
const remoteProfileApi = new RemoteProfileApi(munusConfig.apiBaseUrl)

function emptyPlanningData(): PlanningData {
  return { pockets: [], reminders: [], spendRules: [] }
}

function createPlanningApi(userId: string): PlanningApi {
  return usesRemotePersistence
    ? new RemotePlanningApi(munusConfig.apiBaseUrl)
    : new LocalPlanningApi(userId)
}

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
  const [planning, setPlanning] = useState<PlanningData>(emptyPlanningData)
  const [planningLoading, setPlanningLoading] = useState(() => !usesRemotePersistence && Boolean(sessionStore.get()))
  const [planningError, setPlanningError] = useState<string | null>(null)

  const { state: connection, retry: retryConnection } = useNimiq()
  const wallet = useNimiqWallet(connection)
  const sessionUserId = session?.userId

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
        setPlanningLoading(true)
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

  useEffect(() => {
    if (!sessionUserId) return

    let active = true
    void createPlanningApi(sessionUserId).load().then((data) => {
      if (active) setPlanning(data)
    }).catch((error: unknown) => {
      if (active) setPlanningError(error instanceof Error ? error.message : 'Munus could not load your planning context.')
    }).finally(() => {
      if (active) setPlanningLoading(false)
    })

    return () => {
      active = false
    }
  }, [sessionUserId])

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
      setPlanningLoading(true)
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
    setPlanning(emptyPlanningData())
    setPlanningLoading(false)
    setPlanningError(null)
    setDestination('home')
  }

  function planningApiForCurrentSession(): PlanningApi {
    if (!session) throw new Error('Connect a Munus account before using Life Pockets.')
    return createPlanningApi(session.userId)
  }

  async function createPocket(draft: PocketDraft) {
    const pocket = await planningApiForCurrentSession().createPocket(draft)
    setPlanning((current) => ({ ...current, pockets: [pocket, ...current.pockets] }))
  }

  async function updatePocket(id: string, draft: PocketDraft) {
    const pocket = await planningApiForCurrentSession().updatePocket(id, draft)
    setPlanning((current) => ({
      ...current,
      pockets: current.pockets.map((item) => item.id === id ? pocket : item),
    }))
  }

  async function archivePocket(id: string) {
    await planningApiForCurrentSession().archivePocket(id)
    setPlanning((current) => ({ ...current, pockets: current.pockets.filter((pocket) => pocket.id !== id) }))
  }

  async function addPocketAllocation(id: string, draft: PocketAllocationDraft) {
    const result = await planningApiForCurrentSession().addPocketAllocation(id, draft)
    setPlanning((current) => ({
      ...current,
      pockets: current.pockets.map((pocket) => pocket.id === id ? result.pocket : pocket),
    }))
  }

  async function createReminder(draft: ReminderDraft) {
    const reminder = await planningApiForCurrentSession().createReminder(draft)
    setPlanning((current) => ({ ...current, reminders: [...current.reminders, reminder] }))
  }

  async function updateReminder(id: string, draft: ReminderDraft, status: ReminderStatus) {
    const reminder = await planningApiForCurrentSession().updateReminder(id, draft, status)
    setPlanning((current) => ({
      ...current,
      reminders: current.reminders.map((item) => item.id === id ? reminder : item),
    }))
  }

  async function deleteReminder(id: string) {
    await planningApiForCurrentSession().deleteReminder(id)
    setPlanning((current) => ({ ...current, reminders: current.reminders.filter((reminder) => reminder.id !== id) }))
  }

  async function createSpendRule(draft: SpendRuleDraft) {
    const rule = await planningApiForCurrentSession().createSpendRule(draft)
    setPlanning((current) => ({ ...current, spendRules: [rule, ...current.spendRules] }))
  }

  async function updateSpendRule(id: string, draft: SpendRuleDraft) {
    const rule = await planningApiForCurrentSession().updateSpendRule(id, draft)
    setPlanning((current) => ({
      ...current,
      spendRules: current.spendRules.map((item) => item.id === id ? rule : item),
    }))
  }

  async function deleteSpendRule(id: string) {
    await planningApiForCurrentSession().deleteSpendRule(id)
    setPlanning((current) => ({ ...current, spendRules: current.spendRules.filter((rule) => rule.id !== id) }))
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

  if (destination === 'pockets') {
    return (
      <PocketsPage
        authenticated={Boolean(session)}
        connection={connection}
        error={planningError}
        loading={planningLoading}
        onAddAllocation={addPocketAllocation}
        onArchivePocket={archivePocket}
        onCreatePocket={createPocket}
        onCreateReminder={createReminder}
        onCreateSpendRule={createSpendRule}
        onDeleteReminder={deleteReminder}
        onDeleteSpendRule={deleteSpendRule}
        onNavigate={setDestination}
        onUpdatePocket={updatePocket}
        onUpdateReminder={updateReminder}
        onUpdateSpendRule={updateSpendRule}
        pockets={planning.pockets}
        reminders={planning.reminders}
        spendRules={planning.spendRules}
      />
    )
  }

  if (destination === 'activity') {
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
      planningLoading={planningLoading}
      pockets={planning.pockets}
      profile={profile}
      reminders={planning.reminders}
      session={session}
      wallet={wallet}
    />
  )
}
