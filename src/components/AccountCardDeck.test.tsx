import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountCardDeck } from './AccountCardDeck'
import { configureNimRateFetcher, nimRateStore } from '../hooks/useNimRate'
import type { NimiqConnectionState, NimiqWalletState } from '../integration/nimiq'
import type { AccountDataSources } from '../domain/accountPresentation'

const address = 'NQ12 3456 7890 1234 5678 9012 3456 7890 1234'
const connection: NimiqConnectionState = { status: 'ready', accounts: [address] }
const wallet: NimiqWalletState = { status: 'zero', nimBalance: '0', address, network: 'mainnet' }

function usdtSources(): AccountDataSources {
  return {
    readUsdtBalance: vi.fn().mockResolvedValue({ status: 'unavailable', asset: 'USDT' }),
    getNgnQuote: vi.fn().mockResolvedValue({ status: 'unavailable' }),
  }
}

function configureRate(ngnPerNim: string) {
  // Observation precedes display, exactly as in production: capture the
  // timestamps now so asOf always predates the component mount below.
  const observedAt = Date.now()
  configureNimRateFetcher(async () => ({
    ngnPerNim,
    source: 'Fixture',
    asOf: new Date(observedAt).toISOString(),
    expiresAt: new Date(observedAt + 120_000).toISOString(),
  }))
}

describe('account card deck', () => {
  beforeEach(() => {
    nimRateStore.resetForTests()
  })

  it('shows real zero and unavailable USDT/NGN without fake conversions', async () => {
    render(<AccountCardDeck connection={connection} wallet={wallet} hideBalances={false} />)
    expect(screen.getByText('0 NIM')).toBeInTheDocument()
    expect(screen.getByText('— USDT')).toBeInTheDocument()
    // Initial mount with no rate yet and no failure: the NIM leg names
    // the missing rate instead of flashing "unavailable"; the USDT leg
    // (separate source) keeps its own copy.
    expect(screen.getByText('Getting current NIM rate…')).toBeInTheDocument()
    expect(screen.getAllByText('NGN estimate unavailable')).toHaveLength(1)
    expect(screen.getByText('Balance unavailable')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'View USDT account' })).toHaveAttribute('aria-pressed', 'false'))
  })

  it('switches the selected account through explicit controls without changing wallet state', () => {
    render(<AccountCardDeck connection={connection} wallet={wallet} hideBalances={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'View USDT account' }))
    expect(screen.getByRole('button', { name: 'View USDT account' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'View NIM account' })).toHaveAttribute('aria-pressed', 'false')
    expect(wallet.nimBalance).toBe('0')
  })

  it('masks balances and quotes, and passes no Nimiq address into the USDT adapter', async () => {
    const readUsdtBalance = vi.fn().mockResolvedValue({ status: 'unavailable', asset: 'USDT' })
    const sources: AccountDataSources = { readUsdtBalance, getNgnQuote: vi.fn().mockResolvedValue({ status: 'unavailable' }) }
    configureRate('10')
    const view = render(<AccountCardDeck connection={connection} wallet={{ ...wallet, status: 'available', nimBalance: '12.5' }} hideBalances={false} sources={sources} />)
    await waitFor(() => expect(screen.getByText('≈ ₦125.00')).toBeInTheDocument())
    expect(readUsdtBalance.mock.calls[0][0]).toBeUndefined()
    view.rerender(<AccountCardDeck connection={connection} wallet={{ ...wallet, status: 'available', nimBalance: '12.5' }} hideBalances sources={sources} />)
    expect(screen.queryByText('12.5 NIM')).not.toBeInTheDocument()
    expect(screen.queryByText('≈ ₦125.00')).not.toBeInTheDocument()
    expect(screen.getByText('•••• NIM')).toBeInTheDocument()
    expect(screen.getByText('•••• USDT')).toBeInTheDocument()
  })

  it('keeps the verified wallet identity when the connection hint differs', () => {
    render(<AccountCardDeck connection={{ ...connection, accounts: ['NQ99 wallet A'] }} wallet={{ ...wallet, address, status: 'available', nimBalance: '999' }} hideBalances={false} />)
    expect(screen.getByText('999 NIM')).toBeInTheDocument()
    expect(screen.queryByText('Loading balance')).not.toBeInTheDocument()
  })

  it('keeps a valid NIM quote when a separate USDT adapter fails', async () => {
    const sources: AccountDataSources = {
      readUsdtBalance: vi.fn().mockRejectedValue(new Error('USDT unavailable')),
      getNgnQuote: vi.fn().mockResolvedValue({ status: 'unavailable' }),
    }
    configureRate('10')
    render(<AccountCardDeck connection={connection} wallet={{ ...wallet, status: 'available', nimBalance: '12.5' }} hideBalances={false} sources={sources} />)
    await waitFor(() => expect(screen.getByText('≈ ₦125.00')).toBeInTheDocument())
    expect(screen.getByText('Balance unavailable')).toBeInTheDocument()
  })

  it('does not refetch the global rate when the account changes', async () => {
    const observedAt = Date.now()
    const fetchRate = vi.fn(async () => ({
      ngnPerNim: '10',
      source: 'Fixture',
      asOf: new Date(observedAt).toISOString(),
      expiresAt: new Date(observedAt + 120_000).toISOString(),
    }))
    configureNimRateFetcher(fetchRate)
    const sources = usdtSources()
    const view = render(<AccountCardDeck connection={connection} wallet={{ ...wallet, status: 'available', nimBalance: '12.5' }} hideBalances={false} sources={sources} />)
    await waitFor(() => expect(screen.getByText('≈ ₦125.00')).toBeInTheDocument())
    expect(fetchRate).toHaveBeenCalledTimes(1)
    // A different account reuses the same global market rate: no refetch,
    // and the estimate recomputes locally for the new balance.
    view.rerender(<AccountCardDeck connection={{ ...connection, accounts: ['NQ99 different'] }} wallet={{ ...wallet, address: 'NQ99 different', status: 'available', nimBalance: '5' }} hideBalances={false} sources={sources} />)
    await waitFor(() => expect(screen.getByText('≈ ₦50.00')).toBeInTheDocument())
    expect(fetchRate).toHaveBeenCalledTimes(1)
  })

  it('labels the session-network fallback instead of hiding it', () => {
    render(<AccountCardDeck connection={connection} wallet={{ ...wallet, network: 'unknown' }} hideBalances={false} fallbackNetwork="mainnet" />)
    expect(screen.getByText('Mainnet (session)')).toBeInTheDocument()
    expect(screen.queryByText('Network unavailable')).not.toBeInTheDocument()
  })

  it('prefers the confirmed aggregate over the single signer balance', async () => {
    configureRate('2000')
    render(<AccountCardDeck
      connection={connection}
      wallet={{ ...wallet, status: 'error', nimBalance: undefined, network: 'unknown' }}
      hideBalances={false}
      sources={usdtSources()}
      aggregate={{ luna: '22100500', nim: '221.005', network: 'mainnet' }}
    />)
    expect(await screen.findByText('221.005 NIM')).toBeInTheDocument()
    expect(screen.getByText('Available in Nimiq Pay')).toBeInTheDocument()
    expect(await screen.findByText('≈ ₦442010.00')).toBeInTheDocument()
    expect(screen.queryByText(/BCKQ|J28D/)).not.toBeInTheDocument()
  })

  it('still masks an aggregate balance when requested', () => {
    render(<AccountCardDeck
      connection={connection}
      wallet={wallet}
      hideBalances
      aggregate={{ luna: '22100500', nim: '221.005', network: 'mainnet' }}
    />)
    expect(screen.queryByText('221.005 NIM')).not.toBeInTheDocument()
    expect(screen.getByText('•••• NIM')).toBeInTheDocument()
  })

  it('renders the estimate for an unknown host network from the global rate', async () => {
    configureRate('0.415461')
    render(<AccountCardDeck
      connection={connection}
      wallet={{ ...wallet, status: 'unavailable', network: 'unknown' }}
      hideBalances={false}
      sources={usdtSources()}
      aggregate={{ luna: '22100500', nim: '221.005', network: 'mainnet' }}
    />)
    expect(await screen.findByText('221.005 NIM')).toBeInTheDocument()
    // 221.005 × 0.415461 = 91.819… → ₦91.82 indicative.
    expect(await screen.findByText('≈ ₦91.82')).toBeInTheDocument()
  })

  it('keeps the NIM balance visible when the rate fails', async () => {
    configureNimRateFetcher(async () => { throw new Error('rate down') })
    render(<AccountCardDeck
      connection={connection}
      wallet={{ ...wallet, status: 'unavailable', network: 'unknown' }}
      hideBalances={false}
      sources={usdtSources()}
      aggregate={{ luna: '22100500', nim: '221.005', network: 'mainnet' }}
    />)
    expect(await screen.findByText('221.005 NIM')).toBeInTheDocument()
    // Prolonged rate failure with a good balance: the NIM leg says the
    // rate — not the balance — is temporarily missing.
    expect(screen.getByText('NGN estimate temporarily unavailable')).toBeInTheDocument()
    expect(screen.getAllByText('NGN estimate unavailable')).toHaveLength(1)
  })

  it('attributes a confirmed host balance to the session-verified network for estimates', async () => {
    configureRate('10')
    render(<AccountCardDeck
      connection={connection}
      wallet={{ ...wallet, status: 'available', nimBalance: '12.5', network: 'unknown' }}
      hideBalances={false}
      sources={usdtSources()}
      fallbackNetwork="mainnet"
    />)
    expect(await screen.findByText('≈ ₦125.00')).toBeInTheDocument()
  })
})
