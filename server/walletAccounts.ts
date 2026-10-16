import { withTransaction, type DatabasePool } from './database'
import { normalizeNimiqAddress } from './nimiqSignature'

/**
 * Server-persisted Nimiq Pay exposed account set. Established only from
 * explicit Connect / diagnostics discovery, scoped to the canonical user,
 * and read back on silent session restore so the aggregate funding
 * context never depends on webview localStorage. Addresses are public
 * on-chain data — never auth identity, never a payment authority.
 */

/** Upper bound: host-exposed sets are tiny; the bound prevents abuse. */
export const MAX_WALLET_ACCOUNTS = 25

export class WalletAccountError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message)
    this.name = 'WalletAccountError'
  }
}

export interface WalletAccountStore {
  listAccounts(userId: string): Promise<string[]>
  /**
   * Atomically replaces the user's set with the validated, normalized,
   * deduplicated addresses. Returns the canonical set.
   */
  replaceAccounts(userId: string, addresses: unknown): Promise<string[]>
}

/** Canonical user-friendly spelling, deduplicated by compact form. */
export function normalizeAccountSet(addresses: unknown): string[] {
  if (!Array.isArray(addresses)) {
    throw new WalletAccountError('Addresses must be a list of Nimiq addresses.')
  }
  if (addresses.length > MAX_WALLET_ACCOUNTS) {
    throw new WalletAccountError(`At most ${MAX_WALLET_ACCOUNTS} wallet addresses can be saved.`)
  }
  const seen = new Set<string>()
  const canonical: string[] = []
  for (const entry of addresses) {
    if (typeof entry !== 'string' || !entry.trim()) {
      throw new WalletAccountError('Every wallet address must be a non-empty string.')
    }
    let normalized: string
    try {
      // Hosts may report any case; the encoding itself is uppercase
      // base32, so case-folding before validation is value-preserving.
      normalized = normalizeNimiqAddress(entry.toUpperCase())
    } catch {
      throw new WalletAccountError('Every wallet address must be a valid Nimiq address.')
    }
    const key = normalized.replace(/\s+/g, '').toUpperCase()
    if (seen.has(key)) continue
    seen.add(key)
    canonical.push(normalized)
  }
  return canonical
}

export class InMemoryWalletAccountStore implements WalletAccountStore {
  private readonly table = new Map<string, string[]>()

  async listAccounts(userId: string): Promise<string[]> {
    return [...(this.table.get(userId) ?? [])]
  }

  async replaceAccounts(userId: string, addresses: unknown): Promise<string[]> {
    const canonical = normalizeAccountSet(addresses)
    this.table.set(userId, canonical)
    return [...canonical]
  }
}

export class PostgresWalletAccountStore implements WalletAccountStore {
  constructor(private readonly database: DatabasePool) {}

  async listAccounts(userId: string): Promise<string[]> {
    const result = await this.database.query<{ address: string }>(
      `SELECT address FROM public.user_wallet_accounts WHERE user_id = $1 ORDER BY address`,
      [userId],
    )
    return result.rows.map((row) => String(row.address))
  }

  async replaceAccounts(userId: string, addresses: unknown): Promise<string[]> {
    const canonical = normalizeAccountSet(addresses)
    await withTransaction(this.database, async (client) => {
      await client.query(`DELETE FROM public.user_wallet_accounts WHERE user_id = $1`, [userId])
      for (const address of canonical) {
        await client.query(
          `INSERT INTO public.user_wallet_accounts (user_id, address) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [userId, address],
        )
      }
    })
    return canonical
  }
}
