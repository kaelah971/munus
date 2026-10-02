import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AccountCardDeck } from './AccountCardDeck'
import type { NimiqConnectionState, NimiqWalletState } from '../integration/nimiq'
import type { AccountDataSources } from '../domain/accountPresentation'

const address = 'NQ12 3456 7890 1234 5678 9012 3456 7890 1234'
const connection: NimiqConnectionState = { status: 'ready', accounts: [address] }
const wallet: NimiqWalletState = { status: 'zero', nimBalance: '0', address, network: 'mainnet' }

describe('account card deck', () => {
  it('shows real zero and unavailable USDT/NGN without fake conversions', async () => {
    render(<AccountCardDeck connection={connection} wallet={wallet} hideBalances={false} />)
    expect(screen.getByText('0 NIM')).toBeInTheDocument()
    expect(screen.getByText('— USDT')).toBeInTheDocument()
    expect(screen.getAllByText('NGN estimate unavailable')).toHaveLength(2)
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
    const sources: AccountDataSources = { readUsdtBalance, getNgnQuote: vi.fn().mockResolvedValue({ status: 'available', asset: 'NIM', network: 'mainnet', ngnPerUnit: '10', source: 'Fixture', asOf: 0, expiresAt: Date.now() + 60000 }) }
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
      getNgnQuote: vi.fn().mockResolvedValue({ status: 'available', asset: 'NIM', network: 'mainnet', ngnPerUnit: '10', source: 'Fixture', asOf: 0, expiresAt: Date.now() + 60000 }),
    }
    render(<AccountCardDeck connection={connection} wallet={{ ...wallet, status: 'available', nimBalance: '12.5' }} hideBalances={false} sources={sources} />)
    await waitFor(() => expect(screen.getByText('≈ ₦125.00')).toBeInTheDocument())
    expect(screen.getByText('Balance unavailable')).toBeInTheDocument()
  })

  it('ignores pending data from an account that has changed', async () => {
    let resolveFirst!: (quote: { status: 'available'; asset: 'NIM'; network: string; ngnPerUnit: string; source: string; asOf: number; expiresAt: number }) => void
    const firstQuote = new Promise<Awaited<ReturnType<AccountDataSources['getNgnQuote']>>>((resolve) => { resolveFirst = resolve })
    const sources: AccountDataSources = {
      readUsdtBalance: vi.fn().mockResolvedValue({ status: 'unavailable', asset: 'USDT' }),
      getNgnQuote: vi.fn().mockReturnValueOnce(firstQuote).mockResolvedValue({ status: 'unavailable' }),
    }
    const view = render(<AccountCardDeck connection={connection} wallet={{ ...wallet, status: 'available', nimBalance: '12.5' }} hideBalances={false} sources={sources} />)
    view.rerender(<AccountCardDeck connection={{ ...connection, accounts: ['NQ99 different'] }} wallet={{ ...wallet, address: 'NQ99 different', status: 'available', nimBalance: '5' }} hideBalances={false} sources={sources} />)
    resolveFirst({ status: 'available', asset: 'NIM', network: 'mainnet', ngnPerUnit: '10', source: 'Old account', asOf: 0, expiresAt: Date.now() + 60000 })
    await waitFor(() => expect(sources.getNgnQuote).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('≈ ₦50.00')).not.toBeInTheDocument()
    expect(screen.getAllByText('NGN estimate unavailable')).toHaveLength(2)
  })
})
