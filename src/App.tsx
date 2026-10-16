import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createAuthGateway } from './auth/session'
import { munusConfig } from './config'
import { requestNimiqSignature, getNimiqNetwork } from './integration/nimiq'
import { useNimiq } from './hooks/useNimiq'
import { useNimiqWallet } from './hooks/useNimiqWallet'
import type { AppDestination } from './navigation'
import {
  ActivityPage,
  AppLockScreen,
  HomePage,
  LivePage,
  OnboardingPage,
  PayPage,
  PocketsPage,
  ProfilePage,
  PublicRequestPage,
  SupportPage,
} from './pages'
import {
  createProfile,
  updateProfile,
  DEFAULT_PROFILE_DRAFT,
  isProfileComplete,
  profileToDraft,
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
import type {
  ContactDraft,
  SupportDraftInput,
  SupportRequestDraft,
  SupportRequestStatus,
  SupportRuleDraft,
} from './domain/support'
import type { EssentialRequest, EssentialRequestDraft } from './domain/essentialRequests'
import type { DataPlan } from './domain/orders'
import type { SupportNetwork } from './domain/support'
import { profileStore } from './persistence/profileStore'
import { LocalPlanningApi } from './persistence/planningStore'
import { RemotePlanningApi, type PlanningApi } from './persistence/planningApi'
import { RemoteSupportApi, type SupportApi, type SupportData } from './persistence/supportApi'
import { RemotePaymentApi, type PaymentApi } from './persistence/paymentApi'
import { clearHostAccounts, readHostAccounts, saveHostAccounts, selectFundingAddresses } from './persistence/hostAccounts'
import { useNimiqFunding } from './hooks/useNimiqFunding'
import { LocalPaymentApi } from './persistence/paymentStore'
import { LocalSupportApi } from './persistence/supportStore'
import { RemoteProfileApi } from './persistence/profileApi'
import { sessionStore } from './persistence/sessionStore'
import { preferencesStore } from './persistence/preferencesStore'
import { pinStore } from './persistence/pinStore'
import { createPinRecord, verifyPin, type PinRecord } from './security/appLock'
import { MobileAppShell } from './components/MobileAppShell'
import { NameSetupPage } from './pages/NameSetupPage'
import { WalletConnectionPage } from './pages/WalletConnectionPage'
import { ContactsPage } from './pages/ContactsPage'
import { isValidDisplayName, readPendingName, storePendingName } from './persistence/pendingName'

const usesRemotePersistence = munusConfig.productionAuth || Boolean(munusConfig.apiBaseUrl)
const remoteProfileApi = new RemoteProfileApi(munusConfig.apiBaseUrl)

function emptyPlanningData(): PlanningData {
  return { pockets: [], reminders: [], spendRules: [] }
}

function emptySupportData(): SupportData {
  return { contacts: [], supportRules: [], supportRequests: [], supportDrafts: [] }
}

function createPlanningApi(userId: string): PlanningApi {
  return usesRemotePersistence
    ? new RemotePlanningApi(munusConfig.apiBaseUrl)
    : new LocalPlanningApi(userId)
}

function createPaymentApi(userId: string): PaymentApi {
  return usesRemotePersistence
    ? new RemotePaymentApi(munusConfig.apiBaseUrl)
    : new LocalPaymentApi(userId)
}

function createSupportApi(userId: string): SupportApi {
  return usesRemotePersistence
    ? new RemoteSupportApi(munusConfig.apiBaseUrl)
    : new LocalSupportApi(userId)
}

function readPublicRequestId(): string | null {
  if (typeof window === 'undefined') return null
  const match = window.location.pathname.match(/^\/request\/([^/]+)$/)
  return match ? decodeURIComponent(match[1]) : null
}

function readLiveRoute(): boolean {
  if (typeof window === 'undefined') return false
  return window.location.pathname === '/live'
}


export function App() {
  const [pendingName, setPendingName] = useState(() => {
    const savedSession = usesRemotePersistence ? null : sessionStore.get()
    const savedProfile = savedSession ? profileStore.get(savedSession.userId) : null
    if (savedProfile && isValidDisplayName(savedProfile.displayName)) {
      storePendingName('')
      return ''
    }
    return readPendingName()
  })
  // Entry always starts at the landing page when authentication is needed.
  // A local "onboarding complete" hint must never skip it: only a valid
  // server session (silent restore) or a fresh explicit authentication
  // decides the journey from here.
  const [entryStep, setEntryStep] = useState<'welcome' | 'name' | 'connect'>('welcome')
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
  const [profileSaving, setProfileSaving] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [authHydrating, setAuthHydrating] = useState(usesRemotePersistence)
  const [profileLoadError, setProfileLoadError] = useState<string | null>(null)
  const [planning, setPlanning] = useState<PlanningData>(emptyPlanningData)
  const [planningLoading, setPlanningLoading] = useState(() => !usesRemotePersistence && Boolean(sessionStore.get()))
  const [planningError, setPlanningError] = useState<string | null>(null)
  const [support, setSupport] = useState<SupportData>(emptySupportData)
  const [supportLoading, setSupportLoading] = useState(() => !usesRemotePersistence && Boolean(sessionStore.get()))
  const [supportError, setSupportError] = useState<string | null>(null)
  const [hideBalances, setHideBalances] = useState(() => {
    const saved = sessionStore.get()
    return saved ? preferencesStore.get(saved.userId).hideBalances : false
  })
  const [contactIntent, setContactIntent] = useState<{ view: 'list' | 'add' | 'detail'; id?: string; returnTo: AppDestination }>({ view: 'list', returnTo: 'home' })
  const [supportContactId, setSupportContactId] = useState<string | undefined>()
  const [essentialRequests, setEssentialRequests] = useState<EssentialRequest[]>([])
  const authGeneration = useRef(0)

  const { state: connection, retry: retryConnection, requestAccounts } = useNimiq()
  const sessionUserId = session?.userId

  const paymentApi = useMemo(() => (sessionUserId ? createPaymentApi(sessionUserId) : null), [sessionUserId])
  // Silent read-only RPC fallback for the session wallet balance. Used
  // only when the host getBalance read fails; never prompts, never signs.
  // Keyed on session so its identity never retriggers the silent load.
  const fetchRpcBalance = useMemo(
    () =>
      paymentApi
        ? async () => {
          const dto = await paymentApi.getWalletNimBalance()
          const luna = Number(dto.balanceLuna)
          if (!Number.isSafeInteger(luna) || luna < 0) {
            throw new Error('Server returned an unreadable balance.')
          }
          if (dto.network !== 'mainnet' && dto.network !== 'testnet') {
            throw new Error('Server returned an unreadable balance.')
          }
          return { lunaBalance: luna, nimBalance: dto.balanceNim, network: dto.network }
        }
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionUserId],
  )
  const { state: wallet, refreshWallet } = useNimiqWallet(connection, session?.walletAddress, fetchRpcBalance)
  // Durable funding context: the server-persisted exposed set (source of
  // truth, survives webview storage loss) with the local cache as fast
  // fallback until the restore fetch lands. Silent server reads only.
  const [serverAccounts, setServerAccounts] = useState<string[] | null>(null)
  const storedHostAddresses = selectFundingAddresses(
    sessionUserId ? serverAccounts : null,
    sessionUserId ? readHostAccounts(sessionUserId)?.addresses ?? [] : [],
  )
  const listBalances = useMemo(
    () => (paymentApi ? (addresses: string[]) => paymentApi.listAccountBalances(addresses) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionUserId],
  )
  const funding = useNimiqFunding({ sessionUserId, addresses: storedHostAddresses, listAccountBalances: listBalances })
  const fundingContext = funding.status === 'ready' && funding.nim && funding.luna
    ? { luna: funding.luna, nim: funding.nim, network: funding.network }
    : null
  // The shared informational rate loop is wired once at application
  // bootstrap (main.tsx) against the public endpoint, so it never waits
  // for session, wallet, or profile — and never resets across users or
  // routes. Home and Pay both subscribe to that same global store.
  const getReadiness = useMemo(
    () => (paymentApi ? () => paymentApi.getReadiness() : undefined),
    [paymentApi],
  )

  useEffect(() => {
    if (!usesRemotePersistence || readPublicRequestId()) return

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
        const restoredPin = pinStore.get(restoredSession.userId)
        setPlanningLoading(true)
        setSupportLoading(true)
        setSession(restoredSession)
        setPinRecord(restoredPin)
        setUnlocked(!restoredPin)
        setHideBalances(preferencesStore.get(restoredSession.userId).hideBalances)
        // Restore the durable funding set alongside the session so Home
        // aggregates from chain reads even after localStorage loss.
        void createPaymentApi(restoredSession.userId).getWalletAccounts()
          .then((saved) => { if (active) setServerAccounts(saved.addresses) })
          .catch(() => { if (active) setServerAccounts(null) })
        const restoredProfile = await remoteProfileApi.getProfile()
        if (!active) return
        setProfile(restoredProfile)
        if (restoredProfile && isValidDisplayName(restoredProfile.displayName)) {
          storePendingName('')
          setPendingName('')
        }
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

  useEffect(() => {
    if (!sessionUserId) return

    let active = true
    void createSupportApi(sessionUserId).load().then((data) => {
      if (active) {
        setSupport(data)
        void createSupportApi(sessionUserId).listEssentialRequests()
          .then((rows) => { if (active) setEssentialRequests(rows) })
          .catch(() => { if (active) setEssentialRequests([]) })
      }
    }).catch((error: unknown) => {
      if (active) setSupportError(error instanceof Error ? error.message : 'Munus could not load your support context.')
    }).finally(() => {
      if (active) setSupportLoading(false)
    })

    return () => {
      active = false
    }
  }, [sessionUserId])

  async function signIn() {
    if (session) {
      await finishNameSetup(session, profile)
      return
    }
    setAuthBusy(true)
    setAuthError(null)
    setProfileLoadError(null)
    const generation = authGeneration.current
    try {
      const accounts = await requestAccounts()
      const walletAddress = accounts[0]
      if (!walletAddress) {
        throw new Error('Nimiq Pay did not share an account with Munus.')
      }
      const signingConnection = { ...connection, accounts }
      const gateway = createAuthGateway()
      const network = getNimiqNetwork() === 'testnet' ? 'testnet' : 'mainnet'
      const nextSession = await gateway.signIn(
        walletAddress,
        (message) => requestNimiqSignature(signingConnection, message),
        network,
      )
      if (generation !== authGeneration.current) return
      const nextPin = pinStore.get(nextSession.userId)

      if (!usesRemotePersistence) sessionStore.save(nextSession)
      // Remember the host-exposed account set from this explicit Connect
      // so silent restores never need a wallet prompt to show funding.
      // Local cache first, then the server set (authoritative, survives
      // storage loss). Persistence must never break authentication.
      saveHostAccounts(nextSession.userId, accounts)
      void createPaymentApi(nextSession.userId).saveWalletAccounts([...accounts]).catch(() => undefined)
      setPlanningLoading(true)
      setSupportLoading(true)
      setSession(nextSession)
      setPinRecord(nextPin)
      setUnlocked(!nextPin)
      setHideBalances(preferencesStore.get(nextSession.userId).hideBalances)
      setDestination('home')
      let nextProfile: MunusProfile | null
      try {
        nextProfile = usesRemotePersistence ? await remoteProfileApi.getProfile() : profileStore.get(nextSession.userId)
      } catch (error) {
        if (generation !== authGeneration.current) return
        setProfileLoadError(error instanceof Error ? error.message : 'Munus could not load your profile.')
        return
      }
      if (generation !== authGeneration.current) return
      setProfile(nextProfile)
      if (nextProfile && isValidDisplayName(nextProfile.displayName)) clearSetupDraft()
      if (!nextPin) await persistSetupProfile(nextSession, nextProfile, generation)
    } catch (error) {
      if (generation !== authGeneration.current) return
      setAuthError(error instanceof Error ? error.message : 'Munus could not connect this account.')
    } finally {
      if (generation === authGeneration.current) {
        setProfileSaving(false)
        setAuthBusy(false)
      }
    }
  }

  function clearSetupDraft() {
    storePendingName('')
    setPendingName('')
  }

  async function persistSetupProfile(currentSession: MunusSession, currentProfile: MunusProfile | null, generation = authGeneration.current, displayName = pendingName) {
    if (generation !== authGeneration.current) return
    if (currentProfile && isValidDisplayName(currentProfile.displayName)) {
      setProfile(currentProfile)
    } else {
      const cleanName = displayName.trim()
      if (!isValidDisplayName(cleanName)) {
        setEntryStep('name')
        return
      }
      setProfileSaving(true)
      const draft = { ...(currentProfile ? profileToDraft(currentProfile) : DEFAULT_PROFILE_DRAFT), displayName: cleanName }
      const savedProfile = usesRemotePersistence
        ? await remoteProfileApi.saveProfile(draft)
        : currentProfile ? { ...updateProfile(currentProfile, draft), avatarReference: currentProfile.avatarReference } : createProfile(currentSession.userId, draft)
      if (generation !== authGeneration.current) return
      if (!isValidDisplayName(savedProfile.displayName)) throw new Error('Your profile was not saved with a valid name. Please try again.')
      if (!usesRemotePersistence) profileStore.save(savedProfile)
      setProfile(savedProfile)
    }
    clearSetupDraft()
    setDestination('home')
  }

  async function finishNameSetup(currentSession: MunusSession, currentProfile: MunusProfile | null, displayName?: string) {
    setAuthBusy(true)
    setAuthError(null)
    const generation = authGeneration.current
    try {
      await persistSetupProfile(currentSession, currentProfile, generation, displayName ?? pendingName)
    } catch (error) {
      if (generation !== authGeneration.current) return
      setAuthError(error instanceof Error ? error.message : 'Munus could not save your profile.')
    } finally {
      if (generation === authGeneration.current) {
        setProfileSaving(false)
        setAuthBusy(false)
      }
    }
  }

  async function retryProfileLoad() {
    if (!session) {
      window.location.reload()
      return
    }
    setAuthBusy(true)
    const generation = authGeneration.current
    try {
      const loaded = usesRemotePersistence ? await remoteProfileApi.getProfile() : profileStore.get(session.userId)
      if (generation !== authGeneration.current) return
      setProfile(loaded)
      setProfileLoadError(null)
      if (!pinRecord || unlocked) await persistSetupProfile(session, loaded, generation)
    } catch (error) {
      if (generation !== authGeneration.current) return
      setProfileLoadError(error instanceof Error ? error.message : 'Munus could not load your profile.')
    } finally {
      if (generation === authGeneration.current) {
        setProfileSaving(false)
        setAuthBusy(false)
      }
    }
  }

  async function signOut() {
    const currentSession = session
    if (usesRemotePersistence) {
      try {
        await createAuthGateway().signOut(currentSession ?? undefined)
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : 'Munus could not revoke this session.')
        return
      }
    }

    authGeneration.current += 1
    sessionStore.clear()
    setServerAccounts(null)
    if (session) clearHostAccounts(session.userId)
    setAuthBusy(false)
    setProfileSaving(false)
    setSession(null)
    setProfile(null)
    setPinRecord(null)
    setUnlocked(true)
    setAuthError(null)
    setProfileLoadError(null)
    setPlanning(emptyPlanningData())
    setPlanningLoading(false)
    setPlanningError(null)
    setSupport(emptySupportData())
    setEssentialRequests([])
    setSupportLoading(false)
    setSupportError(null)
    setDestination('home')
    setPendingName('')
    storePendingName('')
    setEntryStep('welcome')
    setHideBalances(false)
    setSupportContactId(undefined)
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

  function supportApiForCurrentSession(): SupportApi {
    if (!session) throw new Error('Connect a Munus account before using Support Mode.')
    return createSupportApi(session.userId)
  }

  async function createContact(draft: ContactDraft) {
    const contact = await supportApiForCurrentSession().createContact(draft)
    setSupport((current) => ({ ...current, contacts: [contact, ...current.contacts] }))
  }

  async function updateContact(id: string, draft: ContactDraft) {
    const contact = await supportApiForCurrentSession().updateContact(id, draft)
    setSupport((current) => ({ ...current, contacts: current.contacts.map((item) => item.id === id ? contact : item) }))
  }

  async function archiveContact(id: string) {
    await supportApiForCurrentSession().archiveContact(id)
    setSupport((current) => ({ ...current, contacts: current.contacts.filter((contact) => contact.id !== id) }))
  }

  async function createSupportRule(draft: SupportRuleDraft) {
    const rule = await supportApiForCurrentSession().createSupportRule(draft)
    setSupport((current) => ({ ...current, supportRules: [rule, ...current.supportRules] }))
  }

  async function updateSupportRule(id: string, draft: SupportRuleDraft) {
    const rule = await supportApiForCurrentSession().updateSupportRule(id, draft)
    setSupport((current) => ({ ...current, supportRules: current.supportRules.map((item) => item.id === id ? rule : item) }))
  }

  async function deleteSupportRule(id: string) {
    await supportApiForCurrentSession().deleteSupportRule(id)
    setSupport((current) => ({ ...current, supportRules: current.supportRules.filter((rule) => rule.id !== id) }))
  }

  async function createSupportRequest(draft: SupportRequestDraft) {
    const request = await supportApiForCurrentSession().createSupportRequest(draft)
    setSupport((current) => ({ ...current, supportRequests: [request, ...current.supportRequests] }))
  }

  async function updateSupportRequest(id: string, draft: SupportRequestDraft, status: SupportRequestStatus) {
    const request = await supportApiForCurrentSession().updateSupportRequest(id, draft, status)
    setSupport((current) => ({ ...current, supportRequests: current.supportRequests.map((item) => item.id === id ? request : item) }))
  }

  async function cancelSupportRequest(id: string) {
    const request = await supportApiForCurrentSession().cancelSupportRequest(id)
    setSupport((current) => ({ ...current, supportRequests: current.supportRequests.map((item) => item.id === id ? request : item) }))
  }

  async function createEssentialRequest(draft: EssentialRequestDraft) {
    const request = await supportApiForCurrentSession().createEssentialRequest(draft)
    setEssentialRequests((current) => [request, ...current])
  }

  async function cancelEssentialRequest(id: string) {
    const request = await supportApiForCurrentSession().cancelEssentialRequest(id)
    setEssentialRequests((current) => current.map((item) => item.id === id ? request : item))
  }

  async function syncEssentialRequest(id: string) {
    await supportApiForCurrentSession().syncEssentialRequest(id)
    const request = await supportApiForCurrentSession().getEssentialRequest(id)
    setEssentialRequests((current) => current.map((item) => item.id === id ? request : item))
  }

  async function convertRequestToDraft(id: string) {
    const draft = await supportApiForCurrentSession().convertRequestToDraft(id)
    setSupport((current) => ({ ...current, supportDrafts: [draft, ...current.supportDrafts], supportRequests: current.supportRequests.map((item) => item.id === id ? { ...item, status: 'prepared' } : item) }))
  }

  async function createSupportDraft(input: SupportDraftInput) {
    const draft = await supportApiForCurrentSession().createSupportDraft(input)
    setSupport((current) => ({ ...current, supportDrafts: [draft, ...current.supportDrafts] }))
  }

  async function updateSupportDraft(id: string, input: SupportDraftInput) {
    const draft = await supportApiForCurrentSession().updateSupportDraft(id, input)
    setSupport((current) => ({ ...current, supportDrafts: current.supportDrafts.map((item) => item.id === id ? draft : item) }))
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
    const address = session?.walletAddress
    if (!address || !navigator.clipboard) return
    void navigator.clipboard.writeText(address).catch(() => setAuthError('Your browser could not copy the address. Please try again.'))
  }

  function navigate(next: AppDestination) {
    if (next === 'contacts') {
      openContacts('list')
      return
    }
    setSupportContactId(undefined)
    setDestination(next)
  }

  function openContacts(view: 'list' | 'add' | 'detail' = 'list', id?: string) {
    setContactIntent({ view, id, returnTo: destination === 'contacts' ? contactIntent.returnTo : destination })
    setDestination('contacts')
  }

  function toggleBalances() {
    if (!session) return
    const next = !hideBalances
    preferencesStore.save({ ...preferencesStore.get(session.userId), hideBalances: next })
    setHideBalances(next)
  }

  // Munus Live is a public proof page: no session, no onboarding gate.
  if (readLiveRoute()) {
    return <LivePage apiBaseUrl={munusConfig.apiBaseUrl} />
  }

  const publicRequestId = readPublicRequestId()
  if (publicRequestId) {
    return <PublicRequestPage
      apiBaseUrl={munusConfig.apiBaseUrl}
      publicRequestId={publicRequestId}
      session={session}
      onSignIn={() => void signIn()}
      onContinueToPay={() => {
        window.history.replaceState(null, '', '/')
        navigate('pay')
      }}
    />
  }

  if (authHydrating) {
    return <main className="page-state" aria-live="polite"><p className="eyebrow">Munus</p><h1>Restoring your account</h1><p>Checking your secure session and profile.</p></main>
  }

  if (session && pinRecord && !unlocked) {
    return <AppLockScreen onSignOut={() => void signOut()} onUnlock={unlock} />
  }

  if (profileLoadError) {
    return <main className="page-state">
      <h1>We could not load your profile</h1><p>{profileLoadError}</p>
      <button className="primary-button" type="button" disabled={authBusy} onClick={() => void retryProfileLoad()}>{authBusy ? 'Checking profile…' : 'Try again'}</button>
      {authError && <p className="inline-error" role="alert">{authError}</p>}
      <button className="quiet-button" type="button" disabled={authBusy} onClick={() => void signOut()}>Sign out</button>
    </main>
  }

  if (!session || !isProfileComplete(profile)) {
    // Connect-first entry. Only the server profile — resolved after signer
    // authentication — can decide whether naming is needed. A username
    // screen before auth would force returning users to retype a name
    // that already exists.
    if (!session && entryStep === 'welcome') {
      return <OnboardingPage onComplete={() => setEntryStep('connect')} />
    }
    if (!session) {
      return <WalletConnectionPage connection={connection} authenticated={Boolean(session)} busy={authBusy} saving={profileSaving} error={authError} onConnect={() => void signIn()} onRetryConnection={retryConnection} onBack={() => { setAuthError(null); setEntryStep('welcome') }} />
    }
    return <NameSetupPage initialName={pendingName} serverError={authError} onBack={() => {
      setAuthError(null)
      if (session) void signOut()
      else setEntryStep('welcome')
    }} onContinue={(name) => {
      setPendingName(name)
      storePendingName(name)
      setAuthError(null)
      if (session) {
        // Post-auth naming saves immediately against the canonical session.
        void finishNameSetup(session, profile, name)
      } else {
        setEntryStep('connect')
      }
    }} />
  }

  let content: ReactNode
  if (destination === 'profile') {
    content = <ProfilePage
      authBusy={authBusy} authError={authError} connection={connection}
      getReadiness={getReadiness}
      getNimRate={paymentApi ? () => paymentApi.getNimRate() : undefined}
      onListAccounts={requestAccounts}
      onCheckBalances={paymentApi && sessionUserId ? (addresses) => paymentApi.listAccountBalances(addresses).then((report) => {
        // Keep the stored set fresh after an explicit diagnostics refresh.
        saveHostAccounts(sessionUserId, addresses)
        void paymentApi.saveWalletAccounts(addresses).catch(() => undefined)
        return report
      }) : undefined}
      onNavigate={navigate} onRemovePin={removePin} onSave={(draft) => saveProfile(draft, 'profile')}
      onSavePin={savePin} onSignIn={() => void signIn()} onSignOut={() => void signOut()}
      pinRecord={pinRecord} profile={profile} session={session} wallet={wallet}
      hideBalances={hideBalances} onToggleBalances={toggleBalances}
      onOpenContacts={() => openContacts('list')} onCopyAddress={copyWalletAddress}
    />
  } else if (destination === 'pay') {
    content = paymentApi ? <PayPage api={paymentApi} connection={connection} defaultPhone={profile.defaultPhone} wallet={wallet} onRefreshWallet={refreshWallet} fallbackNetwork={session?.network} funding={fundingContext} onPaymentSettled={() => void funding.refresh()} /> : null
  } else if (destination === 'pockets') {
    content = <PocketsPage
      authenticated connection={connection} error={planningError} loading={planningLoading}
      onAddAllocation={addPocketAllocation} onArchivePocket={archivePocket} onCreatePocket={createPocket}
      onCreateReminder={createReminder} onCreateSpendRule={createSpendRule} onDeleteReminder={deleteReminder}
      onDeleteSpendRule={deleteSpendRule} onNavigate={navigate} onUpdatePocket={updatePocket}
      onUpdateReminder={updateReminder} onUpdateSpendRule={updateSpendRule}
      pockets={planning.pockets} reminders={planning.reminders} spendRules={planning.spendRules}
    />
  } else if (destination === 'contacts') {
    content = <ContactsPage
      key={`${contactIntent.view}:${contactIntent.id ?? ''}`} contacts={support.contacts} loading={supportLoading} error={supportError}
      initialView={contactIntent.view} initialContactId={contactIntent.id}
      onBack={() => navigate(contactIntent.returnTo)} onCreateContact={createContact} onUpdateContact={updateContact}
      onArchiveContact={archiveContact} onSupportContact={(id) => { setSupportContactId(id); setDestination('support') }}
    />
  } else if (destination === 'support' || destination === 'request') {
    content = supportContactId && supportLoading ? <p role="status">Loading your contact…</p> : <SupportPage
      authenticated connection={connection} contacts={support.contacts} error={supportError} initialMode={destination}
      initialContactId={supportContactId} key={`${destination}:${supportContactId ?? ''}`} loading={supportLoading}
      onOpenContacts={(view) => openContacts(view)} onArchiveContact={archiveContact}
      onCancelSupportRequest={cancelSupportRequest} onConvertRequest={convertRequestToDraft}
      onCreateContact={createContact} onCreateSupportDraft={createSupportDraft} onCreateSupportRequest={createSupportRequest}
      onCreateSupportRule={createSupportRule} onDeleteSupportRule={deleteSupportRule} onNavigate={navigate}
      onUpdateContact={updateContact} onUpdateSupportDraft={updateSupportDraft} onUpdateSupportRequest={updateSupportRequest}
      onUpdateSupportRule={updateSupportRule} supportDrafts={support.supportDrafts} supportRequests={support.supportRequests} supportRules={support.supportRules}
      essentialRequests={essentialRequests} onCreateEssentialRequest={createEssentialRequest}
      onCancelEssentialRequest={cancelEssentialRequest} onSyncEssentialRequest={syncEssentialRequest}
      onListDataPlans={(network: SupportNetwork) => paymentApi?.listDataPlans(network) ?? Promise.resolve([] as DataPlan[])}
    />
  } else if (destination === 'activity') {
    content = paymentApi ? <ActivityPage api={paymentApi} onNavigate={navigate} onPaymentSettled={() => void funding.refresh()} /> : null
  } else {
    content = <HomePage connection={connection} wallet={wallet} profile={profile} hideBalances={hideBalances} fallbackNetwork={session?.network} funding={fundingContext}
      pockets={planning.pockets} reminders={planning.reminders} supportDrafts={support.supportDrafts} supportRequests={support.supportRequests}
      contacts={support.contacts} contactsLoading={supportLoading} contactsError={supportError}
      onNavigate={navigate} onProfile={() => navigate('profile')}
      onOpenContacts={openContacts} />
  }

  const secondary = destination === 'support' || destination === 'request' || destination === 'contacts'
  return <MobileAppShell destination={destination} onNavigate={navigate}
    onBack={secondary ? () => navigate(destination === 'contacts' ? contactIntent.returnTo : 'home') : undefined}>
    {content}
  </MobileAppShell>
}
