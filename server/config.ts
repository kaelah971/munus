export class ServerConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ServerConfigurationError'
  }
}

export interface MunusServerConfig {
  port: number
  supabaseUrl: string
  supabaseServiceRoleKey: string
  cookieName: string
  cookieSecure: boolean
  challengeTtlMs: number
  sessionTtlMs: number
  defaultNetwork: 'mainnet' | 'testnet'
  corsOrigin?: string
}

export interface ServerEnv {
  MUNUS_SERVER_PORT?: string
  MUNUS_COOKIE_NAME?: string
  MUNUS_COOKIE_SECURE?: string
  MUNUS_CHALLENGE_TTL_SECONDS?: string
  MUNUS_SESSION_TTL_SECONDS?: string
  MUNUS_NIMIQ_NETWORK?: string
  MUNUS_CORS_ORIGIN?: string
  NODE_ENV?: string
  SUPABASE_URL?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
}

export function loadServerConfig(env: ServerEnv = process.env): MunusServerConfig {
  const supabaseUrl = required(env.SUPABASE_URL, 'SUPABASE_URL')
  const supabaseServiceRoleKey = required(
    env.SUPABASE_SERVICE_ROLE_KEY,
    'SUPABASE_SERVICE_ROLE_KEY',
  )
  const port = positiveInteger(env.MUNUS_SERVER_PORT ?? '8787', 'MUNUS_SERVER_PORT')
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
    supabaseUrl,
    supabaseServiceRoleKey,
    cookieName: env.MUNUS_COOKIE_NAME ?? 'munus_session',
    cookieSecure: parseBoolean(
      env.MUNUS_COOKIE_SECURE,
      env.NODE_ENV === 'production',
    ),
    challengeTtlMs: challengeTtlSeconds * 1000,
    sessionTtlMs: sessionTtlSeconds * 1000,
    defaultNetwork,
    corsOrigin: env.MUNUS_CORS_ORIGIN?.trim() || undefined,
  }
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
