import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useNimiqFunding } from './useNimiqFunding'
import type { HostAccountBalances } from '../persistence/paymentApi'

function reportFor(entries: Array<{ suffix: string; luna: string; nim: string }>, aggregateNim: string): HostAccountBalances {
  let total = 0n
  const accounts = entries.map((entry) => {
    total += BigInt(entry.luna)
    return { suffix: entry.suffix, ok: true as const, balanceLuna: entry.luna, balanceNim: entry.nim }
  })
  return {
    accounts,
    aggregateLuna: total.toString(),
    aggregateNim,
    okCount: accounts.length,
    network: 'mainnet' as const,
  }
}

describe('useNimiqFunding', () => {
  it('aggregates exposed accounts with exact luna math', async () => {
    const listAccountBalances = vi.fn().mockResolvedValue(reportFor([
      { suffix: '…BCKQ', luna: '500', nim: '0.005' },
      { suffix: '…J28D', luna: '22100000', nim: '221' },
    ], '221.005'))
    const { result } = renderHook(() => useNimiqFunding({
      sessionUserId: 'user-1',
      addresses: ['NQ47 BCKQ', 'NQ48 J28D'],
      listAccountBalances,
    }))

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current).toMatchObject({
      luna: '22100500',
      nim: '221.005',
      network: 'mainnet',
      accountCount: 2,
      readableCount: 2,
    })
    expect(listAccountBalances).toHaveBeenCalledTimes(1)
  })

  it('deduplicates spelling variants before querying', async () => {
    const listAccountBalances = vi.fn().mockResolvedValue(reportFor([
      { suffix: '…BCKQ', luna: '500', nim: '0.005' },
    ], '0.005'))
    renderHook(() => useNimiqFunding({
      sessionUserId: 'user-1',
      addresses: ['NQ47 BCKQ', 'NQ47BCKQ', ' nq47  bckq '],
      listAccountBalances,
    }))

    await waitFor(() => expect(listAccountBalances).toHaveBeenCalledTimes(1))
    expect(listAccountBalances).toHaveBeenCalledWith(['NQ47 BCKQ'])
  })

  it('aggregates only readable accounts and never fabricates the rest', async () => {
    const listAccountBalances = vi.fn().mockResolvedValue({
      accounts: [
        { suffix: '…BCKQ', ok: true, balanceLuna: '500', balanceNim: '0.005' },
        { suffix: '…XXXX', ok: false, error: 'Chain lookup failed.' },
      ],
      aggregateLuna: '500',
      aggregateNim: '0.005',
      okCount: 1,
      network: 'mainnet' as const,
    })
    const { result } = renderHook(() => useNimiqFunding({
      sessionUserId: 'user-1',
      addresses: ['NQ47 BCKQ', 'NQ48 XXXX'],
      listAccountBalances,
    }))

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current).toMatchObject({ luna: '500', nim: '0.005', readableCount: 1, accountCount: 2 })
  })

  it('stays unavailable when nothing is readable, without zero', async () => {
    const listAccountBalances = vi.fn().mockResolvedValue({
      accounts: [{ suffix: '…BCKQ', ok: false, error: 'down' }],
      aggregateLuna: '0',
      aggregateNim: '0',
      okCount: 0,
      network: 'mainnet' as const,
    })
    const { result } = renderHook(() => useNimiqFunding({
      sessionUserId: 'user-1',
      addresses: ['NQ47 BCKQ'],
      listAccountBalances,
    }))

    await waitFor(() => expect(listAccountBalances).toHaveBeenCalled())
    await waitFor(() => expect(result.current.status).toBe('unavailable'))
    expect(result.current.nim).toBeNull()
  })

  it('fetches nothing without a session, addresses, or service', async () => {
    const listAccountBalances = vi.fn()
    const { result, rerender } = renderHook(
      ({ sessionUserId, addresses }) => useNimiqFunding({ sessionUserId, addresses, listAccountBalances }),
      { initialProps: { sessionUserId: null as string | null, addresses: [] as string[] } },
    )
    expect(result.current.status).toBe('unavailable')
    rerender({ sessionUserId: 'user-1', addresses: [] })
    expect(result.current.status).toBe('unavailable')
    expect(listAccountBalances).not.toHaveBeenCalled()
  })

  it('preserves the aggregate across an internal transfer between exposed accounts', async () => {
    // Production case: J28D paid BCKQ ~121.97 NIM (fee 0). Both legs sit
    // inside the same exposed set, so Home must keep showing ~221 NIM —
    // never 0 — by re-reading both accounts from chain.
    const listAccountBalances = vi.fn()
      .mockResolvedValueOnce(reportFor([
        { suffix: '…BCKQ', luna: '500', nim: '0.005' },
        { suffix: '…J28D', luna: '22100000', nim: '221' },
      ], '221.005'))
      .mockResolvedValueOnce(reportFor([
        { suffix: '…BCKQ', luna: '12197764', nim: '121.97764' },
        { suffix: '…J28D', luna: '9902736', nim: '99.02736' },
      ], '221.005'))
    const { result } = renderHook(() => useNimiqFunding({
      sessionUserId: 'user-1',
      addresses: ['NQ47 BCKQ', 'NQ48 J28D'],
      listAccountBalances,
    }))
    await waitFor(() => expect(result.current.nim).toBe('221.005'))
    await act(async () => {
      await result.current.refresh()
    })
    await waitFor(() => expect(listAccountBalances).toHaveBeenCalledTimes(2))
    expect(result.current).toMatchObject({ status: 'ready', luna: '22100500', nim: '221.005' })
    expect(result.current.nim).not.toBe('0')
  })

  it('refreshes on demand without wallet interaction', async () => {
    const listAccountBalances = vi.fn()
      .mockResolvedValueOnce(reportFor([{ suffix: '…BCKQ', luna: '500', nim: '0.005' }], '0.005'))
      .mockResolvedValueOnce(reportFor([{ suffix: '…BCKQ', luna: '600', nim: '0.006' }], '0.006'))
    const { result } = renderHook(() => useNimiqFunding({
      sessionUserId: 'user-1',
      addresses: ['NQ47 BCKQ'],
      listAccountBalances,
    }))

    await waitFor(() => expect(result.current.nim).toBe('0.005'))
    await act(async () => {
      await result.current.refresh()
    })
    await waitFor(() => expect(result.current.nim).toBe('0.006'))
    expect(listAccountBalances).toHaveBeenCalledTimes(2)
  })
})
