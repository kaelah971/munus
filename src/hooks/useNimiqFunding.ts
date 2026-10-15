import { useCallback, useEffect, useState } from 'react'
import type { HostAccountBalances } from '../persistence/paymentApi'
import { normalizeHostAddress } from '../persistence/hostAccounts'

export interface NimiqFunding {
  status: 'loading' | 'ready' | 'unavailable'
  /** Exact aggregate integer luna across readable exposed accounts. */
  luna: string | null
  /** Exact aggregate NIM display. Canonical balance math stays server-side. */
  nim: string | null
  network: 'mainnet' | 'testnet'
  /** Unique host-exposed addresses considered. */
  accountCount: number
  /** Addresses with a confirmed readable balance. */
  readableCount: number
  refresh: () => Promise<void>
}

const IDLE: Omit<NimiqFunding, 'refresh'> = {
  status: 'unavailable',
  luna: null,
  nim: null,
  network: 'mainnet',
  accountCount: 0,
  readableCount: 0,
}

/**
 * Aggregate Nimiq Pay funding context across every host-exposed account.
 * Pure authenticated server reads — this hook never touches the wallet
 * provider, requests accounts, or prompts. Auth identity is untouched:
 * the aggregate is display context only, never who pays.
 */
export function useNimiqFunding({ sessionUserId, addresses, listAccountBalances }: {
  sessionUserId: string | null | undefined
  addresses: readonly string[]
  listAccountBalances?: (addresses: string[]) => Promise<HostAccountBalances>
}): NimiqFunding {
  const [nonce, setNonce] = useState(0)
  const [resolved, setResolved] = useState<{ key: string; value: Omit<NimiqFunding, 'refresh'> } | null>(null)
  const unique = [...new Set(addresses.map(normalizeHostAddress).filter(Boolean))]
  const key = `${sessionUserId ?? ''}|${unique.join('|')}|${nonce}`
  const canLoad = Boolean(sessionUserId && listAccountBalances && unique.length > 0)

  useEffect(() => {
    if (!canLoad || !listAccountBalances) return
    let active = true
    // The server normalizes again; originals are sent so nothing is lost.
    const originals = unique.map((compact) => (addresses.find((entry) => normalizeHostAddress(entry) === compact) ?? compact))
    void listAccountBalances(originals).then((report) => {
      if (!active) return
      setResolved({
        key,
        value: report.okCount === 0
          ? { ...IDLE, accountCount: unique.length }
          : {
            status: 'ready',
            luna: report.aggregateLuna,
            nim: report.aggregateNim,
            network: report.network,
            accountCount: unique.length,
            readableCount: report.okCount,
          },
      })
    }).catch(() => {
      if (active) setResolved({ key, value: { ...IDLE, accountCount: unique.length } })
    })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const refresh = useCallback(async () => {
    setNonce((current) => current + 1)
  }, [])

  const value = resolved && resolved.key === key
    ? resolved.value
    : canLoad
      ? { ...IDLE, status: 'loading' as const, accountCount: unique.length }
      : { ...IDLE }
  return { ...value, refresh }
}
