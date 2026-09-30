import type { MunusProfile, ProfileDraft } from '../src/domain/profile'
import type { DatabaseClient } from './database'

export type ServerNetwork = 'mainnet' | 'testnet'

export interface ChallengeRecord {
  id: string
  walletAddress: string
  network: ServerNetwork
  nonce: string
  message: string
  expiresAt: number
  consumedAt: number | null
}

export interface UserRecord {
  id: string
  walletAddress: string
  network: ServerNetwork
}

export interface SessionRecord {
  id: string
  userId: string
  walletAddress: string
  network: ServerNetwork
  tokenHash: string
  expiresAt: number
  revokedAt: number | null
  createdAt: number
}

export interface PreferencesRecord {
  userId: string
  notificationsEnabled: boolean
  appLockEnabled: boolean
}

export interface MunusRepository {
  createChallenge(challenge: ChallengeRecord): Promise<void>
  getChallenge(id: string): Promise<ChallengeRecord | null>
  consumeChallenge(id: string, consumedAt: number): Promise<boolean>
  getOrCreateUser(walletAddress: string, network: ServerNetwork): Promise<UserRecord>
  createSession(session: SessionRecord): Promise<void>
  getSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null>
  revokeSession(tokenHash: string, revokedAt: number): Promise<void>
  getPreferences(userId: string): Promise<PreferencesRecord>
  savePreferences(preferences: PreferencesRecord): Promise<PreferencesRecord>
  getProfile(userId: string): Promise<MunusProfile | null>
  saveProfile(userId: string, draft: ProfileDraft): Promise<MunusProfile>
}

export class InMemoryMunusRepository implements MunusRepository {
  readonly challenges = new Map<string, ChallengeRecord>()
  readonly users = new Map<string, UserRecord>()
  readonly sessions = new Map<string, SessionRecord>()
  readonly preferences = new Map<string, PreferencesRecord>()
  readonly profiles = new Map<string, MunusProfile>()

  async createChallenge(challenge: ChallengeRecord): Promise<void> {
    this.challenges.set(challenge.id, challenge)
  }

  async getChallenge(id: string): Promise<ChallengeRecord | null> {
    return this.challenges.get(id) ?? null
  }

  async consumeChallenge(id: string, consumedAt: number): Promise<boolean> {
    const challenge = this.challenges.get(id)
    if (!challenge || challenge.consumedAt !== null) return false
    challenge.consumedAt = consumedAt
    return true
  }

  async getOrCreateUser(walletAddress: string, network: ServerNetwork): Promise<UserRecord> {
    const existing = [...this.users.values()].find((user) => user.walletAddress === walletAddress)
    if (existing) {
      if (!this.preferences.has(existing.id)) this.preferences.set(existing.id, defaultPreferences(existing.id))
      return existing
    }

    const user = {
      id: `user-${this.users.size + 1}`,
      walletAddress,
      network,
    }
    this.users.set(user.id, user)
    this.preferences.set(user.id, defaultPreferences(user.id))
    return user
  }

  async createSession(session: SessionRecord): Promise<void> {
    this.sessions.set(session.tokenHash, session)
  }

  async getSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    return this.sessions.get(tokenHash) ?? null
  }

  async revokeSession(tokenHash: string, revokedAt: number): Promise<void> {
    const session = this.sessions.get(tokenHash)
    if (session) session.revokedAt = revokedAt
  }

  async getPreferences(userId: string): Promise<PreferencesRecord> {
    const existing = this.preferences.get(userId)
    if (existing) return existing
    const created = defaultPreferences(userId)
    this.preferences.set(userId, created)
    return created
  }

  async savePreferences(preferences: PreferencesRecord): Promise<PreferencesRecord> {
    this.preferences.set(preferences.userId, preferences)
    return preferences
  }

  async getProfile(userId: string): Promise<MunusProfile | null> {
    return this.profiles.get(userId) ?? null
  }

  async saveProfile(userId: string, draft: ProfileDraft): Promise<MunusProfile> {
    const existing = this.profiles.get(userId)
    const now = new Date().toISOString()
    const profile: MunusProfile = {
      userId,
      displayName: draft.displayName.trim(),
      avatarReference: existing?.avatarReference,
      country: draft.country,
      localCurrency: draft.localCurrency,
      defaultPhone: draft.defaultPhone.trim() || undefined,
      defaultNetwork: draft.defaultNetwork || undefined,
      preferredPaymentAsset: draft.preferredPaymentAsset,
      language: draft.language,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    this.profiles.set(userId, profile)
    return profile
  }
}

export class PostgresMunusRepository implements MunusRepository {
  constructor(private readonly database: DatabaseClient) {}

  async createChallenge(challenge: ChallengeRecord): Promise<void> {
    await this.run('persist auth challenge', () => this.database.query(
      `INSERT INTO auth_challenges
        (id, wallet_address, wallet_network, nonce, message, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        challenge.id,
        challenge.walletAddress,
        challenge.network,
        challenge.nonce,
        challenge.message,
        new Date(challenge.expiresAt),
      ],
    ))
  }

  async getChallenge(id: string): Promise<ChallengeRecord | null> {
    const result = await this.run('load auth challenge', () => this.database.query(
      `SELECT id, wallet_address, wallet_network, nonce, message, expires_at, consumed_at
       FROM auth_challenges
       WHERE id = $1`,
      [id],
    ))
    const row = result.rows[0]
    if (!row) return null
    return {
      id: String(row.id),
      walletAddress: String(row.wallet_address),
      network: row.wallet_network as ServerNetwork,
      nonce: String(row.nonce),
      message: String(row.message),
      expiresAt: timestampMillis(row.expires_at),
      consumedAt: row.consumed_at ? timestampMillis(row.consumed_at) : null,
    }
  }

  async consumeChallenge(id: string, consumedAt: number): Promise<boolean> {
    const result = await this.run('consume auth challenge', () => this.database.query(
      `UPDATE auth_challenges
       SET consumed_at = $2
       WHERE id = $1 AND consumed_at IS NULL
       RETURNING id`,
      [id, new Date(consumedAt)],
    ))
    return result.rowCount === 1 || result.rows.length === 1
  }

  async getOrCreateUser(walletAddress: string, network: ServerNetwork): Promise<UserRecord> {
    const result = await this.run('persist Munus user', () => this.database.query(
      `INSERT INTO users (wallet_address, wallet_network)
       VALUES ($1, $2)
       ON CONFLICT (wallet_address) DO UPDATE
         SET wallet_network = EXCLUDED.wallet_network,
             updated_at = NOW()
       RETURNING id, wallet_address, wallet_network`,
      [walletAddress, network],
    ))
    const row = requireRow(result.rows[0], 'Munus user')
    await this.getPreferences(String(row.id))
    return {
      id: String(row.id),
      walletAddress: String(row.wallet_address),
      network: row.wallet_network as ServerNetwork,
    }
  }

  async createSession(session: SessionRecord): Promise<void> {
    await this.run('persist Munus session', () => this.database.query(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [session.id, session.userId, session.tokenHash, new Date(session.expiresAt)],
    ))
  }

  async getSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    const result = await this.run('load Munus session', () => this.database.query(
      `SELECT s.id, s.user_id, s.token_hash, s.expires_at, s.revoked_at, s.created_at,
              u.wallet_address, u.wallet_network
       FROM sessions AS s
       JOIN users AS u ON u.id = s.user_id
       WHERE s.token_hash = $1`,
      [tokenHash],
    ))
    const row = result.rows[0]
    if (!row) return null
    return {
      id: String(row.id),
      userId: String(row.user_id),
      walletAddress: String(row.wallet_address),
      network: row.wallet_network as ServerNetwork,
      tokenHash: String(row.token_hash),
      expiresAt: timestampMillis(row.expires_at),
      revokedAt: row.revoked_at ? timestampMillis(row.revoked_at) : null,
      createdAt: timestampMillis(row.created_at),
    }
  }

  async revokeSession(tokenHash: string, revokedAt: number): Promise<void> {
    await this.run('revoke Munus session', () => this.database.query(
      `UPDATE sessions
       SET revoked_at = $2
       WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash, new Date(revokedAt)],
    ))
  }

  async getPreferences(userId: string): Promise<PreferencesRecord> {
    const result = await this.run('load Munus preferences', () => this.database.query(
      `SELECT user_id, notifications_enabled, app_lock_enabled
       FROM user_preferences
       WHERE user_id = $1`,
      [userId],
    ))
    const row = result.rows[0]
    if (!row) return this.savePreferences(defaultPreferences(userId))
    return mapPreferences(row)
  }

  async savePreferences(preferences: PreferencesRecord): Promise<PreferencesRecord> {
    const result = await this.run('save Munus preferences', () => this.database.query(
      `INSERT INTO user_preferences (user_id, notifications_enabled, app_lock_enabled)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE
         SET notifications_enabled = EXCLUDED.notifications_enabled,
             app_lock_enabled = EXCLUDED.app_lock_enabled,
             updated_at = NOW()
       RETURNING user_id, notifications_enabled, app_lock_enabled`,
      [preferences.userId, preferences.notificationsEnabled, preferences.appLockEnabled],
    ))
    return mapPreferences(requireRow(result.rows[0], 'Munus preferences'))
  }

  async getProfile(userId: string): Promise<MunusProfile | null> {
    const result = await this.run('load Munus profile', () => this.database.query(
      `SELECT user_id, display_name, avatar_reference, country, local_currency,
              default_phone, default_network, preferred_payment_asset, language,
              created_at, updated_at
       FROM profiles
       WHERE user_id = $1`,
      [userId],
    ))
    const row = result.rows[0]
    return row ? mapProfile(row) : null
  }

  async saveProfile(userId: string, draft: ProfileDraft): Promise<MunusProfile> {
    const result = await this.run('save Munus profile', () => this.database.query(
      `INSERT INTO profiles
        (user_id, display_name, country, local_currency, default_phone,
         default_network, preferred_payment_asset, language)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id) DO UPDATE
         SET display_name = EXCLUDED.display_name,
             country = EXCLUDED.country,
             local_currency = EXCLUDED.local_currency,
             default_phone = EXCLUDED.default_phone,
             default_network = EXCLUDED.default_network,
             preferred_payment_asset = EXCLUDED.preferred_payment_asset,
             language = EXCLUDED.language,
             updated_at = NOW()
       RETURNING user_id, display_name, avatar_reference, country, local_currency,
                 default_phone, default_network, preferred_payment_asset, language,
                 created_at, updated_at`,
      [
        userId,
        draft.displayName.trim(),
        draft.country,
        draft.localCurrency,
        draft.defaultPhone.trim() || null,
        draft.defaultNetwork || null,
        draft.preferredPaymentAsset,
        draft.language,
      ],
    ))
    return mapProfile(requireRow(result.rows[0], 'Munus profile'))
  }

  private async run<T>(label: string, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      throw new Error(`Could not ${label}: ${errorMessage(error)}`, { cause: error })
    }
  }
}

function defaultPreferences(userId: string): PreferencesRecord {
  return {
    userId,
    notificationsEnabled: true,
    appLockEnabled: false,
  }
}

function mapPreferences(row: Record<string, unknown>): PreferencesRecord {
  return {
    userId: String(row.user_id),
    notificationsEnabled: Boolean(row.notifications_enabled),
    appLockEnabled: Boolean(row.app_lock_enabled),
  }
}

function mapProfile(row: Record<string, unknown>): MunusProfile {
  return {
    userId: String(row.user_id),
    displayName: String(row.display_name),
    avatarReference: row.avatar_reference ? String(row.avatar_reference) : undefined,
    country: row.country as MunusProfile['country'],
    localCurrency: row.local_currency as MunusProfile['localCurrency'],
    defaultPhone: row.default_phone ? String(row.default_phone) : undefined,
    defaultNetwork: row.default_network as MunusProfile['defaultNetwork'],
    preferredPaymentAsset: row.preferred_payment_asset as MunusProfile['preferredPaymentAsset'],
    language: row.language as MunusProfile['language'],
    createdAt: timestampString(row.created_at),
    updatedAt: timestampString(row.updated_at),
  }
}

function requireRow(row: Record<string, unknown> | undefined, label: string): Record<string, unknown> {
  if (!row) throw new Error(`${label} was not returned by the database.`)
  return row
}

function timestampMillis(value: unknown): number {
  if (value instanceof Date) return value.getTime()
  return Date.parse(String(value))
}

function timestampString(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
