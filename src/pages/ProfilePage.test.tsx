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
})
