import { init, type NimiqProvider } from '@nimiq/mini-app-sdk'

export type NimiqConnectionStatus =
  | 'initializing'
  | 'ready'
  | 'unavailable'
  | 'error'

export interface NimiqConnectionState {
  status: NimiqConnectionStatus
  accounts: readonly string[]
  provider?: NimiqProvider
  error?: string
}

export type NimiqInitializer = (options?: {
  timeout?: number
}) => Promise<NimiqProvider>

export const NIMIQ_INIT_TIMEOUT_MS = 1_500

export function createInitializingState(): NimiqConnectionState {
  return {
    status: 'initializing',
    accounts: [],
  }
}

export async function initializeNimiqPay(options: {
  timeout?: number
  initialize?: NimiqInitializer
} = {}): Promise<NimiqConnectionState> {
  if (typeof window === 'undefined') {
    return {
      status: 'unavailable',
      accounts: [],
    }
  }

  try {
    const initialize = options.initialize ?? init
    const provider = await initialize({
      timeout: options.timeout ?? NIMIQ_INIT_TIMEOUT_MS,
    })
    const accounts = await provider.listAccounts()

    if (!Array.isArray(accounts)) {
      throw new Error('Nimiq Pay returned an invalid account list.')
    }

    return {
      status: 'ready',
      accounts: accounts.filter(
        (account): account is string =>
          typeof account === 'string' && account.length > 0,
      ),
      provider,
    }
  } catch (error) {
    if (isNimiqPayUnavailable(error)) {
      return {
        status: 'unavailable',
        accounts: [],
      }
    }

    return {
      status: 'error',
      accounts: [],
      error: getErrorMessage(error),
    }
  }
}

export function shortenNimiqAccount(account: string): string {
  const compactAccount = account.replace(/\s+/g, '')

  if (compactAccount.length <= 18) {
    return account
  }

  return `${compactAccount.slice(0, 8)}…${compactAccount.slice(-6)}`
}

function isNimiqPayUnavailable(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase()

  return (
    message.includes('provider was not injected') ||
    message.includes('not running inside a nimiq app') ||
    message.includes('running inside nimiq pay')
  )
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Nimiq Pay returned an unknown error.'
}
