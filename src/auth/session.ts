import { munusConfig } from '../config'
import type {
  AuthChallenge,
  AuthGateway,
  MunusNetwork,
  MunusSession,
} from '../domain/auth'

const CHALLENGE_TTL_MS = 5 * 60 * 1000

export class AuthUnavailableError extends Error {
  constructor(message = 'Munus authentication is not configured for this environment.') {
    super(message)
    this.name = 'AuthUnavailableError'
  }
}

export function createAuthGateway(): AuthGateway {
  if (munusConfig.productionAuth || munusConfig.apiBaseUrl) {
    return createRemoteAuthGateway(munusConfig.apiBaseUrl)
  }

  if (munusConfig.localDevelopmentAuth) {
    return createLocalDevelopmentAuthGateway()
  }

  return new UnavailableAuthGateway()
}

export function createLocalDevelopmentAuthGateway(): AuthGateway {
  return new LocalDevelopmentAuthGateway()
}

export function createRemoteAuthGateway(baseUrl: string): AuthGateway {
  return new RemoteAuthGateway(baseUrl.replace(/\/$/, ''))
}

export function createUnavailableAuthGateway(): AuthGateway {
  return new UnavailableAuthGateway()
}

class UnavailableAuthGateway implements AuthGateway {
  readonly mode = 'unavailable' as const

  async signIn(): Promise<MunusSession> {
    throw new AuthUnavailableError()
  }

  async restoreSession(): Promise<MunusSession | null> {
    return null
  }

  async signOut(): Promise<void> {
    // There is no local or remote session to revoke.
  }
}

class LocalDevelopmentAuthGateway implements AuthGateway {
  readonly mode = 'local-development' as const

  async signIn(
    walletAddress: string,
    sign: (message: string) => Promise<{ publicKey: string; signature: string }>,
    network: MunusNetwork = 'mainnet',
  ): Promise<MunusSession> {
    const challenge = createLocalChallenge(walletAddress, network)
    const signed = await sign(challenge.message)

    if (!signed.publicKey || !signed.signature) {
      throw new Error('Nimiq Pay did not return a usable challenge signature.')
    }

    const now = Date.now()
    return {
      id: `local-session-${stableId(walletAddress)}-${now}`,
      userId: `local-user-${stableId(walletAddress)}`,
      walletAddress,
      network,
      issuedAt: now,
      expiresAt: now + 24 * 60 * 60 * 1000,
      trust: 'development-only-unverified',
    }
  }

  async restoreSession(): Promise<MunusSession | null> {
    // LocalSessionStore owns development session restoration in the client.
    return null
  }

  async signOut(): Promise<void> {
    // Local development sessions are removed by LocalSessionStore.
  }
}

class RemoteAuthGateway implements AuthGateway {
  readonly mode = 'remote' as const

  constructor(private readonly baseUrl: string) {}

  async signIn(
    walletAddress: string,
    sign: (message: string) => Promise<{ publicKey: string; signature: string }>,
    network: MunusNetwork = 'mainnet',
  ): Promise<MunusSession> {
    const challenge = await requestJson<AuthChallenge>(this.baseUrl, '/auth/challenge', {
      walletAddress,
      network,
    })
    assertChallenge(challenge, walletAddress, network)
    const signed = await sign(challenge.message)
    const session = await requestJson<unknown>(this.baseUrl, '/auth/verify', {
      challengeId: challenge.id,
      walletAddress,
      publicKey: signed.publicKey,
      signature: signed.signature,
    })

    return parseServerSession(session)
  }

  async restoreSession(): Promise<MunusSession | null> {
    const response = await requestJson<{ session?: unknown }>(
      this.baseUrl,
      '/auth/session',
      undefined,
      'GET',
    )
    if (!response.session) return null
    return parseServerSession(response.session)
  }

  async signOut(): Promise<void> {
    await requestJson(this.baseUrl, '/auth/logout', undefined, 'POST')
  }
}

function createLocalChallenge(walletAddress: string, network: MunusNetwork): AuthChallenge {
  const now = Date.now()
  const expiresAt = now + CHALLENGE_TTL_MS
  const id = createId()

  return {
    id,
    walletAddress,
    network,
    expiresAt,
    message: [
      'Sign in to Munus.',
      `Wallet: ${walletAddress}`,
      `Network: ${network}`,
      `Nonce: ${id}`,
      `Expires: ${new Date(expiresAt).toISOString()}`,
    ].join('\n'),
  }
}

function assertChallenge(
  challenge: AuthChallenge,
  walletAddress: string,
  network: MunusNetwork,
): void {
  if (
    !challenge.id ||
    !challenge.message ||
    challenge.walletAddress !== walletAddress ||
    challenge.network !== network ||
    challenge.expiresAt <= Date.now()
  ) {
    throw new Error('Munus authentication returned an invalid or expired challenge.')
  }
}

function parseServerSession(value: unknown): MunusSession {
  if (!value || typeof value !== 'object') {
    throw new Error('Munus authentication returned an invalid session.')
  }

  const session = value as Partial<MunusSession>
  if (
    typeof session.id !== 'string' ||
    typeof session.userId !== 'string' ||
    typeof session.walletAddress !== 'string' ||
    typeof session.network !== 'string' ||
    (session.network !== 'mainnet' && session.network !== 'testnet') ||
    typeof session.issuedAt !== 'number' ||
    typeof session.expiresAt !== 'number' ||
    session.expiresAt <= Date.now()
  ) {
    throw new Error('Munus authentication returned an incomplete session.')
  }

  return {
    id: session.id,
    userId: session.userId,
    walletAddress: session.walletAddress,
    network: session.network,
    issuedAt: session.issuedAt,
    expiresAt: session.expiresAt,
    trust: 'server-verified',
  }
}

type SafeAuthErrorCode = 'AUTH_SIGNER_ADDRESS_MISMATCH' | 'AUTH_INVALID_SIGNATURE'

const safeAuthErrorMessages: Record<SafeAuthErrorCode, string> = {
  AUTH_SIGNER_ADDRESS_MISMATCH: 'The Nimiq account that signed does not match the challenged account.',
  AUTH_INVALID_SIGNATURE: 'Munus could not verify the Nimiq Pay signature.',
}

async function requestJson<T>(
  baseUrl: string,
  path: string,
  body?: unknown,
  method = 'POST',
): Promise<T> {
  if (typeof fetch !== 'function') {
    throw new AuthUnavailableError('Fetch is unavailable; Munus cannot reach its auth service.')
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (!response.ok) {
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      payload = undefined
    }

    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const errorCode = (payload as { code?: unknown }).code
      if (typeof errorCode === 'string' && errorCode in safeAuthErrorMessages) {
        throw new Error(safeAuthErrorMessages[errorCode as SafeAuthErrorCode])
      }

      const serverMessage = (payload as { error?: unknown }).error
      if (typeof serverMessage === 'string') throw new Error(serverMessage)
    }

    throw new Error(`Munus authentication request failed (${response.status}).`)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

function createId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function stableId(value: string): string {
  let hash = 2166136261
  for (const character of value) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0).toString(16)
}
