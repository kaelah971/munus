import type { MunusProfile } from '../domain/profile'

const PROFILE_KEY_PREFIX = 'munus:profile:'

export interface ProfileStore {
  get(userId: string): MunusProfile | null
  save(profile: MunusProfile): void
}

export class LocalProfileStore implements ProfileStore {
  constructor(private readonly storage: Storage | null = getStorage()) {}

  get(userId: string): MunusProfile | null {
    const raw = this.storage?.getItem(`${PROFILE_KEY_PREFIX}${userId}`)
    if (!raw) return null

    try {
      return JSON.parse(raw) as MunusProfile
    } catch {
      return null
    }
  }

  save(profile: MunusProfile): void {
    this.storage?.setItem(
      `${PROFILE_KEY_PREFIX}${profile.userId}`,
      JSON.stringify(profile),
    )
  }
}

export const profileStore = new LocalProfileStore()

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null

  try {
    return window.localStorage
  } catch {
    return null
  }
}
