import type { MunusSession } from '../domain/auth'

const SESSION_KEY = 'munus:session'

export interface SessionStore {
  get(): MunusSession | null
  save(session: MunusSession): void
  clear(): void
}

export class LocalSessionStore implements SessionStore {
  constructor(private readonly storage: Storage | null = getStorage()) {}

  get(): MunusSession | null {
    const raw = this.storage?.getItem(SESSION_KEY)
    if (!raw) return null

    try {
      const session = JSON.parse(raw) as MunusSession
      if (
        typeof session.id !== 'string' ||
        typeof session.userId !== 'string' ||
        typeof session.walletAddress !== 'string' ||
        typeof session.expiresAt !== 'number' ||
        session.expiresAt <= Date.now()
      ) {
        this.clear()
        return null
      }
      return session
    } catch {
      this.clear()
      return null
    }
  }

  save(session: MunusSession): void {
    this.storage?.setItem(SESSION_KEY, JSON.stringify(session))
  }

  clear(): void {
    this.storage?.removeItem(SESSION_KEY)
  }
}

export const sessionStore = new LocalSessionStore()

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null

  try {
    return window.localStorage
  } catch {
    return null
  }
}
