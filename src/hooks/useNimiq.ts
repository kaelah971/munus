import { useCallback, useEffect, useState } from 'react'
import {
  createInitializingState,
  initializeNimiqPay,
  requestNimiqAccounts,
  NIMIQ_INIT_TIMEOUT_MS,
  type NimiqConnectionState,
} from '../integration/nimiq'

export function useNimiq(): {
  state: NimiqConnectionState
  retry: () => void
  requestAccounts: () => Promise<readonly string[]>
} {
  const [state, setState] = useState(createInitializingState)
  const [attempt, setAttempt] = useState(0)

  const retry = useCallback(() => {
    setState(createInitializingState())
    setAttempt((currentAttempt) => currentAttempt + 1)
  }, [])

  const requestAccounts = useCallback(async () => {
    const accounts = await requestNimiqAccounts(state)
    setState((currentState) => currentState.status === 'ready'
      ? { ...currentState, accounts }
      : currentState)
    return accounts
  }, [state])

  useEffect(() => {
    let active = true

    void initializeNimiqPay({ timeout: NIMIQ_INIT_TIMEOUT_MS }).then((nextState) => {
      if (active) {
        setState(nextState)
      }
    })

    return () => {
      active = false
    }
  }, [attempt])

  return { state, retry, requestAccounts }
}
