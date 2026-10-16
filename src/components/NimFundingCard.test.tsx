import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NimFundingCard } from './NimFundingCard'
import { buildFundingPreview, buildNimFundingView } from '../domain/funding'
import type { AssetBalanceResult } from '../domain/accountPresentation'

const available = {
  status: 'available',
  asset: 'NIM',
  amount: '221',
  network: 'mainnet',
  environment: 'mainnet',
  accountReference: 'NQ12 3456 7890 1234 5678 9012 3456 7890 1234',
  observedAt: 1,
} as const

function view(balance: AssetBalanceResult = available, estimate: string | null = '442000.00', rateLoading = false) {
  return buildNimFundingView({
    balance,
    estimateNgn: estimate,
    connectionReady: true,
    walletNetwork: 'mainnet',
    hideAmounts: false,
    rateLoading,
  })
}

function preview() {
  const built = buildFundingPreview('22100000', '221', '50500', '0.505')
  if (!built) throw new Error('Fixture preview must build.')
  return built
}

describe('NimFundingCard', () => {
  it('renders balance, estimate, status, network, and masked account', () => {
    render(<NimFundingCard view={view()} />)
    expect(screen.getByText('221 NIM')).toBeInTheDocument()
    expect(screen.getByText('≈ ₦442000.00')).toBeInTheDocument()
    expect(screen.getByText('Connected to Nimiq Pay')).toBeInTheDocument()
    expect(screen.getByText('Mainnet')).toBeInTheDocument()
    expect(screen.getByText('NQ12 •••• 1234')).toBeInTheDocument()
  })

  it('shows a conditional deduction preview without touching the canonical balance', () => {
    render(<NimFundingCard view={view()} deduction={{ preview: preview(), targetLabel: '₦100 Airtime', mode: 'preview' }} />)
    expect(screen.getByText('221 NIM')).toBeInTheDocument()
    expect(screen.getByText(/− 0\.505 NIM/)).toBeInTheDocument()
    expect(screen.getByText('₦100 Airtime')).toBeInTheDocument()
    expect(screen.getByText(/If paid from this connected wallet/)).toBeInTheDocument()
    expect(screen.getByText(/220\.495 NIM left/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('reports shortfalls as information, never as a block', () => {
    const short = buildFundingPreview('10000', '0.1', '50500', '0.505')
    if (!short) throw new Error('Fixture preview must build.')
    render(<NimFundingCard view={view({ ...available, amount: '0.1' })} deduction={{ preview: short, targetLabel: '₦100 Airtime', mode: 'preview' }} />)
    expect(screen.getByText(/0\.405 short/)).toBeInTheDocument()
    expect(screen.getByText(/payment stays available/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText(/disabled|blocked|insufficient/i)).not.toBeInTheDocument()
  })

  it('shows pending deductions distinctly from completed ones', () => {
    render(<NimFundingCard view={view()} deduction={{ preview: preview(), targetLabel: '₦100 Airtime', mode: 'pending' }} />)
    expect(screen.getByText(/0\.505 NIM pending/)).toBeInTheDocument()
    expect(screen.getByText(/Confirming payment/)).toBeInTheDocument()
    expect(screen.getByText(/unchanged until on-chain verification/)).toBeInTheDocument()
    expect(screen.getByText('221 NIM')).toBeInTheDocument()
  })

  it('renders failure states without hiding wallet truth or showing secrets', () => {
    const { rerender } = render(<NimFundingCard view={view({ status: 'error', asset: 'NIM', error: 'boom' })} />)
    expect(screen.getByText('Balance unavailable')).toBeInTheDocument()
    expect(screen.queryByText('boom')).not.toBeInTheDocument()
    rerender(<NimFundingCard view={view()} balanceNote="Balance refresh unavailable — payment remains confirmed." />)
    expect(screen.getByText(/Balance refresh unavailable/)).toBeInTheDocument()
    expect(screen.getByText('221 NIM')).toBeInTheDocument()
  })
})

describe('network provenance', () => {
  const base = {
    balance: { status: 'unavailable', asset: 'NIM' } as const,
    estimateNgn: null,
    connectionReady: true,
    walletNetwork: 'unknown',
    hideAmounts: false,
  }
  it('prefers host truth and labels session fallback explicitly', () => {
    expect(buildNimFundingView({ ...base, walletNetwork: 'mainnet' })).toMatchObject({
      networkText: 'Mainnet',
      networkProvenance: 'host',
    })
    expect(buildNimFundingView({ ...base, fallbackNetwork: 'mainnet' })).toMatchObject({
      networkText: 'Mainnet (session)',
      networkProvenance: 'session',
    })
    expect(buildNimFundingView({ ...base, fallbackNetwork: 'testnet' })).toMatchObject({
      networkText: 'Testnet (session)',
      networkProvenance: 'session',
    })
    expect(buildNimFundingView(base)).toMatchObject({
      networkText: 'Network unavailable',
      networkProvenance: 'none',
    })
  })

  it('marks RPC-attested networks distinctly from host truth', () => {
    const rpcBacked = {
      status: 'available',
      asset: 'NIM',
      amount: '221',
      network: 'mainnet',
      environment: 'mainnet',
      observedAt: 1,
      source: 'rpc',
    } as const
    expect(buildNimFundingView({
      balance: rpcBacked,
      estimateNgn: null,
      connectionReady: true,
      walletNetwork: 'mainnet',
      hideAmounts: false,
    })).toMatchObject({ networkText: 'Mainnet', networkProvenance: 'rpc' })
  })

  it('never substitutes fallback for a known host network', () => {
    expect(
      buildNimFundingView({ ...base, walletNetwork: 'testnet', fallbackNetwork: 'mainnet' }).networkText,
    ).toBe('Testnet')
  })
})

describe('buildNimFundingView', () => {
  it('maps every balance state without inventing values', () => {
    expect(view({ status: 'loading', asset: 'NIM' }).statusText).toBe('Loading balance')
    expect(view({ status: 'unavailable', asset: 'NIM' }).amountText).toBe('—')
    expect(view({ status: 'unavailable', asset: 'NIM' }, null).estimateText).toBe('NGN estimate unavailable')
    const hidden = buildNimFundingView({ balance: available, estimateNgn: '1', connectionReady: true, walletNetwork: 'mainnet', hideAmounts: true })
    expect(hidden.amountText).toBe('••••')
    expect(hidden.estimateText).toBe('NGN estimate hidden')
    expect(view({ ...available }, null).estimateText).toBe('NGN estimate temporarily unavailable')
    expect(view({ ...available }, null, true).estimateText).toBe('Getting current NIM rate…')
    expect(view().networkText).toBe('Mainnet')
  })
})
