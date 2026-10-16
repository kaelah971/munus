import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProfilePage } from './ProfilePage'
import { createProfile, DEFAULT_PROFILE_DRAFT } from '../domain/profile'
import type { MunusSession } from '../domain/auth'

const session: MunusSession = { id: 'session', userId: 'ada', walletAddress: 'NQ00 1234 5678 9012 3456 7890 1234 5678 9012', network: 'testnet', issuedAt: 1, expiresAt: 9999999999999, trust: 'server-verified' }
const profile = createProfile('ada', { ...DEFAULT_PROFILE_DRAFT, displayName: 'Ada', defaultPhone: '08012345678', defaultNetwork: 'MTN' })
function props() {
  return { connection: { status: 'ready' as const, accounts: [session.walletAddress] }, session, profile, pinRecord: null, onNavigate: vi.fn(), onSignIn: vi.fn(), onSignOut: vi.fn(), onSave: vi.fn(), onSavePin: vi.fn(), onRemovePin: vi.fn(), onToggleBalances: vi.fn(), onOpenContacts: vi.fn(), onCopyAddress: vi.fn() }
}

describe('mobile profile settings', () => {
  it('groups functional settings and routes contacts, balance visibility, copy and sign out', () => {
    const handlers = props()
    render(<ProfilePage {...handlers} />)
    for (const name of ['Identity', 'App settings', 'Wallet', 'People', 'Account']) expect(screen.getByRole('heading', { name })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('switch', { name: 'Hide balances' }))
    fireEvent.click(screen.getByRole('button', { name: 'Saved contacts' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy address' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(handlers.onToggleBalances).toHaveBeenCalledOnce()
    expect(handlers.onOpenContacts).toHaveBeenCalledOnce()
    expect(handlers.onCopyAddress).toHaveBeenCalledOnce()
    expect(handlers.onSignOut).toHaveBeenCalledOnce()
    expect(screen.getByText('Testnet')).toBeInTheDocument()
    expect(screen.queryByText(/Notifications/)).not.toBeInTheDocument()
  })

  it('keeps optional profile fields when editing the name', async () => {
    const handlers = props()
    render(<ProfilePage {...handlers} hideBalances />)
    expect(screen.getByRole('switch', { name: 'Hide balances' })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Edit profile' }))
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Ada Jane' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(handlers.onSave).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Ada Jane', defaultPhone: '08012345678', defaultNetwork: 'MTN' })))
    await waitFor(() => expect(screen.queryByLabelText('Display name')).not.toBeInTheDocument())
  })

  it('shows production readiness from the authenticated loader only', async () => {
    const report = {
      network: 'mainnet',
      database: 'ready',
      nimReceiver: true,
      nimiqRpc: true,
      clubKonnect: true,
      clubKonnectCallback: true,
      paycrest: false,
      polygonUsdt: false,
      rails: {
        airtime: { status: 'configured', reason: 'Connected — awaiting smoke.' },
        data: { status: 'configured', reason: 'Connected — awaiting smoke.' },
        cashout: { status: 'unavailable', reason: 'Cash out is not configured.' },
      },
    }
    const getReadiness = vi.fn().mockResolvedValue(report)
    render(<ProfilePage {...props()} getReadiness={getReadiness} />)
    expect(await screen.findByRole('heading', { name: 'Production readiness' })).toBeInTheDocument()
    expect(await screen.findByText('Ready')).toBeInTheDocument()
    expect(screen.getByText('Mainnet')).toBeInTheDocument()
    expect(screen.getByText('Configured + callback')).toBeInTheDocument()
    expect(screen.getAllByText('configured')).toHaveLength(2)
    expect(screen.getByText('unavailable')).toBeInTheDocument()
    expect(getReadiness).toHaveBeenCalledOnce()
    expect(document.body.textContent).not.toMatch(/sk-|secret|DATABASE_URL/i)
  })

  it('hides readiness without a session and reports loader failure truthfully', async () => {
    const offline = props()
    render(<ProfilePage {...offline} session={null} getReadiness={vi.fn().mockResolvedValue(null)} />)
    expect(screen.queryByRole('heading', { name: 'Production readiness' })).not.toBeInTheDocument()

    const failing = props()
    const getReadiness = vi.fn().mockRejectedValue(new Error('Offline'))
    render(<ProfilePage {...failing} getReadiness={getReadiness} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Offline')
  })

  it('shows wallet diagnostics for the authenticated session only', async () => {
    const handlers = props()
    const { rerender } = render(<ProfilePage {...handlers} />)
    expect(screen.queryByRole('heading', { name: 'Wallet diagnostics' })).not.toBeInTheDocument()
    rerender(<ProfilePage
      {...handlers}
      wallet={{
        status: 'error',
        address: 'NQ00 1234',
        network: 'unknown',
        error: 'Unknown request.',
        debug: {
          method: 'getBalance',
          addressSource: 'session',
          addressSuffix: '1234',
          addressVariant: 'none',
          ok: false,
          balanceType: 'thrown',
          errorName: 'UNKNOWN_REQUEST',
          errorMessage: 'Unknown request.',
          hostNetworkPresent: false,
        },
      }}
    />)
    expect(await screen.findByRole('heading', { name: 'Wallet diagnostics' })).toBeInTheDocument()
    expect(screen.getByText('…9012')).toBeInTheDocument()
    expect(screen.getByText(/UNKNOWN_REQUEST/)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('NQ00 1234 5678 9012')
  })

  it('retains PIN validation and saves through the existing callback', async () => {
    const handlers = props()
    render(<ProfilePage {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: 'Set a 6-digit app PIN' }))
    fireEvent.change(screen.getByLabelText('New 6-digit PIN'), { target: { value: '123456' } })
    fireEvent.change(screen.getByLabelText('Confirm PIN'), { target: { value: '654321' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enable lock' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter the same 6-digit PIN twice.')
    expect(handlers.onSavePin).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Confirm PIN'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enable lock' }))
    await waitFor(() => expect(handlers.onSavePin).toHaveBeenCalledWith('123456'))
  })

  it('shows NIM rate diagnostics only with a session loader', async () => {
    const handlers = props()
    render(<ProfilePage {...handlers} />)
    expect(screen.queryByRole('heading', { name: 'NIM rate diagnostics' })).not.toBeInTheDocument()

    const getNimRate = vi.fn().mockResolvedValue({
      ngnPerNim: '0.415461',
      source: 'coingecko:nimiq-2/ngn',
      asOf: '2026-10-15T00:00:00.000Z',
      expiresAt: '2026-10-15T00:02:00.000Z',
    })
    render(<ProfilePage {...props()} getNimRate={getNimRate} />)
    expect(await screen.findByRole('heading', { name: 'NIM rate diagnostics' })).toBeInTheDocument()
    expect(await screen.findByText('200 · parsed')).toBeInTheDocument()
    expect(screen.getByText('1 NIM ≈ ₦0.415461')).toBeInTheDocument()
    expect(getNimRate).toHaveBeenCalledOnce()
  })

  it('classifies rate failures without leaking secrets', async () => {
    const getNimRate = vi.fn().mockRejectedValue(new Error('Live NIM rate is unavailable. No quote was created.'))
    render(<ProfilePage {...props()} getNimRate={getNimRate} />)
    expect(await screen.findByText('502 · upstream failed')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Live NIM rate is unavailable.')
  })
})
