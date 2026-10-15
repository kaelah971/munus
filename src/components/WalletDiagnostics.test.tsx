import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
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

  it('shows success state without error rows', () => {
    render(<WalletDiagnostics connection={connection} wallet={availableWallet} sessionWallet="NQ47 1234" />)
    expect(screen.getByText('ok · number')).toBeInTheDocument()
    expect(screen.getAllByText('mainnet')).toHaveLength(2)
    expect(screen.queryByText(/Provider error/)).not.toBeInTheDocument()
  })
})
