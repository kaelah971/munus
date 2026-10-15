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
  /**
   * Which source attested the displayed balance: live host read, or
   * confirmed server RPC fallback. Absent while loading/unavailable.
   */
  balanceSource?: 'host' | 'rpc'
  /**
   * Safe read diagnostics: which address spelling was used, what the
   * provider returned or threw, and whether the host network was present.
   * Contains an address suffix at most — never secrets or full identity.
   */
  debug?: NimiqWalletDebug
}

export interface NimiqWalletDebug {
  method: 'getBalance'
  addressSource: 'session' | 'connected' | 'none'
  /** Last 4 characters of the compact address, or '' when absent. */
  addressSuffix: string
  /** Which address spelling the successful attempt used, if any. */
  addressVariant: 'verbatim' | 'compact' | 'none'
  ok: boolean
  /** typeof the provider result ('number' on success, 'rpc' on RPC fallback). */
  balanceType: string
  /** Which source produced the final balance, once known. */
  balanceSource?: 'host' | 'rpc'
  /** True when the RPC fallback succeeded. */
  rpcOk?: boolean
  errorName?: string
  errorMessage?: string
  errorCode?: string | number
  hostNetworkPresent: boolean
  hostNetwork?: string
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

    return {
      status: 'ready',
      accounts: [],
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

export async function requestNimiqAccounts(
  connection: NimiqConnectionState,
): Promise<readonly string[]> {
  if (connection.status !== 'ready' || !connection.provider) {
    throw new Error('Connect a Nimiq Pay provider before sharing an account with Munus.')
  }

  try {
    const result = await connection.provider.listAccounts() as unknown
    if (isNimiqErrorResponse(result)) throw new Error(result.error.message)
    if (!Array.isArray(result)) {
      throw new Error('Nimiq Pay returned an invalid account list.')
    }

    const accounts = result.filter(
      (account): account is string =>
        typeof account === 'string' && account.length > 0,
    )
    if (accounts.length === 0) {
      throw new Error('Nimiq Pay did not share an account with Munus.')
    }
    return accounts
  } catch (error) {
    if (isNimiqErrorResponse(error)) throw new Error(error.error.message, { cause: error })
    throw error
  }
}

export async function requestNimiqSignature(
  connection: NimiqConnectionState,
  message: string,
): Promise<SignatureResult> {
  if (connection.status !== 'ready' || !connection.provider) {
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

export interface NimPaymentIntent {
  receiver: string
  /** Exact integer luna string; never a float. */
  lunaAmount: string
  memo: string
}

export async function requestNimPayment(
  connection: NimiqConnectionState,
  intent: NimPaymentIntent,
): Promise<string> {
  if (connection.status !== 'ready' || !connection.provider) {
    throw new Error('Connect a Nimiq Pay account before paying with NIM.')
  }
  const luna = Number(intent.lunaAmount)
  if (!Number.isSafeInteger(luna) || luna <= 0) {
    throw new Error('Munus quote is missing a valid luna amount.')
  }
  if (!intent.receiver.trim() || !intent.memo.trim()) {
    throw new Error('Munus quote is missing its receiver or payment reference.')
  }

  // The wallet chooses and signs the sender; Munus never selects an account
  // here. The returned hash is only a submission reference, never proof.
  let result: unknown
  try {
    result = await connection.provider.sendBasicTransactionWithData({
      recipient: intent.receiver,
      value: luna,
      data: intent.memo,
    }) as unknown
  } catch (error) {
    if (isNimiqErrorResponse(error)) throw new Error(error.error.message, { cause: error })
    throw error
  }
  if (isNimiqErrorResponse(result)) throw new Error(result.error.message)
  if (typeof result !== 'string' || !/^(0x)?[0-9a-fA-F]{64}$/.test(result.trim())) {
    throw new Error('Nimiq Pay did not return a usable transaction reference.')
  }
  return result.trim()
}

export interface RpcBalanceResult {
  lunaBalance: number
  nimBalance: string
  network: 'mainnet' | 'testnet'
}

export async function loadNimiqWallet(
  connection: NimiqConnectionState,
  walletAddress = connection.accounts[0],
  fetchRpcBalance?: () => Promise<RpcBalanceResult>,
): Promise<NimiqWalletState> {
  const hostNetwork = getHostNetwork()
  const network = hostNetwork ?? 'unknown'
  const address = walletAddress
  const addressSource: NimiqWalletDebug['addressSource'] = !address ? 'none' : address === connection.accounts[0] ? 'connected' : 'session'
  const baseDebug: Pick<NimiqWalletDebug, 'method' | 'addressSource' | 'addressSuffix' | 'hostNetworkPresent' | 'hostNetwork'> = {
    method: 'getBalance' as const,
    addressSource,
    addressSuffix: address ? address.replace(/\s+/g, '').slice(-4) : '',
    hostNetworkPresent: hostNetwork !== undefined,
    ...(hostNetwork !== undefined ? { hostNetwork } : {}),
  }

  if (connection.status === 'initializing') {
    return { status: 'loading', network }
  }

  if (connection.status !== 'ready' || !connection.provider || !address) {
    return {
      status: 'unavailable',
      network,
      debug: { ...baseDebug, addressVariant: 'none' as const, ok: false, balanceType: 'none' },
    }
  }

  // Some hosts only accept the compact (spaceless) address spelling.
  // The verbatim session spelling goes first so identity never shifts;
  // the compact retry only fires after a failure and is recorded.
  const compact = address.replace(/\s+/g, '')
  const attempts: Array<{ variant: 'verbatim' | 'compact'; value: string }> = [{ variant: 'verbatim', value: address }]
  if (compact !== address) attempts.push({ variant: 'compact', value: compact })
  let lastFailure: { balanceType: string; name: string; message: string; code?: string | number } | null = null
  for (const attempt of attempts) {
    try {
      const result = await connection.provider.getBalance(attempt.value) as unknown
      // The provider may answer with a legacy error object instead of a
      // luna integer. Surface its message so failures stay diagnosable
      // instead of collapsing into a generic unavailable state.
      if (isNimiqErrorResponse(result)) throw new Error(result.error.message, { cause: result })
      if (typeof result !== 'number' || !Number.isSafeInteger(result) || result < 0) {
        lastFailure = {
          balanceType: Array.isArray(result) ? 'array' : typeof result,
          name: 'UnreadableBalance',
          message: 'Nimiq Pay returned an unreadable balance.',
        }
        continue
      }
      const lunaBalance = result
      return {
        status: lunaBalance === 0 ? 'zero' : 'available',
        address,
        lunaBalance,
        nimBalance: formatNimFromLuna(lunaBalance),
        network,
        balanceSource: 'host',
        debug: { ...baseDebug, addressVariant: attempt.variant, ok: true, balanceType: 'number', balanceSource: 'host' },
      }
    } catch (error) {
      lastFailure = { balanceType: 'thrown', ...describeWalletError(error) }
    }
  }
  // Host read failed: fall back to confirmed server RPC for the same
  // session wallet. Silent and read-only — no prompt, no signing — and
  // only ever the canonical address. Both failing stays unavailable;
  // failure is never rendered as zero.
  if (fetchRpcBalance) {
    try {
      const rpc = await fetchRpcBalance()
      if (!Number.isSafeInteger(rpc.lunaBalance) || rpc.lunaBalance < 0) {
        throw new Error('Server returned an unreadable balance.')
      }
      if (!/^\d+(\.\d{1,5})?$/.test(rpc.nimBalance)) {
        throw new Error('Server returned an unreadable balance.')
      }
      if (rpc.network !== 'mainnet' && rpc.network !== 'testnet') {
        throw new Error('Server returned an unreadable balance.')
      }
      const rpcNetwork = hostNetwork ?? rpc.network
      return {
        status: rpc.lunaBalance === 0 ? 'zero' : 'available',
        address,
        lunaBalance: rpc.lunaBalance,
        nimBalance: rpc.nimBalance,
        network: rpcNetwork,
        balanceSource: 'rpc',
        debug: {
          ...baseDebug,
          addressVariant: 'none',
          ok: true,
          balanceType: 'rpc',
          balanceSource: 'rpc',
          rpcOk: true,
        },
      }
    } catch (rpcError) {
      lastFailure = { balanceType: 'rpc-thrown', ...describeWalletError(rpcError) }
    }
  }
  const failure = lastFailure ?? { balanceType: 'unknown', name: 'Unknown', message: getErrorMessage(null) }
  return {
    status: 'error',
    address,
    network,
    error: failure.message,
    debug: {
      ...baseDebug,
      addressVariant: 'none',
      ok: false,
      balanceType: failure.balanceType,
      errorName: failure.name,
      errorMessage: failure.message,
      ...(failure.code !== undefined ? { errorCode: failure.code } : {}),
    },
  }
}

/** Extracts name/message/code from thrown provider errors (including NimiqProviderError with .type/.code). */
function describeWalletError(error: unknown): { name: string; message: string; code?: string | number } {
  const message = getErrorMessage(error)
  const record = error && typeof error === 'object' ? (error as Record<string, unknown>) : null
  const providerType = record && typeof record.type === 'string' ? record.type : undefined
  const name = providerType ?? (error instanceof Error ? error.name : typeof error)
  const code = record && (typeof record.code === 'string' || typeof record.code === 'number') ? record.code : undefined
  return { name, message, ...(code !== undefined ? { code } : {}) }
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
