// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { DatabasePool, DatabaseResult, DatabaseRow, DatabaseTransaction } from './database'
import { PostgresMunusRepository } from './repository'
import { PostgresPlanningRepository } from './planningRepository'
import { PostgresSupportRepository } from './supportRepository'

class FakeDatabasePool implements DatabasePool {
  readonly calls: Array<{ text: string; values: unknown[] }> = []
  private readonly responses: DatabaseResult[] = []

  enqueue(...results: DatabaseResult[]): void {
    this.responses.push(...results)
  }

  async query<Row extends DatabaseRow = DatabaseRow>(text: string, values: unknown[] = []): Promise<DatabaseResult<Row>> {
    this.calls.push({ text, values })
    const result = this.responses.shift()
    if (!result) throw new Error(`No fake database response for: ${text}`)
    return result as DatabaseResult<Row>
  }

  async connect(): Promise<DatabaseTransaction> {
    return {
      query: <Row extends DatabaseRow = DatabaseRow>(text: string, values: unknown[] = []) => this.query<Row>(text, values),
      release: () => undefined,
    }
  }

  async end(): Promise<void> {}
}

const timestamp = '2026-01-01T00:00:00.000Z'

function result(rows: DatabaseRow[] = []): DatabaseResult {
  return { rows, rowCount: rows.length }
}

function pocketRow(plannedAmount = '0'): DatabaseRow {
  return {
    id: 'pocket-1',
    user_id: 'user-1',
    name: 'Data plan',
    type: 'Data',
    unit: 'NGN',
    target_amount: '1000',
    planned_amount: plannedAmount,
    deadline: null,
    status: 'active',
    archived_at: null,
    created_at: timestamp,
    updated_at: timestamp,
  }
}

describe('Munus PostgreSQL repositories', () => {
  it('keeps auth/profile queries parameterized and restores server sessions', async () => {
    const database = new FakeDatabasePool()
    const repository = new PostgresMunusRepository(database)
    const hostileWallet = "wallet'); DROP TABLE users; --"

    database.enqueue(result())
    await repository.createChallenge({
      id: 'challenge-1',
      walletAddress: hostileWallet,
      network: 'mainnet',
      nonce: 'nonce',
      message: 'Sign in',
      expiresAt: Date.parse(timestamp),
      consumedAt: null,
    })
    expect(database.calls[0].text).not.toContain(hostileWallet)
    expect(database.calls[0].values).toContain(hostileWallet)

    database.enqueue(result([{
      id: 'challenge-1',
      wallet_address: hostileWallet,
      wallet_network: 'mainnet',
      nonce: 'nonce',
      message: 'Sign in',
      expires_at: timestamp,
      consumed_at: null,
    }]))
    await expect(repository.getChallenge('challenge-1')).resolves.toMatchObject({ walletAddress: hostileWallet, consumedAt: null })
    database.enqueue(result([{ id: 'challenge-1' }]))
    await expect(repository.consumeChallenge('challenge-1', Date.parse(timestamp))).resolves.toBe(true)

    database.enqueue(result([{ id: 'user-1', wallet_address: 'NQxx', wallet_network: 'mainnet' }]), result([{ user_id: 'user-1', notifications_enabled: true, app_lock_enabled: false }]))
    await expect(repository.getOrCreateUser('NQxx', 'mainnet')).resolves.toMatchObject({ id: 'user-1' })

    database.enqueue(result())
    await repository.createSession({
      id: 'session-1',
      userId: 'user-1',
      walletAddress: 'NQxx',
      network: 'mainnet',
      tokenHash: 'hash',
      expiresAt: Date.parse(timestamp) + 1000,
      revokedAt: null,
      createdAt: Date.parse(timestamp),
    })
    database.enqueue(result([{
      id: 'session-1',
      user_id: 'user-1',
      token_hash: 'hash',
      expires_at: timestamp,
      revoked_at: null,
      created_at: timestamp,
      wallet_address: 'NQxx',
      wallet_network: 'mainnet',
    }]))
    await expect(repository.getSessionByTokenHash('hash')).resolves.toMatchObject({ userId: 'user-1', network: 'mainnet' })

    database.enqueue(result())
    await repository.revokeSession('hash', Date.parse(timestamp))
    database.enqueue(result([{
      user_id: 'user-1',
      display_name: 'Amina',
      avatar_reference: null,
      country: 'NG',
      local_currency: 'NGN',
      default_phone: null,
      default_network: null,
      preferred_payment_asset: 'NIM',
      language: 'en',
      created_at: timestamp,
      updated_at: timestamp,
    }]))
    await expect(repository.saveProfile('user-1', {
      displayName: 'Amina',
      country: 'NG',
      localCurrency: 'NGN',
      defaultPhone: '',
      defaultNetwork: '',
      preferredPaymentAsset: 'NIM',
      language: 'en',
    })).resolves.toMatchObject({ displayName: 'Amina' })

    expect(database.calls.filter((call) => call.text.includes('WHERE user_id = $1')).every((call) => call.values[0] === 'user-1')).toBe(true)
  })

  it('locks a user-owned pocket row and commits allocation atomically', async () => {
    const database = new FakeDatabasePool()
    const repository = new PostgresPlanningRepository(database)
    database.enqueue(
      result(),
      result([pocketRow()]),
      result([{ id: 'entry-1', created_at: timestamp }]),
      result([pocketRow('100.1')]),
      result(),
    )

    const allocation = await repository.addPocketAllocation('user-1', 'pocket-1', {
      amount: '100.1',
      direction: 'allocation',
      note: 'First plan',
    })

    expect(allocation.pocket.plannedAmount).toBe('100.1')
    expect(allocation.entry.id).toBe('entry-1')
    expect(database.calls.map((call) => call.text)).toEqual(expect.arrayContaining(['BEGIN', 'COMMIT']))
    const lock = database.calls.find((call) => call.text.includes('FOR UPDATE'))
    expect(lock?.values).toEqual(['pocket-1', 'user-1'])
    expect(lock?.text).not.toContain('user-1')
  })

  it('returns only a safe public support projection', async () => {
    const database = new FakeDatabasePool()
    const repository = new PostgresSupportRepository(database)
    database.enqueue(result([{
      id: 'internal-request-id',
      owner_user_id: 'user-1',
      requester_user_id: 'user-1',
      recipient_user_id: null,
      contact_id: null,
      public_request_id: 'opaque-id',
      category: 'Airtime',
      requested_amount: '100',
      requested_product: 'Airtime today',
      phone: '08012345678',
      network: 'MTN',
      country: 'NG',
      message: 'Please help.',
      status: 'pending',
      expires_at: null,
      created_at: timestamp,
      updated_at: timestamp,
      requester_label: 'Amina',
    }]))

    const projection = await repository.getPublicSupportRequest('opaque-id')
    expect(projection).toMatchObject({ requesterLabel: 'Amina', phone: '080•••5678' })
    expect(projection).not.toHaveProperty('id')
    expect(database.calls[0].values).toEqual(['opaque-id'])
  })
})
