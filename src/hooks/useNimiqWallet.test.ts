import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import { useNimiqWallet } from './useNimiqWallet'

const address = 'NQ12 3456 7890 1234 5678 9012 3456 7890 1234'

function connectionFor(getBalance: () => Promise<unknown>, listAccounts = vi.fn()) {
  return {
    accounts: [address],
    provider: { getBalance, listAccounts } as unknown as NimiqProvider,
    status: 'ready' as const,
  }
}

describe('useNimiqWallet refresh', () => {
  it('loads without permission prompts and re-reads on refresh', async () => {
    const listAccounts = vi.fn()
    const getBalance = vi.fn().mockResolvedValueOnce(22100000).mockResolvedValueOnce(22049500)
    const conn = connectionFor(getBalance, listAccounts)
    const { result } = renderHook(({ c }) => useNimiqWallet(c, address), { initialProps: { c: conn } })

    await waitFor(() => expect(result.current.state.status).toBe('available'))
    expect(result.current.state).toMatchObject({ nimBalance: '221', lunaBalance: 22100000 })
    expect(listAccounts).not.toHaveBeenCalled()
    expect(getBalance).toHaveBeenCalledTimes(1)

    let refreshed!: Awaited<ReturnType<typeof result.current.refreshWallet>>
    await act(async () => {
      refreshed = await result.current.refreshWallet()
    })
    expect(getBalance).toHaveBeenCalledTimes(2)
    expect(getBalance).toHaveBeenCalledWith(address)
    expect(listAccounts).not.toHaveBeenCalled()
    expect(refreshed).toMatchObject({ nimBalance: '220.495' })
    expect(result.current.state).toMatchObject({ nimBalance: '220.495' })
  })

  it('surfaces refresh failure as error state without throwing', async () => {
    const getBalance = vi.fn()
      .mockResolvedValueOnce(22100000)
      .mockRejectedValueOnce(new Error('consensus unavailable'))
    const conn = connectionFor(getBalance)
    const { result } = renderHook(({ c }) => useNimiqWallet(c, address), { initialProps: { c: conn } })

    await waitFor(() => expect(result.current.state.status).toBe('available'))
    let refreshed!: Awaited<ReturnType<typeof result.current.refreshWallet>>
    await act(async () => {
      refreshed = await result.current.refreshWallet()
    })
    expect(refreshed.status).toBe('error')
    expect(result.current.state.status).toBe('error')
  })
})
