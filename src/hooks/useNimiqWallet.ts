import { useCallback, useEffect, useState } from 'react'
import {
  createLoadingWalletState,
  loadNimiqWallet,
  type NimiqConnectionState,
  type NimiqWalletState,
} from '../integration/nimiq'

export interface NimiqWallet {
  state: NimiqWalletState
  /**
   * Re-reads the wallet from the provider (read-only getBalance, never a
   * permission prompt). Used after verified payments to show the new real
   * balance. Never invents values: failures surface as error state.
   */
  refreshWallet: () => Promise<NimiqWalletState>
}

export function useNimiqWallet(
  connection: NimiqConnectionState,
  authenticatedAddress?: string | null,
): NimiqWallet {
  const [state, setState] = useState(createLoadingWalletState)
  const [resolvedIdentity, setResolvedIdentity] = useState<string | null>(null)
  const address = authenticatedAddress ?? connection.accounts[0]
  const provider = connection.provider
  const identity = `${connection.status}:${address ?? ''}:${provider ? 'provider' : 'none'}`

  useEffect(() => {
    let active = true

    void loadNimiqWallet(connection, address).then((nextState) => {
      if (active) {
        setState(nextState)
        setResolvedIdentity(identity)
      }
    })

    return () => {
      active = false
    }
  }, [address, connection, identity])

  const refreshWallet = useCallback(async () => {
    const nextState = await loadNimiqWallet(connection, address)
    setState(nextState)
    setResolvedIdentity(identity)
    return nextState
  }, [address, connection, identity])

  if (resolvedIdentity !== identity) return { state: createLoadingWalletState(), refreshWallet }
  return { state, refreshWallet }
}
