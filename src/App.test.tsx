import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { OnboardingPage } from './pages/OnboardingPage'
import { DEFAULT_PROFILE_DRAFT, createProfile } from './domain/profile'

vi.mock('./hooks/useNimiq', () => ({ useNimiq: () => ({ retry: vi.fn(), state: { accounts: [], status: 'unavailable' } }) }))
vi.mock('./hooks/useNimiqWallet', () => ({ useNimiqWallet: () => ({ network: 'unknown', status: 'unavailable' }) }))

beforeEach(() => { window.localStorage.clear(); window.sessionStorage.clear(); window.history.replaceState({}, '', '/') })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/') })

function saveReturningAccount() {
  window.localStorage.setItem('munus:session', JSON.stringify({ id: 'session-1', userId: 'user-1', walletAddress: 'NQ12 3456 7890 1234 5678 9012 3456 7890 1234', network: 'mainnet', issuedAt: Date.now(), expiresAt: Date.now() + 3_600_000, trust: 'development-only-unverified' }))
  window.localStorage.setItem('munus:profile:user-1', JSON.stringify(createProfile('user-1', { ...DEFAULT_PROFILE_DRAFT, displayName: 'Ada' })))
}

describe('compact Munus entry', () => {
  it('contains one action and the exact final guidance line', () => {
    const onComplete = vi.fn()
    const { container } = render(<OnboardingPage onComplete={onComplete} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Keep everyday moving.' })).toBeInTheDocument()
    expect(screen.getByText('Your everyday money, in one place.')).toBeInTheDocument()
    expect(screen.queryByText('NIM first')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Plan it.' })).not.toBeInTheDocument()
    expect(container.querySelector('main')?.textContent?.trim().endsWith('Open inside Nimiq Pay to connect your wallet')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Open Munus' }))
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('retains a usable entry when the decorative photo fails', () => {
    const onComplete = vi.fn()
    const { container } = render(<OnboardingPage onComplete={onComplete} />)
    expect(container.querySelector('img')).toHaveAttribute('alt', '')
    fireEvent.error(container.querySelector('img')!)
    expect(container.querySelector('img')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open Munus' }))
    expect(onComplete).toHaveBeenCalledOnce()
  })

  it('collapses an image which failed before handlers attached', () => {
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true)
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(0)
    const { container } = render(<OnboardingPage onComplete={vi.fn()} />)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByRole('button', { name: 'Open Munus' })).toBeEnabled()
  })

  it('does not let an old onboarding flag bypass name or wallet authentication', () => {
    window.localStorage.setItem('munus:onboarding-complete', 'true')
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Open Munus' }))
    expect(screen.getByRole('heading', { name: 'What should we call you?' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Ada' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('heading', { name: 'Connect your wallet' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect with Nimiq Pay' })).toBeDisabled()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('keeps public requests ahead of private onboarding even with a pending name', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    window.sessionStorage.setItem('munus:pending-name', 'Ada')
    window.history.replaceState({}, '', '/request/public-routing-check')
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Request unavailable' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open Munus' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Connect your wallet' })).not.toBeInTheDocument()
  })
})

describe('personal mobile finance app', () => {
  it('bypasses welcome for a named returning session and retains all five destinations', async () => {
    saveReturningAccount()
    window.sessionStorage.setItem('munus:pending-name', 'Old draft')
    render(<App />)
    expect(window.sessionStorage.getItem('munus:pending-name')).toBeNull()
    expect(screen.getByRole('heading', { name: /Good (morning|afternoon|evening), Ada/ })).toBeInTheDocument()
    expect(screen.getAllByText('NGN estimate unavailable')[0]).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View USDT account' })).toHaveAttribute('aria-pressed', 'false')
    const nav = within(screen.getByRole('navigation', { name: 'Primary navigation' }))
    fireEvent.click(nav.getByRole('button', { name: 'Pay' }))
    expect(screen.getByRole('heading', { name: 'Pay Essentials' })).toBeInTheDocument()
    fireEvent.click(nav.getByRole('button', { name: 'Pockets' }))
    expect(screen.getByRole('heading', { name: 'Life Pockets' })).toBeInTheDocument()
    fireEvent.click(nav.getByRole('button', { name: 'Activity' }))
    expect(screen.getByRole('heading', { name: 'Activity' })).toBeInTheDocument()
    fireEvent.click(nav.getByRole('button', { name: 'Profile' }))
    expect(screen.getByRole('heading', { name: 'Profile & settings' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('switch', { name: 'Hide balances' }))
    fireEvent.click(nav.getByRole('button', { name: 'Home' }))
    expect(screen.getAllByText('NGN estimate hidden').length).toBeGreaterThan(0)
    await waitFor(() => expect(screen.queryByText('Loading contacts…')).not.toBeInTheDocument())
  })

  it('edits the existing profile and signs out to entry', async () => {
    saveReturningAccount()
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Open profile' }))
    expect(screen.getByText('NQ123456…901234')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit profile' }))
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Ada N.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.getByText('Ada N.')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(screen.getByRole('button', { name: 'Open Munus' })).toBeInTheDocument()
  })

  it('shows only one real planning context row and keeps pocket data after refresh', async () => {
    saveReturningAccount()
    const dueAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
    window.localStorage.setItem('munus:planning:user-1', JSON.stringify({ pockets: [{ id: 'pocket-1', userId: 'user-1', name: 'Rent', type: 'Rent', unit: 'NGN', targetAmount: '10000', plannedAmount: '2500', deadline: dueAt, status: 'active', createdAt: dueAt, updatedAt: dueAt }], reminders: [{ id: 'reminder-1', userId: 'user-1', linkedObjectType: 'pocket', linkedObjectId: 'pocket-1', title: 'Review rent plan', dueAt, status: 'open', createdAt: dueAt, updatedAt: dueAt }], spendRules: [] }))
    const first = render(<App />)
    await screen.findByText('Review rent plan')
    expect(screen.queryByText('Rent')).not.toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'Pockets' }))
    expect(screen.getByText('Rent')).toBeInTheDocument()
    expect(screen.getByText('2500 NGN')).toBeInTheDocument()
    first.unmount()
    render(<App />)
    expect(await screen.findByText('Review rent plan')).toBeInTheDocument()
  })

  it('shares contact persistence between Home, list, detail and Support with remembered return', async () => {
    saveReturningAccount()
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Add contact' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Chidi' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '08012345678' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save contact' }))
    fireEvent.click(await screen.findByRole('button', { name: /Chidi.*Saved contact/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Support this person' }))
    expect(screen.getByText('Chidi')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue to review' })).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'Home' }))
    expect(screen.getByRole('button', { name: 'Open contact Chidi' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open profile' }))
    fireEvent.click(screen.getByRole('button', { name: 'Saved contacts' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Back' })[0])
    expect(screen.getByRole('heading', { name: 'Profile & settings' })).toBeInTheDocument()
  })
})
