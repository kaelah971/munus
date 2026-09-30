import type { SupabaseClient } from '@supabase/supabase-js'
import type { MunusProfile, ProfileDraft } from '../src/domain/profile'

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

export class SupabaseMunusRepository implements MunusRepository {
  constructor(private readonly client: SupabaseClient) {}

  async createChallenge(challenge: ChallengeRecord): Promise<void> {
    const { error } = await this.client.from('auth_challenges').insert({
      id: challenge.id,
      wallet_address: challenge.walletAddress,
      wallet_network: challenge.network,
      nonce: challenge.nonce,
      message: challenge.message,
      expires_at: new Date(challenge.expiresAt).toISOString(),
    })
    if (error) throw new Error(`Could not persist auth challenge: ${error.message}`)
  }

  async getChallenge(id: string): Promise<ChallengeRecord | null> {
    const { data, error } = await this.client
      .from('auth_challenges')
      .select('id,wallet_address,wallet_network,nonce,message,expires_at,consumed_at')
      .eq('id', id)
      .maybeSingle()
    if (error) throw new Error(`Could not load auth challenge: ${error.message}`)
    if (!data) return null

    return {
      id: data.id,
      walletAddress: data.wallet_address,
      network: data.wallet_network,
      nonce: data.nonce,
      message: data.message,
      expiresAt: Date.parse(data.expires_at),
      consumedAt: data.consumed_at ? Date.parse(data.consumed_at) : null,
    }
  }

  async consumeChallenge(id: string, consumedAt: number): Promise<boolean> {
    const { data, error } = await this.client
      .from('auth_challenges')
      .update({ consumed_at: new Date(consumedAt).toISOString() })
      .eq('id', id)
      .is('consumed_at', null)
      .select('id')
    if (error) throw new Error(`Could not consume auth challenge: ${error.message}`)
    return Array.isArray(data) && data.length === 1
  }

  async getOrCreateUser(walletAddress: string, network: ServerNetwork): Promise<UserRecord> {
    const { data, error } = await this.client
      .from('users')
      .upsert(
        {
          wallet_address: walletAddress,
          wallet_network: network,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'wallet_address' },
      )
      .select('id,wallet_address,wallet_network')
      .single()
    if (error) throw new Error(`Could not persist Munus user: ${error.message}`)
    await this.getPreferences(data.id)

    return {
      id: data.id,
      walletAddress: data.wallet_address,
      network: data.wallet_network,
    }
  }

  async createSession(session: SessionRecord): Promise<void> {
    const { error } = await this.client.from('sessions').insert({
      id: session.id,
      user_id: session.userId,
      token_hash: session.tokenHash,
      expires_at: new Date(session.expiresAt).toISOString(),
    })
    if (error) throw new Error(`Could not persist Munus session: ${error.message}`)
  }

  async getSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    const { data, error } = await this.client
      .from('sessions')
      .select(
        'id,user_id,token_hash,expires_at,revoked_at,created_at,users(wallet_address,wallet_network)',
      )
      .eq('token_hash', tokenHash)
      .maybeSingle()
    if (error) throw new Error(`Could not load Munus session: ${error.message}`)
    if (!data) return null

    const user = Array.isArray(data.users) ? data.users[0] : data.users
    if (!user) throw new Error('Munus session has no owning user.')

    return {
      id: data.id,
      userId: data.user_id,
      walletAddress: user.wallet_address,
      network: user.wallet_network,
      tokenHash: data.token_hash,
      expiresAt: Date.parse(data.expires_at),
      revokedAt: data.revoked_at ? Date.parse(data.revoked_at) : null,
      createdAt: Date.parse(data.created_at),
    }
  }

  async revokeSession(tokenHash: string, revokedAt: number): Promise<void> {
    const { error } = await this.client
      .from('sessions')
      .update({ revoked_at: new Date(revokedAt).toISOString() })
      .eq('token_hash', tokenHash)
      .is('revoked_at', null)
    if (error) throw new Error(`Could not revoke Munus session: ${error.message}`)
  }

  async getPreferences(userId: string): Promise<PreferencesRecord> {
    const { data, error } = await this.client
      .from('user_preferences')
      .select('user_id,notifications_enabled,app_lock_enabled')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) throw new Error(`Could not load Munus preferences: ${error.message}`)
    if (!data) return this.savePreferences(defaultPreferences(userId))

    return {
      userId: data.user_id,
      notificationsEnabled: data.notifications_enabled,
      appLockEnabled: data.app_lock_enabled,
    }
  }

  async savePreferences(preferences: PreferencesRecord): Promise<PreferencesRecord> {
    const { data, error } = await this.client
      .from('user_preferences')
      .upsert(
        {
          user_id: preferences.userId,
          notifications_enabled: preferences.notificationsEnabled,
          app_lock_enabled: preferences.appLockEnabled,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      )
      .select('user_id,notifications_enabled,app_lock_enabled')
      .single()
    if (error) throw new Error(`Could not save Munus preferences: ${error.message}`)

    return {
      userId: data.user_id,
      notificationsEnabled: data.notifications_enabled,
      appLockEnabled: data.app_lock_enabled,
    }
  }

  async getProfile(userId: string): Promise<MunusProfile | null> {
    const { data, error } = await this.client
      .from('profiles')
      .select(
        'user_id,display_name,avatar_reference,country,local_currency,default_phone,default_network,preferred_payment_asset,language,created_at,updated_at',
      )
      .eq('user_id', userId)
      .maybeSingle()
    if (error) throw new Error(`Could not load Munus profile: ${error.message}`)
    if (!data) return null

    return mapProfile(data)
  }

  async saveProfile(userId: string, draft: ProfileDraft): Promise<MunusProfile> {
    const { data, error } = await this.client
      .from('profiles')
      .upsert(
        {
          user_id: userId,
          display_name: draft.displayName.trim(),
          country: draft.country,
          local_currency: draft.localCurrency,
          default_phone: draft.defaultPhone.trim() || null,
          default_network: draft.defaultNetwork || null,
          preferred_payment_asset: draft.preferredPaymentAsset,
          language: draft.language,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      )
      .select(
        'user_id,display_name,avatar_reference,country,local_currency,default_phone,default_network,preferred_payment_asset,language,created_at,updated_at',
      )
      .single()
    if (error) throw new Error(`Could not save Munus profile: ${error.message}`)

    return mapProfile(data)
  }
}

function defaultPreferences(userId: string): PreferencesRecord {
  return {
    userId,
    notificationsEnabled: true,
    appLockEnabled: false,
  }
}

function mapProfile(row: Record<string, string | null>): MunusProfile {
  return {
    userId: row.user_id as string,
    displayName: row.display_name as string,
    avatarReference: row.avatar_reference ?? undefined,
    country: row.country as MunusProfile['country'],
    localCurrency: row.local_currency as MunusProfile['localCurrency'],
    defaultPhone: row.default_phone ?? undefined,
    defaultNetwork: row.default_network as MunusProfile['defaultNetwork'],
    preferredPaymentAsset: row.preferred_payment_asset as MunusProfile['preferredPaymentAsset'],
    language: row.language as MunusProfile['language'],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}
