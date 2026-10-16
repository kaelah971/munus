import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import { AccountCardDeck } from '../components/AccountCardDeck'
import {
  configureNimRateFetcher,
  nimRateStore,
  useNimRate,
} from './useNimRate'
import {
  createPublicNimRateFetcher,
  fetchPublicNimRate,
  PUBLIC_NIM_NGN_PATH,
} from '../persistence/publicRates'
import type { NimiqConnectionState, NimiqWalletState } from '../integration/nimiq'

const GLOBAL_RATE = '2000'
const observedAt = Date.now()

function publicRate(ngnPerNim = GLOBAL_RATE) {
  return {
    ngnPerNim,
    source: 'coingecko:nimiq-2/ngn',
    asOf: new Date(observedAt).toISOString(),
    expiresAt: new Date(observedAt + 120_000).toISOString(),
  }
}

function walletFor(nimBalance: string, network = 'mainnet'): NimiqWalletState {
  return {
    status: 'available',
    nimBalance,
    address: 'NQ12 3456 7890 1234 5678 9012 3456 7890 1234',
    network,
  } as NimiqWalletState
}

const readyConnection: NimiqConnectionState = {
  status: 'ready',
  accounts: ['NQ12 3456 7890 1234 5678 9012 3456 7890 1234'],
}

function offlineSources() {
  return {
    readUsdtBalance: vi.fn().mockResolvedValue({ status: 'unavailable', asset: 'USDT' }),
    getNgnQuote: vi.fn().mockResolvedValue({ status: 'unavailable' }),
  }
}

describe('global public NIM/NGN rate', () => {
  beforeEach(() => {
    nimRateStore.resetForTests()
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches public market data without any session, wallet, or user', async () => {
    const seen: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      seen.push(String(url))
      return { ok: true, json: async () => publicRate() }
    }))
    // No session object exists anywhere in this call path.
    const rate = await fetchPublicNimRate('https://munus.example')
    expect(rate.ngnPerNim).toBe(GLOBAL_RATE)
    expect(seen).toEqual(['https://munus.example' + PUBLIC_NIM_NGN_PATH])
  })

  it('rejects malformed public payloads instead of displaying them', async () => {
    for (const body of [{}, { ngnPerNim: '' }, { ngnPerNim: '5' }, 'nope', null]) {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => body })))
      await expect(fetchPublicNimRate('https://munus.example')).rejects.toThrow('NIM rate unavailable.')
    }
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429 })))
    await expect(fetchPublicNimRate('https://munus.example')).rejects.toThrow('NIM rate unavailable.')
  })

  it('starts the shared loop from the public fetcher with no authentication', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => publicRate() })))
    configureNimRateFetcher(createPublicNimRateFetcher('https://munus.example'))
    const { result } = renderHook(() => useNimRate(Date.now()))
    await waitFor(() => expect(result.current.rate?.ngnPerNim).toBe(GLOBAL_RATE))
  })

  it('serves user A and user B the identical global rate object', async () => {
    configureNimRateFetcher(async () => publicRate())
    const hookA = renderHook(() => useNimRate(Date.now()))
    const hookB = renderHook(() => useNimRate(Date.now()))
    await waitFor(() => expect(hookA.result.current.rate?.ngnPerNim).toBe(GLOBAL_RATE))
    await waitFor(() => expect(hookB.result.current.rate?.ngnPerNim).toBe(GLOBAL_RATE))
    // Same store, same snapshot — never per-user state.
    expect(hookA.result.current.rate).toBe(hookB.result.current.rate)
  })

  it('derives both Home balances from the same global rate without separate lifecycles', async () => {
    let calls = 0
    configureNimRateFetcher(async () => {
      calls += 1
      return publicRate()
    })
    // USER A: 221.005 NIM × 2000 = ₦442010.00.
    const deckA = render(
      <AccountCardDeck connection={readyConnection} wallet={walletFor('221.005')} hideBalances={false} sources={offlineSources()} />,
    )
    await waitFor(() => expect(screen.getByText('≈ ₦442010.00')).toBeInTheDocument())
    deckA.unmount()
    // USER B: 1072.90038 NIM × 2000 = ₦2145800.76 — same loop, no refetch.
    render(
      <AccountCardDeck connection={readyConnection} wallet={walletFor('1072.90038')} hideBalances={false} sources={offlineSources()} />,
    )
    await waitFor(() => expect(screen.getByText('≈ ₦2145800.76')).toBeInTheDocument())
    expect(calls).toBe(1)
  })

  it('keeps the rate across Home → Pay → Home remounts with one lifecycle', async () => {
    let calls = 0
    configureNimRateFetcher(async () => {
      calls += 1
      return publicRate()
    })
    const first = render(
      <AccountCardDeck connection={readyConnection} wallet={walletFor('10')} hideBalances={false} sources={offlineSources()} />,
    )
    await waitFor(() => expect(screen.getByText('≈ ₦20000.00')).toBeInTheDocument())
    first.unmount()
    // Pay subscribes to the same singleton store, then Home returns.
    const payHook = renderHook(() => useNimRate(Date.now()))
    await waitFor(() => expect(payHook.result.current.rate?.ngnPerNim).toBe(GLOBAL_RATE))
    payHook.unmount()
    render(
      <AccountCardDeck connection={readyConnection} wallet={walletFor('10')} hideBalances={false} sources={offlineSources()} />,
    )
    await waitFor(() => expect(screen.getByText('≈ ₦20000.00')).toBeInTheDocument())
    expect(calls).toBe(1)
  })

  it('shows the estimate when the balance arrives after the rate', async () => {
    configureNimRateFetcher(async () => publicRate())
    const loadingWallet = { status: 'loading', asset: 'NIM' } as unknown as NimiqWalletState
    const view = render(
      <AccountCardDeck connection={readyConnection} wallet={loadingWallet} hideBalances={false} sources={offlineSources()} />,
    )
    await waitFor(() => expect(nimRateStore.getSnapshot().rate?.ngnPerNim).toBe(GLOBAL_RATE))
    // Balance lands later: the reactive hook rerenders into an estimate.
    view.rerender(
      <AccountCardDeck connection={readyConnection} wallet={walletFor('3')} hideBalances={false} sources={offlineSources()} />,
    )
    await waitFor(() => expect(screen.getByText('≈ ₦6000.00')).toBeInTheDocument())
  })

  it('shows the estimate when the rate arrives after the balance', async () => {
    let release!: (rate: ReturnType<typeof publicRate>) => void
    const gate = new Promise<ReturnType<typeof publicRate>>((resolve) => { release = resolve })
    configureNimRateFetcher(() => gate)
    render(
      <AccountCardDeck connection={readyConnection} wallet={walletFor('3')} hideBalances={false} sources={offlineSources()} />,
    )
    // Balance is ready but the rate is still in flight: loading copy, not
    // a flash of \"unavailable\".
    expect(screen.getByText('Getting current NIM rate…')).toBeInTheDocument()
    release(publicRate())
    await waitFor(() => expect(screen.getByText('≈ ₦6000.00')).toBeInTheDocument())
  })

  it('fetches while the wallet network is unknown and the balance is missing', async () => {
    const fetchRate = vi.fn(async () => publicRate())
    configureNimRateFetcher(fetchRate)
    const unknownWallet = { status: 'unavailable', asset: 'NIM', network: 'unknown' } as unknown as NimiqWalletState
    render(
      <AccountCardDeck
        connection={{ status: 'unavailable', accounts: [] }}
        wallet={unknownWallet}
        hideBalances={false}
        sources={offlineSources()}
      />,
    )
    // Neither an unknown network nor a missing balance may gate the
    // public market-data fetch itself.
    await waitFor(() => expect(fetchRate).toHaveBeenCalled())
    await waitFor(() => expect(nimRateStore.getSnapshot().rate?.ngnPerNim).toBe(GLOBAL_RATE))
  })

  it('revalidates once for every subscriber and keeps value across transient failure', async () => {
    let mode: 'ok' | 'down' = 'ok'
    configureNimRateFetcher(async () => {
      if (mode === 'down') throw new Error('transient')
      return publicRate()
    })
    const hookA = renderHook(() => useNimRate(Date.now()))
    const hookB = renderHook(() => useNimRate(Date.now()))
    await waitFor(() => expect(hookB.result.current.rate?.ngnPerNim).toBe(GLOBAL_RATE))
    mode = 'down'
    hookA.result.current.refresh()
    await waitFor(() => expect(hookA.result.current.error).not.toBeNull())
    // The existing value is retained, never erased by the failed refresh.
    expect(hookA.result.current.rate?.ngnPerNim).toBe(GLOBAL_RATE)
    expect(hookB.result.current.rate?.ngnPerNim).toBe(GLOBAL_RATE)
  })
})
