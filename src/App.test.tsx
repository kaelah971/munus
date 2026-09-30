import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'

vi.mock('./hooks/useNimiq', () => ({
  useNimiq: () => ({
    retry: vi.fn(),
    state: {
      accounts: [],
      status: 'unavailable',
    },
  }),
}))

describe('Munus foundation shell', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('moves from onboarding to Home and Pay Essentials without inventing wallet data', () => {
    render(<App />)

    expect(
      screen.getByRole('heading', { name: /put nim to work in everyday life/i }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /open munus/i }))

    expect(
      screen.getByRole('heading', { name: /what do you need to handle today/i }),
    ).toBeInTheDocument()
    expect(screen.getAllByText('Browser preview')).toHaveLength(2)
    expect(screen.queryByText(/^NQ/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /pay an essential/i }))

    expect(screen.getByRole('heading', { name: 'Pay Essentials' })).toBeInTheDocument()
    expect(screen.getByText('Airtime')).toBeInTheDocument()
    expect(screen.getByText('Data')).toBeInTheDocument()
    expect(screen.getAllByText('Not live')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: /back to home/i }))

    expect(
      screen.getByRole('heading', { name: /what do you need to handle today/i }),
    ).toBeInTheDocument()
  })

  it('opens on Home after onboarding has been completed', () => {
    window.localStorage.setItem('munus:onboarding-complete', 'true')

    render(<App />)

    expect(
      screen.getByRole('heading', { name: /what do you need to handle today/i }),
    ).toBeInTheDocument()
    expect(screen.getByText('Recent receipts')).toBeInTheDocument()
  })
})
