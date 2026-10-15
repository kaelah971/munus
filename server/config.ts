import { Address } from '@nimiq/core'

export class ServerConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ServerConfigurationError'
  }
}

export interface ClubKonnectServerConfig {
  userId: string
  apiKey: string
  callbackBaseUrl?: string
}

export interface NimPaymentServerConfig {
  receiverAddress?: string
  rpcUrl?: string
  quoteTtlMs: number
}

export interface PaycrestServerConfig {
  apiKey: string
  apiSecret: string
  refundAddress: string
  usdtContractAddress: string
  baseUrl?: string
}

/**
 * Operator live attestation per rail. Each flag may only be set after the
 * operator has completed a successful real-money smoke test for that rail
 * (see docs/live-smoke-runbook.md). Configured-but-unflagged rails stay
 * usable-by-explicit-choice but are presented as unverified; nothing here
 * enables spending by itself — all money-movement guards still apply.
 */
export interface LiveAttestationConfig {
  airtime: boolean
  data: boolean
  cashout: boolean
}

export interface MunusServerConfig {
  port: number
  databaseUrl: string
  cookieName: string
  cookieSecure: boolean
  challengeTtlMs: number
  sessionTtlMs: number
  defaultNetwork: 'mainnet' | 'testnet'
  corsOrigin?: string
  clubKonnect?: ClubKonnectServerConfig
  nimPayments: NimPaymentServerConfig
  paycrest?: PaycrestServerConfig
  live: LiveAttestationConfig
}

export interface ServerEnv {
  MUNUS_SERVER_PORT?: string
  PORT?: string
  MUNUS_COOKIE_NAME?: string
  MUNUS_COOKIE_SECURE?: string
  MUNUS_CHALLENGE_TTL_SECONDS?: string
  MUNUS_SESSION_TTL_SECONDS?: string
  MUNUS_NIMIQ_NETWORK?: string
  MUNUS_CORS_ORIGIN?: string
  NODE_ENV?: string
  DATABASE_URL?: string
  MUNUS_NIM_RECEIVER_ADDRESS?: string
  NIMIQ_RPC_URL?: string
  MUNUS_QUOTE_TTL_SECONDS?: string
  CLUBKONNECT_USER_ID?: string
  CLUBKONNECT_API_KEY?: string
  CLUBKONNECT_CALLBACK_BASE_URL?: string
  PAYCREST_API_KEY?: string
  PAYCREST_API_SECRET?: string
  PAYCREST_REFUND_ADDRESS?: string
  PAYCREST_BASE_URL?: string
  POLYGON_USDT_CONTRACT?: string
  MUNUS_AIRTIME_LIVE?: string
  MUNUS_DATA_LIVE?: string
  MUNUS_CASHOUT_LIVE?: string
}

export function loadServerConfig(env: ServerEnv = process.env): MunusServerConfig {
  const databaseUrl = required(env.DATABASE_URL, 'DATABASE_URL')
  const portSource = env.MUNUS_SERVER_PORT ?? env.PORT ?? '8787'
  const port = positiveInteger(portSource, env.MUNUS_SERVER_PORT ? 'MUNUS_SERVER_PORT' : 'PORT')
  const challengeTtlSeconds = positiveInteger(
    env.MUNUS_CHALLENGE_TTL_SECONDS ?? '300',
    'MUNUS_CHALLENGE_TTL_SECONDS',
  )
  const sessionTtlSeconds = positiveInteger(
    env.MUNUS_SESSION_TTL_SECONDS ?? '2592000',
    'MUNUS_SESSION_TTL_SECONDS',
  )
  const defaultNetwork = env.MUNUS_NIMIQ_NETWORK ?? 'mainnet'

  if (defaultNetwork !== 'mainnet' && defaultNetwork !== 'testnet') {
    throw new ServerConfigurationError('MUNUS_NIMIQ_NETWORK must be mainnet or testnet.')
  }

  return {
    port,
    databaseUrl,
    cookieName: env.MUNUS_COOKIE_NAME ?? 'munus_session',
    cookieSecure: parseBoolean(
      env.MUNUS_COOKIE_SECURE,
      env.NODE_ENV === 'production',
    ),
    challengeTtlMs: challengeTtlSeconds * 1000,
    sessionTtlMs: sessionTtlSeconds * 1000,
    defaultNetwork,
    corsOrigin: env.MUNUS_CORS_ORIGIN?.trim() || undefined,
    clubKonnect: loadClubKonnectConfig(env),
    paycrest: loadPaycrestConfig(env),
    live: {
      airtime: env.MUNUS_AIRTIME_LIVE === 'true',
      data: env.MUNUS_DATA_LIVE === 'true',
      cashout: env.MUNUS_CASHOUT_LIVE === 'true',
    },
    nimPayments: {
      receiverAddress: loadReceiverAddress(env),
      rpcUrl: env.NIMIQ_RPC_URL?.trim() || undefined,
      quoteTtlMs: positiveInteger(env.MUNUS_QUOTE_TTL_SECONDS ?? '120', 'MUNUS_QUOTE_TTL_SECONDS') * 1000,
    },
  }
}

function loadReceiverAddress(env: ServerEnv): string | undefined {
  const raw = env.MUNUS_NIM_RECEIVER_ADDRESS?.trim()
  if (!raw) return undefined
  try {
    return normalizeNimiqAddress(raw)
  } catch {
    throw new ServerConfigurationError('MUNUS_NIM_RECEIVER_ADDRESS must be a valid Nimiq address.')
  }
}

function loadClubKonnectConfig(env: ServerEnv): ClubKonnectServerConfig | undefined {
  const userId = env.CLUBKONNECT_USER_ID?.trim() || ''
  const apiKey = env.CLUBKONNECT_API_KEY?.trim() || ''
  if (!userId && !apiKey) return undefined
  if (!userId || !apiKey) {
    throw new ServerConfigurationError('CLUBKONNECT_USER_ID and CLUBKONNECT_API_KEY must both be set.')
  }
  return {
    userId,
    apiKey,
    callbackBaseUrl: env.CLUBKONNECT_CALLBACK_BASE_URL?.trim() || undefined,
  }
}

function loadPaycrestConfig(env: ServerEnv): PaycrestServerConfig | undefined {
  const apiKey = env.PAYCREST_API_KEY?.trim() || ''
  const apiSecret = env.PAYCREST_API_SECRET?.trim() || ''
  const refundAddress = env.PAYCREST_REFUND_ADDRESS?.trim() || ''
  const usdtContractAddress = env.POLYGON_USDT_CONTRACT?.trim() || ''
  if (!apiKey && !apiSecret && !refundAddress && !usdtContractAddress) return undefined
  if (!apiKey || !apiSecret) {
    throw new ServerConfigurationError('PAYCREST_API_KEY and PAYCREST_API_SECRET must both be set.')
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(refundAddress)) {
    throw new ServerConfigurationError('PAYCREST_REFUND_ADDRESS must be a valid Ethereum address.')
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(usdtContractAddress)) {
    throw new ServerConfigurationError('POLYGON_USDT_CONTRACT must be a valid Ethereum address.')
  }
  return {
    apiKey,
    apiSecret,
    refundAddress,
    usdtContractAddress,
    baseUrl: env.PAYCREST_BASE_URL?.trim() || undefined,
  }
}

function normalizeNimiqAddress(value: string): string {
  // Validated with the official Nimiq address primitive used by wallet auth.
  return Address.fromAny(value).toUserFriendlyAddress()
}

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) {
    throw new ServerConfigurationError(`${name} is required by the Munus API server.`)
  }

  return value.trim()
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new ServerConfigurationError(`${name} must be a positive integer.`)
  }

  return parsed
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback
  if (value === 'true') return true
  if (value === 'false') return false
  throw new ServerConfigurationError('MUNUS_COOKIE_SECURE must be true or false.')
}
