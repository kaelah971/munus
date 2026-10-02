import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { MunusSession } from '../src/domain/auth'
import type {
  ChallengeRecord,
  MunusRepository,
  ServerNetwork,
  SessionRecord,
} from './repository'
import { normalizeNimiqAddress, verifyNimiqSignature } from './nimiqSignature'

export type AuthErrorCode =
  | 'AUTH_CHALLENGE_ADDRESS_MISMATCH'
  | 'AUTH_INVALID_SIGNATURE'

export interface AuthServiceOptions {
  challengeTtlMs: number
  sessionTtlMs: number
  now?: () => number
  randomToken?: () => string
}

export interface CreateChallengeInput {
  walletAddress: string
  network: ServerNetwork
}

export interface VerifyChallengeInput {
  challengeId: string
  walletAddress: string
  publicKey: string
  signature: string
}

export interface AuthenticatedSession {
  session: MunusSession
  token: string
}

export class AuthServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code?: AuthErrorCode,
  ) {
    super(message)
    this.name = 'AuthServiceError'
  }
}

export class MunusAuthService {
  private readonly now: () => number
  private readonly randomToken: () => string

  constructor(
    private readonly repository: MunusRepository,
    private readonly options: AuthServiceOptions,
  ) {
    this.now = options.now ?? Date.now
    this.randomToken = options.randomToken ?? createSessionToken
  }

  async createChallenge(input: CreateChallengeInput): Promise<{
    id: string
    walletAddress: string
    network: ServerNetwork
    message: string
    expiresAt: number
  }> {
    const walletAddress = normalizeAddressOrThrow(input.walletAddress)
    const expiresAt = this.now() + this.options.challengeTtlMs
    const nonce = randomBytes(32).toString('base64url')
    const challenge: ChallengeRecord = {
      id: randomUUID(),
      walletAddress,
      network: input.network,
      nonce,
      message: [
        'Sign in to Munus.',
        `Network: ${input.network}`,
        `Nonce: ${nonce}`,
        `Expires: ${new Date(expiresAt).toISOString()}`,
      ].join('\n'),
      expiresAt,
      consumedAt: null,
    }

    await this.repository.createChallenge(challenge)
    return {
      id: challenge.id,
      walletAddress: challenge.walletAddress,
      network: challenge.network,
      message: challenge.message,
      expiresAt: challenge.expiresAt,
    }
  }

  async verifyChallenge(input: VerifyChallengeInput): Promise<AuthenticatedSession> {
    const challenge = await this.repository.getChallenge(input.challengeId)
    if (!challenge) {
      throw new AuthServiceError('Munus challenge was not found.', 400)
    }

    const now = this.now()
    if (challenge.consumedAt !== null) {
      throw new AuthServiceError('Munus challenge has already been used.', 409)
    }
    if (challenge.expiresAt <= now) {
      throw new AuthServiceError('Munus challenge has expired.', 410)
    }

    const suppliedAddress = normalizeAddressOrThrow(input.walletAddress)
    if (suppliedAddress !== challenge.walletAddress) {
      throw new AuthServiceError(
        'Authentication request does not match its challenge.',
        401,
        'AUTH_CHALLENGE_ADDRESS_MISMATCH',
      )
    }

    // The signed public key is the cryptographic identity. Nimiq Pay's sign()
    // method does not accept an account selector, so accounts[0] is only the
    // client-side challenge hint and must not determine the authenticated user.
    const verified = verifyNimiqSignature({
      publicKey: input.publicKey,
      signature: input.signature,
      message: challenge.message,
    })
    if (!verified.valid) {
      throw new AuthServiceError(
        'Munus could not verify the Nimiq Pay signature.',
        401,
        'AUTH_INVALID_SIGNATURE',
      )
    }

    // The conditional repository operation makes consumption single-use even if
    // two requests verify the same signature concurrently.
    const consumed = await this.repository.consumeChallenge(challenge.id, now)
    if (!consumed) {
      throw new AuthServiceError('Munus challenge has already been used.', 409)
    }

    const user = await this.repository.getOrCreateUser(verified.walletAddress, challenge.network)
    const token = this.randomToken()
    const record: SessionRecord = {
      id: randomUUID(),
      userId: user.id,
      walletAddress: user.walletAddress,
      network: user.network,
      tokenHash: hashSessionToken(token),
      expiresAt: now + this.options.sessionTtlMs,
      revokedAt: null,
      createdAt: now,
    }
    await this.repository.createSession(record)

    return {
      token,
      session: toMunusSession(record),
    }
  }

  async restoreSession(token: string | null): Promise<MunusSession | null> {
    if (!token) return null
    const record = await this.repository.getSessionByTokenHash(hashSessionToken(token))
    if (!record || record.revokedAt !== null || record.expiresAt <= this.now()) return null
    return toMunusSession(record)
  }

  async revokeSession(token: string | null): Promise<void> {
    if (!token) return
    await this.repository.revokeSession(hashSessionToken(token), this.now())
  }
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function normalizeAddressOrThrow(walletAddress: string): string {
  try {
    return normalizeNimiqAddress(walletAddress)
  } catch {
    throw new AuthServiceError('Munus requires a valid Nimiq wallet address.', 400)
  }
}

function createSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

function toMunusSession(record: SessionRecord): MunusSession {
  return {
    id: record.id,
    userId: record.userId,
    walletAddress: record.walletAddress,
    network: record.network,
    issuedAt: record.createdAt,
    expiresAt: record.expiresAt,
    trust: 'server-verified',
  }
}
