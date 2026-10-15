import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { DEFAULT_PROFILE_DRAFT, createProfile } from './domain/profile'

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(), requestAccounts: vi.fn(), restoreSession: vi.fn(), signOut: vi.fn(), getProfile: vi.fn(), saveProfile: vi.fn(),
  connection: { status: 'ready', accounts: ['NQ-test-account'] },
}))
vi.mock('./config', () => ({ munusConfig: { productionAuth: true, apiBaseUrl: '', localDevelopmentAuth: false } }))
vi.mock('./auth/session', () => ({ createAuthGateway: () => ({ mode: 'remote', ...mocks }) }))
vi.mock('./persistence/profileApi', () => ({ RemoteProfileApi: class {
  getProfile = mocks.getProfile
  saveProfile = mocks.saveProfile
} }))
vi.mock('./hooks/useNimiq', () => ({ useNimiq: () => ({ state: mocks.connection, retry: vi.fn(), requestAccounts: mocks.requestAccounts }) }))
vi.mock('./hooks/useNimiqWallet', () => ({ useNimiqWallet: () => ({ state: { status: 'zero', nimBalance: '0', network: 'mainnet' }, refreshWallet: vi.fn() }) }))
vi.mock('./persistence/planningApi', () => ({ RemotePlanningApi: class { async load() { return { pockets: [], reminders: [], spendRules: [] } } } }))
vi.mock('./persistence/supportApi', () => ({ RemoteSupportApi: class { async load() { return { contacts: [], supportRules: [], supportRequests: [], supportDrafts: [] } } } }))

const session = { id: 'verified-session', userId: 'user-1', walletAddress: 'NQ-test-account', network: 'mainnet', issuedAt: Date.now(), expiresAt: Date.now() + 3_600_000, trust: 'server-verified' }
const profile = createProfile('user-1', { ...DEFAULT_PROFILE_DRAFT, displayName: 'Ada', defaultPhone: '08012345678', defaultNetwork: 'MTN' })

async function openConnect() {
  await screen.findByRole('button', { name: 'Open Munus' })
  fireEvent.click(screen.getByRole('button', { name: 'Open Munus' }))
  expect(await screen.findByRole('heading', { name: 'Connect your wallet' })).toBeInTheDocument()
}

async function connectWallet() {
  fireEvent.click(screen.getByRole('button', { name: 'Connect with Nimiq Pay' }))
}

async function typeName(name = 'Ada') {
  fireEvent.change(await screen.findByLabelText('Your name'), { target: { value: name } })
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
}

describe('authenticated connect-first entry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.history.replaceState({}, '', '/')
    mocks.restoreSession.mockResolvedValue(null)
    mocks.requestAccounts.mockResolvedValue(['NQ-test-account'])
    mocks.signIn.mockResolvedValue(session)
    mocks.signOut.mockResolvedValue(undefined)
    mocks.getProfile.mockResolvedValue(null)
    mocks.saveProfile.mockResolvedValue(profile)
    mocks.connection.status = 'ready'
    mocks.connection.accounts = ['NQ-test-account']
  })

  it('connects before naming, then saves once before exposing Home', async () => {
    render(<App />)
    await openConnect()
    // No username screen before authentication: nothing to name yet.
    expect(screen.queryByRole('heading', { name: 'What should we call you?' })).not.toBeInTheDocument()
    expect(mocks.requestAccounts).not.toHaveBeenCalled()
    expect(mocks.signIn).not.toHaveBeenCalled()
    await connectWallet()
    expect(mocks.requestAccounts).toHaveBeenCalledOnce()
    await typeName()
    expect(await screen.findByRole('heading', { name: /Good (morning|afternoon|evening), Ada/ })).toBeInTheDocument()
    expect(mocks.saveProfile).toHaveBeenCalledWith({ ...DEFAULT_PROFILE_DRAFT, displayName: 'Ada' })
    expect(window.sessionStorage.getItem('munus:pending-name')).toBeNull()
  })

  it('validates the name after authentication and retries the save without another signature', async () => {
    mocks.saveProfile.mockRejectedValueOnce(new Error('Could not save your profile'))
    render(<App />)
    await openConnect()
    await connectWallet()
    await typeName('A')
    expect(screen.getByRole('alert')).toHaveTextContent('at least two characters')
    expect(mocks.saveProfile).not.toHaveBeenCalled()
    await typeName()
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save your profile')
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(mocks.signIn).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: /Good .*Ada/ })
    expect(mocks.saveProfile).toHaveBeenCalledTimes(2)
  })

  it('keeps the connect screen after cancellation and retries only on another explicit action', async () => {
    mocks.signIn.mockRejectedValueOnce(new Error('Signature cancelled'))
    render(<App />)
    await openConnect()
    await connectWallet()
    expect(await screen.findByRole('alert')).toHaveTextContent('Signature cancelled')
    expect(mocks.saveProfile).not.toHaveBeenCalled()
    await connectWallet()
    await typeName()
    await screen.findByRole('heading', { name: /Good .*Ada/ })
    expect(mocks.signIn).toHaveBeenCalledTimes(2)
  })

  it('keeps the connect screen after permission rejection and retries only on another explicit action', async () => {
    mocks.requestAccounts.mockRejectedValueOnce(new Error('Nimiq Pay permission was cancelled.'))
    render(<App />)
    await openConnect()
    await connectWallet()
    expect(await screen.findByRole('alert')).toHaveTextContent('Nimiq Pay permission was cancelled.')
    expect(screen.getByRole('heading', { name: 'Connect your wallet' })).toBeInTheDocument()
    expect(mocks.requestAccounts).toHaveBeenCalledOnce()
    expect(mocks.signIn).not.toHaveBeenCalled()
    await connectWallet()
    await typeName()
    await screen.findByRole('heading', { name: /Good .*Ada/ })
    expect(mocks.requestAccounts).toHaveBeenCalledTimes(2)
    expect(mocks.signIn).toHaveBeenCalledOnce()
  })

  it('never shows the username screen when the server already has the profile', async () => {
    mocks.getProfile.mockResolvedValue(profile)
    render(<App />)
    await openConnect()
    await connectWallet()
    await screen.findByRole('heading', { name: /Good .*Ada/ })
    expect(mocks.saveProfile).not.toHaveBeenCalled()
    expect(window.sessionStorage.getItem('munus:pending-name')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'What should we call you?' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Your name')).not.toBeInTheDocument()
  })

  it('always enters through landing without a session', async () => {
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Open Munus' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Connect your wallet' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'What should we call you?' })).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(mocks.signIn).not.toHaveBeenCalled()
    expect(mocks.requestAccounts).not.toHaveBeenCalled()
  })

  it('lands first for an expired session, then skips naming for an existing profile', async () => {
    window.localStorage.setItem('munus:onboarding-complete', 'true')
    mocks.getProfile.mockResolvedValue(profile)
    render(<App />)
    // Even with a stale local flag, entry starts at landing — never connect.
    await screen.findByRole('button', { name: 'Open Munus' })
    expect(screen.queryByRole('heading', { name: 'Connect your wallet' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open Munus' }))
    expect(await screen.findByRole('heading', { name: 'Connect your wallet' })).toBeInTheDocument()
    await connectWallet()
    await screen.findByRole('heading', { name: /Good .*Ada/ })
    expect(mocks.signIn).toHaveBeenCalledOnce()
    expect(mocks.saveProfile).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: 'What should we call you?' })).not.toBeInTheDocument()
  })

  it('does not replace an existing profile when fetching it fails', async () => {
    mocks.getProfile.mockRejectedValueOnce(new Error('Profile service unavailable'))
    render(<App />)
    await openConnect()
    await connectWallet()
    await screen.findByRole('heading', { name: 'We could not load your profile' })
    expect(mocks.saveProfile).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: 'What should we call you?' })).not.toBeInTheDocument()
    mocks.getProfile.mockResolvedValue(profile)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByRole('heading', { name: /Good .*Ada/ })
    expect(mocks.signIn).toHaveBeenCalledTimes(1)
  })

  it('bypasses welcome and setup for a restored authenticated named profile', async () => {
    mocks.restoreSession.mockResolvedValue(session)
    mocks.getProfile.mockResolvedValue(profile)
    render(<App />)
    await screen.findByRole('heading', { name: /Good .*Ada/ })
    expect(screen.queryByRole('button', { name: 'Open Munus' })).not.toBeInTheDocument()
    expect(mocks.requestAccounts).not.toHaveBeenCalled()
    expect(mocks.signIn).not.toHaveBeenCalled()
  })

  it('never flashes onboarding while the session restore is still loading', async () => {
    let resolveSession!: (value: typeof session | null) => void
    mocks.restoreSession.mockReturnValue(new Promise((resolve) => { resolveSession = resolve }))
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Restoring your account' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open Munus' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Connect your wallet' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'What should we call you?' })).not.toBeInTheDocument()
    expect(mocks.signIn).not.toHaveBeenCalled()
    mocks.getProfile.mockResolvedValue(profile)
    await act(async () => { resolveSession(session) })
    await screen.findByRole('heading', { name: /Good .*Ada/ })
  })

  it('recognizes a valid session across reload without onboarding', async () => {
    mocks.restoreSession.mockResolvedValue(session)
    mocks.getProfile.mockResolvedValue(profile)
    const first = render(<App />)
    await screen.findByRole('heading', { name: /Good .*Ada/ })
    expect(screen.queryByRole('button', { name: 'Open Munus' })).not.toBeInTheDocument()
    first.unmount()
    render(<App />)
    await screen.findByRole('heading', { name: /Good .*Ada/ })
    expect(screen.queryByRole('button', { name: 'Open Munus' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'What should we call you?' })).not.toBeInTheDocument()
    expect(mocks.signIn).not.toHaveBeenCalled()
    expect(mocks.requestAccounts).not.toHaveBeenCalled()
  })

  it('keeps the existing PIN security gate ahead of returning-user bypass', async () => {
    mocks.restoreSession.mockResolvedValue(session)
    mocks.getProfile.mockResolvedValue(profile)
    window.localStorage.setItem('munus:pin:user-1', JSON.stringify({ salt: 'test-salt', hash: 'test-hash' }))
    window.sessionStorage.setItem('munus:pending-name', 'Old draft')
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Unlock Munus' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(mocks.saveProfile).not.toHaveBeenCalled()
    expect(window.sessionStorage.getItem('munus:pending-name')).toBeNull()
  })

  it('ignores a profile response from an account which signed out at its PIN gate', async () => {
    let resolveProfile!: (value: typeof profile) => void
    mocks.getProfile.mockReturnValue(new Promise((resolve) => { resolveProfile = resolve }))
    window.localStorage.setItem('munus:pin:user-1', JSON.stringify({ salt: 'test-salt', hash: 'test-hash' }))
    render(<App />)
    await openConnect()
    await connectWallet()
    await screen.findByRole('button', { name: 'Unlock Munus' })
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await screen.findByRole('button', { name: 'Open Munus' })
    resolveProfile(profile)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open Munus' })).toBeInTheDocument())
    expect(mocks.saveProfile).not.toHaveBeenCalled()
  })

  it('does not let an old request clear a new connection’s busy state', async () => {
    let resolveOldProfile!: (value: typeof profile) => void
    let resolveNewSession!: (value: typeof session) => void
    mocks.getProfile.mockReturnValueOnce(new Promise((resolve) => { resolveOldProfile = resolve })).mockResolvedValue(profile)
    window.localStorage.setItem('munus:pin:user-1', JSON.stringify({ salt: 'test-salt', hash: 'test-hash' }))
    render(<App />)
    await openConnect()
    await connectWallet()
    await screen.findByRole('button', { name: 'Unlock Munus' })
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await screen.findByRole('button', { name: 'Open Munus' })
    window.localStorage.removeItem('munus:pin:user-1')
    mocks.signIn.mockReturnValueOnce(new Promise((resolve) => { resolveNewSession = resolve }))
    await openConnect()
    await connectWallet()
    expect(screen.getByRole('button', { name: 'Connecting…' })).toBeDisabled()
    await act(async () => { resolveOldProfile(profile) })
    expect(screen.getByRole('button', { name: 'Connecting…' })).toBeDisabled()
    await act(async () => { resolveNewSession(session) })
    await screen.findByRole('heading', { name: /Good .*Ada/ })
  })

  it('recovers a missing name on a restored profile while preserving optional settings', async () => {
    mocks.restoreSession.mockResolvedValue(session)
    mocks.getProfile.mockResolvedValue({ ...profile, displayName: '' })
    render(<App />)
    await screen.findByRole('heading', { name: 'What should we call you?' })
    await typeName()
    await screen.findByRole('heading', { name: /Good .*Ada/ })
    expect(mocks.saveProfile).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Ada', defaultPhone: '08012345678', defaultNetwork: 'MTN' }))
    expect(mocks.signIn).not.toHaveBeenCalled()
  })

  it('truthfully keeps standalone users outside the app', async () => {
    mocks.connection.status = 'unavailable'
    mocks.connection.accounts = []
    render(<App />)
    await openConnect()
    expect(screen.getByText('Open inside Nimiq Pay to connect your wallet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect with Nimiq Pay' })).toBeDisabled()
    await waitFor(() => expect(mocks.signIn).not.toHaveBeenCalled())
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })
})
