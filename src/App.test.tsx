import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { OnboardingPage } from './pages/OnboardingPage'

vi.mock('./hooks/useNimiq', () => ({
  useNimiq: () => ({
    retry: vi.fn(),
    state: { accounts: [], status: 'unavailable' },
  }),
}))

vi.mock('./hooks/useNimiqWallet', () => ({
  useNimiqWallet: () => ({
    network: 'unknown',
    status: 'unavailable',
  }),
}))

describe('Munus landing entry', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    window.history.replaceState({}, '', '/')
  })

  it('presents the launch story and sends both actions to the existing callback', () => {
    const onComplete = vi.fn()
    render(<OnboardingPage onComplete={onComplete} />)

    expect(screen.getByRole('heading', { level: 1, name: 'Keep everyday moving.' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Plan it.' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Pay it.' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Prove it.' })).toBeInTheDocument()
    expect(screen.getByText('Open inside Nimiq Pay to connect your wallet.')).toBeInTheDocument()
    const actions = screen.getAllByRole('button', { name: 'Open Munus' })
    expect(actions).toHaveLength(2)
    actions.forEach((action) => fireEvent.click(action))
    expect(onComplete).toHaveBeenCalledTimes(2)
  })

  it.each(['nimiqPay', 'nimiq'])('hides standalone guidance when the %s host is injected', (hostKey) => {
    vi.stubGlobal(hostKey, {})
    render(<OnboardingPage onComplete={vi.fn()} />)

    expect(screen.queryByText('Open inside Nimiq Pay to connect your wallet.')).not.toBeInTheDocument()
  })

  it('keeps both entry actions usable when the hero fails', () => {
    const onComplete = vi.fn()
    const { container } = render(<OnboardingPage onComplete={onComplete} />)
    const hero = container.querySelector('img')
    expect(hero).not.toBeNull()
    expect(hero).toHaveAttribute('alt', '')
    fireEvent.error(hero!)

    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: 'Keep everyday moving.' })).toBeInTheDocument()
    screen.getAllByRole('button', { name: 'Open Munus' }).forEach((action) => fireEvent.click(action))
    expect(onComplete).toHaveBeenCalledTimes(2)
  })

  it('collapses a hero that already failed before its handlers attach', () => {
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true)
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(0)
    const { container } = render(<OnboardingPage onComplete={vi.fn()} />)

    expect(container.querySelector('img')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Open Munus' })).toHaveLength(2)
  })

  it.each([0, 1])('persists entry through CTA %i and bypasses landing on the next visit', (ctaIndex) => {
    const firstVisit = render(<App />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Open Munus' })[ctaIndex])

    expect(window.localStorage.getItem('munus:onboarding-complete')).toBe('true')
    expect(screen.getByRole('heading', { name: /your everyday money/i })).toBeInTheDocument()
    firstVisit.unmount()
    render(<App />)
    expect(screen.queryByRole('heading', { name: 'Keep everyday moving.' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /your everyday money/i })).toBeInTheDocument()
  })

  it('opens a public request before onboarding for a first-time visitor', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    window.history.replaceState({}, '', '/request/landing-routing-check')
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Request unavailable' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Keep everyday moving.' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open Munus' })).not.toBeInTheDocument()
    expect(window.localStorage.getItem('munus:onboarding-complete')).toBeNull()
  })
})

describe('Munus account dashboard', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('moves from onboarding to a truthful browser dashboard and durable navigation', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Keep everyday moving.' })).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Open Munus' })[0])

    expect(screen.getByRole('heading', { name: /your everyday money/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Available NIM' })).toBeInTheDocument()
    expect(screen.getByText('Not available')).toBeInTheDocument()
    expect(screen.getByText('Wallet unavailable')).toBeInTheDocument()
    expect(screen.queryByText(/^NQ/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Pay' })[0])
    expect(screen.getByRole('heading', { name: 'Pay Essentials' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Pockets' }))
    expect(screen.getByRole('heading', { name: 'Life Pockets' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Activity' }))
    expect(screen.getByRole('heading', { name: 'Activity' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Profile' }))
    expect(screen.getByRole('heading', { name: 'Profile & settings' })).toBeInTheDocument()
    expect(screen.getByText(/connect your munus account/i)).toBeInTheDocument()
  })

  it('loads a returning local profile without fabricating wallet state', () => {
    window.localStorage.setItem('munus:onboarding-complete', 'true')
    window.localStorage.setItem(
      'munus:session',
      JSON.stringify({
        id: 'session-1',
        userId: 'user-1',
        walletAddress: 'NQ12 3456 7890 1234 5678 9012 3456 7890 1234',
        network: 'mainnet',
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        trust: 'development-only-unverified',
      }),
    )
    window.localStorage.setItem(
      'munus:profile:user-1',
      JSON.stringify({
        userId: 'user-1',
        displayName: 'Ada',
        country: 'NG',
        localCurrency: 'NGN',
        preferredPaymentAsset: 'NIM',
        language: 'en',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    )

    render(<App />)

    expect(screen.getByRole('heading', { name: /good to see you, ada/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open profile' }))
    expect(screen.getByText('Ada')).toBeInTheDocument()
    expect(screen.getByText('Connected address')).toBeInTheDocument()
    expect(screen.getByText('NQ123456…901234')).toBeInTheDocument()
    expect(screen.queryByText('NQ12 3456 7890 1234 5678 9012 3456 7890 1234')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Ada N.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(screen.getByRole('heading', { name: 'Profile & settings' })).toBeInTheDocument()
    expect(screen.getByText('Ada N.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /sign out of munus/i }))
    expect(screen.getByRole('heading', { name: /your everyday money/i })).toBeInTheDocument()
    expect(screen.getByText(/set up your munus account/i)).toBeInTheDocument()
  })

  it('renders persisted pocket and due-soon planning context after refresh', async () => {
    const dueAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
    window.localStorage.setItem('munus:onboarding-complete', 'true')
    window.localStorage.setItem('munus:session', JSON.stringify({
      id: 'session-1',
      userId: 'user-1',
      walletAddress: 'NQ12 3456 7890 1234 5678 9012 3456 7890 1234',
      network: 'mainnet',
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      trust: 'development-only-unverified',
    }))
    window.localStorage.setItem('munus:profile:user-1', JSON.stringify({
      userId: 'user-1',
      displayName: 'Ada',
      country: 'NG',
      localCurrency: 'NGN',
      preferredPaymentAsset: 'NIM',
      language: 'en',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }))
    window.localStorage.setItem('munus:planning:user-1', JSON.stringify({
      pockets: [{ id: 'pocket-1', userId: 'user-1', name: 'Rent', type: 'Rent', unit: 'NGN', targetAmount: '10000', plannedAmount: '2500', deadline: dueAt, status: 'active', createdAt: dueAt, updatedAt: dueAt }],
      reminders: [{ id: 'reminder-1', userId: 'user-1', linkedObjectType: 'pocket', linkedObjectId: 'pocket-1', title: 'Review rent plan', dueAt, status: 'open', createdAt: dueAt, updatedAt: dueAt }],
      spendRules: [],
    }))

    const first = render(<App />)
    await waitFor(() => expect(screen.getByText('Rent')).toBeInTheDocument())
    expect(screen.getByText('Review rent plan')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Pockets' }))
    expect(screen.getByRole('heading', { name: 'Life Pockets' })).toBeInTheDocument()
    expect(screen.getByText('2500 NGN')).toBeInTheDocument()

    first.unmount()
    render(<App />)
    await waitFor(() => expect(screen.getByText('Rent')).toBeInTheDocument())
    expect(screen.getByText('Review rent plan')).toBeInTheDocument()
  })
})
