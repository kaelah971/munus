import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { DEFAULT_PROFILE_DRAFT, createProfile } from './domain/profile'

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(), restoreSession: vi.fn(), signOut: vi.fn(), getProfile: vi.fn(), saveProfile: vi.fn(),
  connection: { status: 'ready', accounts: ['NQ-test-account'] },
}))
vi.mock('./config', () => ({ munusConfig: { productionAuth: true, apiBaseUrl: '', localDevelopmentAuth: false } }))
vi.mock('./auth/session', () => ({ createAuthGateway: () => ({ mode: 'remote', ...mocks }) }))
vi.mock('./persistence/profileApi', () => ({ RemoteProfileApi: class {
  getProfile = mocks.getProfile
  saveProfile = mocks.saveProfile
} }))
vi.mock('./hooks/useNimiq', () => ({ useNimiq: () => ({ state: mocks.connection, retry: vi.fn() }) }))
vi.mock('./hooks/useNimiqWallet', () => ({ useNimiqWallet: () => ({ status: 'zero', nimBalance: '0', network: 'mainnet' }) }))
vi.mock('./persistence/planningApi', () => ({ RemotePlanningApi: class { async load() { return { pockets: [], reminders: [], spendRules: [] } } } }))
vi.mock('./persistence/supportApi', () => ({ RemoteSupportApi: class { async load() { return { contacts: [], supportRules: [], supportRequests: [], supportDrafts: [] } } } }))

const session = { id: 'verified-session', userId: 'user-1', walletAddress: 'NQ-test-account', network: 'mainnet', issuedAt: Date.now(), expiresAt: Date.now() + 3_600_000, trust: 'server-verified' }
const profile = createProfile('user-1', { ...DEFAULT_PROFILE_DRAFT, displayName: 'Ada', defaultPhone: '08012345678', defaultNetwork: 'MTN' })

async function enterName(name = 'Ada') {
  await screen.findByRole('button', { name: 'Open Munus' })
  fireEvent.click(screen.getByRole('button', { name: 'Open Munus' }))
  fireEvent.change(screen.getByLabelText('Your name'), { target: { value: name } })
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
}

describe('authenticated name-first entry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.history.replaceState({}, '', '/')
    mocks.restoreSession.mockResolvedValue(null)
    mocks.signIn.mockResolvedValue(session)
    mocks.signOut.mockResolvedValue(undefined)
    mocks.getProfile.mockResolvedValue(null)
    mocks.saveProfile.mockResolvedValue(profile)
    mocks.connection.status = 'ready'
    mocks.connection.accounts = ['NQ-test-account']
  })

  it('advances entry to name and connect without authenticating, then saves before exposing Home', async () => {
    render(<App />)
    await enterName()
    expect(screen.getByRole('heading', { name: 'Connect your wallet' })).toBeInTheDocument()
    expect(mocks.signIn).not.toHaveBeenCalled()
    expect(window.localStorage.getItem('munus:onboarding-complete')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Connect with Nimiq Pay' }))
    expect(await screen.findByRole('heading', { name: /Good (morning|afternoon|evening), Ada/ })).toBeInTheDocument()
    expect(mocks.saveProfile).toHaveBeenCalledWith({ ...DEFAULT_PROFILE_DRAFT, displayName: 'Ada' })
    expect(window.sessionStorage.getItem('munus:pending-name')).toBeNull()
    expect(window.localStorage.getItem('munus:onboarding-complete')).toBe('true')
  })

  it('validates the name and preserves the pending name across reload without a permanent profile', async () => {
    const first = render(<App />)
    await enterName('A')
    expect(screen.getByRole('alert')).toHaveTextContent('at least two characters')
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Ada' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    first.unmount()
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Connect your wallet' })).toBeInTheDocument()
    expect(mocks.signIn).not.toHaveBeenCalled()
    expect(window.localStorage.getItem('munus:profile:user-1')).toBeNull()
  })

  it('keeps the name after cancellation and retries only on another explicit action', async () => {
    mocks.signIn.mockRejectedValueOnce(new Error('Signature cancelled'))
    render(<App />)
    await enterName()
    fireEvent.click(screen.getByRole('button', { name: 'Connect with Nimiq Pay' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Signature cancelled')
    expect(mocks.saveProfile).not.toHaveBeenCalled()
    expect(window.sessionStorage.getItem('munus:pending-name')).toBe('Ada')
    fireEvent.click(screen.getByRole('button', { name: 'Connect with Nimiq Pay' }))
    await screen.findByRole('heading', { name: /Good .*Ada/ })
    expect(mocks.signIn).toHaveBeenCalledTimes(2)
  })

  it('preserves an existing authenticated name and optional fields over a pending name', async () => {
    mocks.getProfile.mockResolvedValue(profile)
    render(<App />)
    await enterName('Replacement')
    fireEvent.click(screen.getByRole('button', { name: 'Connect with Nimiq Pay' }))
    await screen.findByRole('heading', { name: /Good .*Ada/ })
    expect(mocks.saveProfile).not.toHaveBeenCalled()
    expect(window.sessionStorage.getItem('munus:pending-name')).toBeNull()
  })

  it('holds the dashboard until profile save succeeds and retries without another signature', async () => {
    mocks.saveProfile.mockRejectedValueOnce(new Error('Could not save your profile'))
    render(<App />)
    await enterName()
    fireEvent.click(screen.getByRole('button', { name: 'Connect with Nimiq Pay' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save your profile')
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save and open Munus' }))
    await screen.findByRole('heading', { name: /Good .*Ada/ })
    expect(mocks.signIn).toHaveBeenCalledTimes(1)
    expect(mocks.saveProfile).toHaveBeenCalledTimes(2)
  })

  it('does not replace an existing profile when fetching it fails', async () => {
    mocks.getProfile.mockRejectedValueOnce(new Error('Profile service unavailable'))
    render(<App />)
    await enterName()
    fireEvent.click(screen.getByRole('button', { name: 'Connect with Nimiq Pay' }))
    await screen.findByRole('heading', { name: 'We could not load your profile' })
    expect(mocks.saveProfile).not.toHaveBeenCalled()
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
    expect(mocks.signIn).not.toHaveBeenCalled()
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
    await enterName()
    fireEvent.click(screen.getByRole('button', { name: 'Connect with Nimiq Pay' }))
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
    await enterName()
    fireEvent.click(screen.getByRole('button', { name: 'Connect with Nimiq Pay' }))
    await screen.findByRole('button', { name: 'Unlock Munus' })
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await screen.findByRole('button', { name: 'Open Munus' })
    window.localStorage.removeItem('munus:pin:user-1')
    mocks.signIn.mockReturnValueOnce(new Promise((resolve) => { resolveNewSession = resolve }))
    await enterName()
    fireEvent.click(screen.getByRole('button', { name: 'Connect with Nimiq Pay' }))
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
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Ada' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save and open Munus' }))
    await screen.findByRole('heading', { name: /Good .*Ada/ })
    expect(mocks.saveProfile).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Ada', defaultPhone: '08012345678', defaultNetwork: 'MTN' }))
    expect(mocks.signIn).not.toHaveBeenCalled()
  })

  it('truthfully keeps standalone users outside the app', async () => {
    mocks.connection.status = 'unavailable'
    mocks.connection.accounts = []
    render(<App />)
    await enterName()
    expect(screen.getByText('Open inside Nimiq Pay to connect your wallet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect with Nimiq Pay' })).toBeDisabled()
    await waitFor(() => expect(mocks.signIn).not.toHaveBeenCalled())
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })
})
