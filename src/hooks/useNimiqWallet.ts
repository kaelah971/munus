import { useEffect, useState } from 'react'
import {
  createLoadingWalletState,
  loadNimiqWallet,
  type NimiqConnectionState,
  type NimiqWalletState,
} from '../integration/nimiq'

export function useNimiqWallet(connection: NimiqConnectionState): NimiqWalletState {
  const [state, setState] = useState(createLoadingWalletState)
  const [resolvedIdentity, setResolvedIdentity] = useState<string | null>(null)
  const address = connection.accounts[0]
  const provider = connection.provider
  const identity = `${connection.status}:${address ?? ''}:${provider ? 'provider' : 'none'}`

  useEffect(() => {
    let active = true

    void loadNimiqWallet(connection).then((nextState) => {
      if (active) {
        setState(nextState)
        setResolvedIdentity(identity)
      }
    })

    return () => {
      active = false
    }
  }, [connection, identity])

  return resolvedIdentity === identity ? state : createLoadingWalletState()
}
