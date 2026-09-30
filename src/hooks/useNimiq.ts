import { useCallback, useEffect, useState } from 'react'
import {
  createInitializingState,
  initializeNimiqPay,
  NIMIQ_INIT_TIMEOUT_MS,
  type NimiqConnectionState,
} from '../integration/nimiq'

export function useNimiq(): {
  state: NimiqConnectionState
  retry: () => void
} {
  const [state, setState] = useState(createInitializingState)
  const [attempt, setAttempt] = useState(0)

  const retry = useCallback(() => {
    setState(createInitializingState())
    setAttempt((currentAttempt) => currentAttempt + 1)
  }, [])

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

  return { state, retry }
}
