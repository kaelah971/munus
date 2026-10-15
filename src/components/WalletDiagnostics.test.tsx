import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { WalletDiagnostics } from './WalletDiagnostics'
import type { NimiqConnectionState, NimiqWalletState } from '../integration/nimiq'

const connection: NimiqConnectionState = { status: 'ready', accounts: ['NQ47 1234 5678 9012'] }
const wallet: NimiqWalletState = {
  status: 'error',
  address: 'NQ47 1234 5678 9012',
  network: 'unknown',
  error: 'Unknown request.',
  debug: {
    method: 'getBalance',
    addressSource: 'session',
    addressSuffix: '9012',
    addressVariant: 'none',
    ok: false,
    balanceType: 'thrown',
    errorName: 'UNKNOWN_REQUEST',
    errorMessage: 'Unknown request.',
    errorCode: 4200,
    hostNetworkPresent: false,
  },
}

const availableWallet: NimiqWalletState = {
  status: 'available',
  address: 'NQ47 1234',
  lunaBalance: 22100000,
  nimBalance: '221',
  network: 'mainnet',
  debug: {
    method: 'getBalance',
    addressSource: 'connected',
    addressSuffix: '1234',
    addressVariant: 'verbatim',
    ok: true,
    balanceType: 'number',
    hostNetworkPresent: true,
    hostNetwork: 'mainnet',
  },
}

describe('WalletDiagnostics', () => {
  it('shows safe diagnostics with suffixes only, never secrets', () => {
    render(<WalletDiagnostics connection={connection} wallet={wallet} sessionWallet="NQ47 1234 5678 9012" />)
    expect(screen.getByText('Initialized')).toBeInTheDocument()
    expect(screen.getByText('…9012')).toBeInTheDocument()
    expect(screen.getByText('session')).toBeInTheDocument()
    expect(screen.getByText('error · thrown')).toBeInTheDocument()
    expect(screen.getByText(/UNKNOWN_REQUEST/)).toBeInTheDocument()
    expect(screen.getByText('Not injected by host')).toBeInTheDocument()
    const text = document.body.textContent ?? ''
    expect(text).not.toContain('NQ47 1234 5678 9012')
    expect(text).not.toContain('cookie')
    expect(text).not.toContain('signature')
  })

  it('lists host accounts only from an explicit tap, never on mount', async () => {
    const onListAccounts = vi.fn().mockResolvedValue(['NQ47 1111 2222 3333', 'NQ48 4444 5555 6666'])
    const onCheckBalances = vi.fn().mockResolvedValue({
      accounts: [
        { suffix: '…3333', ok: true, balanceLuna: '22100000', balanceNim: '221' },
        { suffix: '…6666', ok: true, balanceLuna: '500', balanceNim: '0.005' },
      ],
      aggregateLuna: '22100500',
      aggregateNim: '221.005',
      okCount: 2,
      network: 'mainnet',
    })
    render(<WalletDiagnostics connection={connection} wallet={wallet} sessionWallet="NQ47 1111 2222 3333" onListAccounts={onListAccounts} onCheckBalances={onCheckBalances} />)
    expect(onListAccounts).not.toHaveBeenCalled()
    expect(onCheckBalances).not.toHaveBeenCalled()
    expect(screen.queryByText(/Aggregate exposed/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Check Nimiq Pay accounts' }))
    expect(await screen.findByText('Host accounts')).toBeInTheDocument()
    expect(onCheckBalances).toHaveBeenCalledWith(['NQ47 1111 2222 3333', 'NQ48 4444 5555 6666'])
    expect(await screen.findByText('221 NIM')).toBeInTheDocument()
    expect(screen.getByText('0.005 NIM')).toBeInTheDocument()
    expect(screen.getByText('221.005 NIM')).toBeInTheDocument()
    // Session signer row is marked; full addresses never appear.
    expect(screen.getByText(/…3333.*session signer/)).toBeInTheDocument()
    const text = document.body.textContent ?? ''
    expect(text).not.toContain('NQ47 1111 2222 3333')
    expect(text).not.toContain('NQ48 4444 5555 6666')
  })

  it('reports listing and lookup failures without fabricating accounts', async () => {
    const onListAccounts = vi.fn().mockRejectedValue(new Error('Permission denied.'))
    const { rerender } = render(<WalletDiagnostics connection={connection} wallet={wallet} onListAccounts={onListAccounts} onCheckBalances={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Check Nimiq Pay accounts' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Permission denied.')

    const failingBalances = vi.fn().mockRejectedValue(new Error('RPC down'))
    rerender(<WalletDiagnostics
      connection={connection}
      wallet={wallet}
      onListAccounts={vi.fn().mockResolvedValue(['NQ47 1111'])}
      onCheckBalances={failingBalances}
    />)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('RPC down')
    expect(screen.queryByText(/Aggregate exposed/)).not.toBeInTheDocument()
  })

  it('shows success state without error rows', () => {
    render(<WalletDiagnostics connection={connection} wallet={availableWallet} sessionWallet="NQ47 1234" />)
    expect(screen.getByText('ok · number')).toBeInTheDocument()
    expect(screen.getAllByText('mainnet')).toHaveLength(2)
    expect(screen.queryByText(/Provider error/)).not.toBeInTheDocument()
  })
})
