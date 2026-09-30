import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'

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

describe('Munus account dashboard', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('moves from onboarding to a truthful browser dashboard and durable navigation', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: /put nim to work/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /open munus/i }))

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
})
