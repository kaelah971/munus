import type { PinRecord } from '../security/appLock'

const PIN_KEY_PREFIX = 'munus:pin:'

export class LocalPinStore {
  constructor(private readonly storage: Storage | null = getStorage()) {}

  get(userId: string): PinRecord | null {
    const raw = this.storage?.getItem(`${PIN_KEY_PREFIX}${userId}`)
    if (!raw) return null

    try {
      return JSON.parse(raw) as PinRecord
    } catch {
      return null
    }
  }

  save(userId: string, record: PinRecord): void {
    this.storage?.setItem(`${PIN_KEY_PREFIX}${userId}`, JSON.stringify(record))
  }

  clear(userId: string): void {
    this.storage?.removeItem(`${PIN_KEY_PREFIX}${userId}`)
  }
}

export const pinStore = new LocalPinStore()

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null

  try {
    return window.localStorage
  } catch {
    return null
  }
}
