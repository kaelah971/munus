import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PublicRequestPage } from './PublicRequestPage'

function essentialBody(overrides: Record<string, unknown> = {}) {
  return {
    publicRequestId: 'pub-1',
    requesterLabel: 'Kaelah',
    serviceType: 'AIRTIME',
    network: 'MTN',
    requestedAmount: '1000',
    recipientMasked: '080•••5678',
    message: 'Need airtime for work',
    essentialStatus: 'OPEN',
    expiresAt: '2099-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function mockFetch(handler: (url: string, init?: RequestInit) => { status: number; body: unknown }) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
    const { status, body } = handler(String(input), init)
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
  })
}

describe('PublicRequestPage essential needs', () => {
  it('renders a payable need with masked recipient and no secrets', async () => {
    const fetchMock = mockFetch(() => ({ status: 200, body: essentialBody() }))
    render(<PublicRequestPage apiBaseUrl="" publicRequestId="pub-1" session={null} />)

    expect(await screen.findByText('₦1000 MTN airtime')).toBeInTheDocument()
    expect(screen.getByText('080•••5678 · MTN')).toBeInTheDocument()
    expect(screen.getByText('Need airtime for work')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('08012345678')
    fetchMock.mockRestore()
  })

  it('asks unauthenticated visitors to connect before paying', async () => {
    const fetchMock = mockFetch(() => ({ status: 200, body: essentialBody() }))
    const onSignIn = vi.fn()
    render(<PublicRequestPage apiBaseUrl="" publicRequestId="pub-1" session={null} onSignIn={onSignIn} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Connect with Nimiq Pay to pay' }))
    expect(onSignIn).toHaveBeenCalledOnce()
    fetchMock.mockRestore()
  })

  it('claims for the signed-in payer and continues to Pay', async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url.endsWith('/claim') && init?.method === 'POST') {
        return {
          status: 201,
          body: {
            order: { id: 'ord-1', requestedAmount: '1000' },
            request: essentialBody({ essentialStatus: 'PAYMENT_IN_PROGRESS' }),
          },
        }
      }
      return { status: 200, body: essentialBody() }
    })
    const onContinueToPay = vi.fn()
    render(
      <PublicRequestPage
        apiBaseUrl=""
        publicRequestId="pub-1"
        session={{ id: 's', userId: 'user-b', walletAddress: 'NQ07', network: 'mainnet', issuedAt: 0, expiresAt: 0, trust: 'server-verified' }}
        onContinueToPay={onContinueToPay}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Pay this need' }))
    expect(await screen.findByText(/Payment order created/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Pay' }))
    expect(onContinueToPay).toHaveBeenCalledOnce()
    fetchMock.mockRestore()
  })

  it('surfaces an already-paid conflict without claiming twice', async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url.endsWith('/claim')) return { status: 409, body: { error: 'This need is already being paid.' } }
      void init
      return { status: 200, body: essentialBody() }
    })
    render(
      <PublicRequestPage
        apiBaseUrl=""
        publicRequestId="pub-1"
        session={{ id: 's', userId: 'user-b', walletAddress: 'NQ07', network: 'mainnet', issuedAt: 0, expiresAt: 0, trust: 'server-verified' }}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Pay this need' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already being paid')
    fetchMock.mockRestore()
  })

  it('keeps the completed page useful and privacy-safe', async () => {
    const fetchMock = mockFetch(() => ({
      status: 200,
      body: essentialBody({ essentialStatus: 'COMPLETED', fulfilledAt: '2026-02-01T00:00:00.000Z' }),
    }))
    render(<PublicRequestPage apiBaseUrl="" publicRequestId="pub-1" session={null} />)

    expect(await screen.findByText(/This need was paid/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Pay this need|Connect with/ })).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('08012345678')
    fetchMock.mockRestore()
  })

  it('preserves the legacy planning request view', async () => {
    const fetchMock = mockFetch(() => ({
      status: 200,
      body: {
        publicRequestId: 'pub-legacy',
        requesterLabel: 'A Munus user',
        category: 'Airtime',
        requestedAmount: '100',
        requestedProduct: 'Airtime for today',
      },
    }))
    render(<PublicRequestPage apiBaseUrl="" publicRequestId="pub-legacy" session={null} />)
    expect(await screen.findByText('Airtime for today')).toBeInTheDocument()
    fetchMock.mockRestore()
  })
})
