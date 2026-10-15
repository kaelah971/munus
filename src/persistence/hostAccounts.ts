/**
 * Host-exposed Nimiq account set, persisted per authenticated user after an
 * explicit Connect (or an explicit diagnostics refresh). Reused on silent
 * session restore so Home never triggers a wallet permission prompt.
 *
 * These are public on-chain addresses, keyed by canonical user id so one
 * device user never sees another's set. Overwritten on every fresh
 * Connect; cleared on sign-out. Never a source of auth identity.
 */
export interface HostAccountSet {
  userId: string
  addresses: string[]
  observedAt: string
}

const STORAGE_KEY = 'munus:host-accounts'

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null

  try {
    return window.localStorage
  } catch {
    return null
  }
}

function isValidSet(value: unknown): value is HostAccountSet {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.userId === 'string' &&
    Array.isArray(record.addresses) &&
    record.addresses.every((entry) => typeof entry === 'string') &&
    typeof record.observedAt === 'string'
  )
}

export function normalizeHostAddress(address: string): string {
  return address.replace(/\s+/g, '').toUpperCase()
}

export function readHostAccounts(userId: string): HostAccountSet | null {
  try {
    const raw = getStorage()?.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const entry = (parsed as Record<string, unknown>)[userId]
    return isValidSet(entry) && entry.userId === userId ? entry : null
  } catch {
    return null
  }
}

export function saveHostAccounts(userId: string, addresses: readonly string[]): void {
  try {
    const storage = getStorage()
    if (!storage) return
    let table: Record<string, unknown> = {}
    try {
      const raw = storage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed: unknown = JSON.parse(raw)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          table = parsed as Record<string, unknown>
        }
      }
    } catch {
      table = {}
    }
    const clean = [...new Set(
      addresses.filter((entry) => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean),
    )]
    table[userId] = { userId, addresses: clean, observedAt: new Date().toISOString() }
    storage.setItem(STORAGE_KEY, JSON.stringify(table))
  } catch {
    // Browser storage is a convenience cache; failures must not break auth.
  }
}

export function clearHostAccounts(userId: string): void {
  try {
    const storage = getStorage()
    if (!storage) return
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
    const table = parsed as Record<string, unknown>
    delete table[userId]
    storage.setItem(STORAGE_KEY, JSON.stringify(table))
  } catch {
    // Ignore: nothing security-relevant is at stake beyond cached addresses.
  }
}
