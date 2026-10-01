import {
  getHostNetwork,
  init,
  type ErrorResponse,
  type NimiqProvider,
  type SignatureResult,
} from '@nimiq/mini-app-sdk'

export type NimiqConnectionStatus =
  | 'initializing'
  | 'ready'
  | 'unavailable'
  | 'error'

export type NimiqNetwork = 'mainnet' | 'testnet' | 'unknown'

export interface NimiqConnectionState {
  status: NimiqConnectionStatus
  accounts: readonly string[]
  provider?: NimiqProvider
  error?: string
}

export type NimiqInitializer = (options?: {
  timeout?: number
}) => Promise<NimiqProvider>

export type NimiqWalletStatus =
  | 'loading'
  | 'available'
  | 'zero'
  | 'unavailable'
  | 'error'

export interface NimiqWalletState {
  status: NimiqWalletStatus
  address?: string
  lunaBalance?: number
  nimBalance?: string
  network: NimiqNetwork
  error?: string
}

export const NIMIQ_INIT_TIMEOUT_MS = 1_500

export function createInitializingState(): NimiqConnectionState {
  return {
    status: 'initializing',
    accounts: [],
  }
}

export function createLoadingWalletState(): NimiqWalletState {
  return {
    status: 'loading',
    network: readHostNetwork(),
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

export async function requestNimiqSignature(
  connection: NimiqConnectionState,
  message: string,
): Promise<SignatureResult> {
  if (connection.status !== 'ready' || !connection.provider || connection.accounts.length === 0) {
    throw new Error('Connect a Nimiq Pay account before signing in to Munus.')
  }

  try {
    const result = await connection.provider.sign(message) as unknown
    if (isNimiqErrorResponse(result)) throw new Error(result.error.message)
    if (!isSignatureResult(result)) {
      throw new Error('Nimiq Pay did not return a usable challenge signature.')
    }
    return result
  } catch (error) {
    if (isNimiqErrorResponse(error)) throw new Error(error.error.message, { cause: error })
    throw error
  }
}

export async function loadNimiqWallet(
  connection: NimiqConnectionState,
): Promise<NimiqWalletState> {
  const network = readHostNetwork()
  const address = connection.accounts[0]

  if (connection.status === 'initializing') {
    return { status: 'loading', network }
  }

  if (connection.status !== 'ready' || !connection.provider || !address) {
    return {
      status: 'unavailable',
      network,
    }
  }

  try {
    const lunaBalance = await connection.provider.getBalance(address)

    if (!Number.isSafeInteger(lunaBalance) || lunaBalance < 0) {
      throw new Error('Nimiq Pay returned an invalid balance.')
    }

    return {
      status: lunaBalance === 0 ? 'zero' : 'available',
      address,
      lunaBalance,
      nimBalance: formatNimFromLuna(lunaBalance),
      network,
    }
  } catch (error) {
    return {
      status: 'error',
      address,
      network,
      error: getErrorMessage(error),
    }
  }
}

export function formatNimFromLuna(luna: number): string {
  if (!Number.isSafeInteger(luna) || luna < 0) {
    throw new Error('NIM balance must be a non-negative safe integer in luna.')
  }

  const whole = Math.floor(luna / 100_000)
  const fraction = luna % 100_000
  if (fraction === 0) return `${whole}`

  return `${whole}.${fraction.toString().padStart(5, '0').replace(/0+$/, '')}`
}

export function shortenNimiqAccount(account: string): string {
  const compactAccount = account.replace(/\s+/g, '')

  if (compactAccount.length <= 18) {
    return account
  }

  return `${compactAccount.slice(0, 8)}…${compactAccount.slice(-6)}`
}

export function getNimiqNetwork(): NimiqNetwork {
  const network = getHostNetwork()
  return network ?? 'unknown'
}

function readHostNetwork(): NimiqNetwork {
  return getNimiqNetwork()
}

function isNimiqPayUnavailable(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase()

  return (
    message.includes('provider was not injected') ||
    message.includes('not running inside a nimiq app') ||
    message.includes('running inside nimiq pay')
  )
}

function isNimiqErrorResponse(value: unknown): value is ErrorResponse {
  if (!value || typeof value !== 'object' || !('error' in value)) return false
  const error = (value as { error?: unknown }).error
  return Boolean(
    error &&
    typeof error === 'object' &&
    'type' in error &&
    typeof (error as { type?: unknown }).type === 'string' &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string',
  )
}

function isSignatureResult(value: unknown): value is SignatureResult {
  if (!value || typeof value !== 'object') return false
  const result = value as Partial<SignatureResult>
  return typeof result.publicKey === 'string' && result.publicKey.length > 0
    && typeof result.signature === 'string' && result.signature.length > 0
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Nimiq Pay returned an unknown error.'
}
