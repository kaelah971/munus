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

  it('falls back to confirmed RPC balance when the host read fails', async () => {
    const listAccounts = vi.fn()
    const getBalance = vi.fn().mockRejectedValue(new Error('Unknown request.'))
    const fetchRpcBalance = vi.fn().mockResolvedValue({ lunaBalance: 22100000, nimBalance: '221', network: 'mainnet' as const })
    const conn = connectionFor(getBalance, listAccounts)
    const { result } = renderHook(({ c }) => useNimiqWallet(c, address, fetchRpcBalance), { initialProps: { c: conn } })

    await waitFor(() => expect(result.current.state.status).toBe('available'))
    expect(result.current.state).toMatchObject({ nimBalance: '221', lunaBalance: 22100000, network: 'mainnet', balanceSource: 'rpc' })
    expect(fetchRpcBalance).toHaveBeenCalledOnce()
    expect(listAccounts).not.toHaveBeenCalled()
  })

  it('never renders zero for a failed host read plus failed RPC', async () => {
    const getBalance = vi.fn().mockRejectedValue(new Error('Unknown request.'))
    const fetchRpcBalance = vi.fn().mockRejectedValue(new Error('RPC down'))
    const conn = connectionFor(getBalance)
    const { result } = renderHook(({ c }) => useNimiqWallet(c, address, fetchRpcBalance), { initialProps: { c: conn } })

    await waitFor(() => expect(result.current.state.status).toBe('error'))
    expect(result.current.state).not.toHaveProperty('lunaBalance')
    expect(result.current.state.nimBalance).toBeUndefined()
  })

  it('prefers the host balance and skips RPC when the host succeeds', async () => {
    const getBalance = vi.fn().mockResolvedValue(22100000)
    const fetchRpcBalance = vi.fn()
    const conn = connectionFor(getBalance)
    const { result } = renderHook(({ c }) => useNimiqWallet(c, address, fetchRpcBalance), { initialProps: { c: conn } })

    await waitFor(() => expect(result.current.state.status).toBe('available'))
    expect(result.current.state).toMatchObject({ balanceSource: 'host' })
    expect(fetchRpcBalance).not.toHaveBeenCalled()
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
