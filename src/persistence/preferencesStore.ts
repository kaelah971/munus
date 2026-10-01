export interface MunusPreferences {
  userId: string
  notificationsEnabled: boolean
  appLockEnabled: boolean
  hideBalances: boolean
}

const PREFERENCES_KEY_PREFIX = 'munus:preferences:'

export class LocalPreferencesStore {
  constructor(private readonly storage: Storage | null = getStorage()) {}

  get(userId: string): MunusPreferences {
    const fallback: MunusPreferences = {
      userId,
      notificationsEnabled: true,
      appLockEnabled: false,
      hideBalances: false,
    }
    const raw = this.storage?.getItem(`${PREFERENCES_KEY_PREFIX}${userId}`)
    if (!raw) return fallback

    try {
      return { ...fallback, ...(JSON.parse(raw) as Partial<MunusPreferences>) }
    } catch {
      return fallback
    }
  }

  save(preferences: MunusPreferences): void {
    this.storage?.setItem(
      `${PREFERENCES_KEY_PREFIX}${preferences.userId}`,
      JSON.stringify(preferences),
    )
  }
}

export const preferencesStore = new LocalPreferencesStore()

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null

  try {
    return window.localStorage
  } catch {
    return null
  }
}
