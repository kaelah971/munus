import { DEFAULT_PROFILE_DRAFT, validateProfileDraft } from '../domain/profile'

const KEY = 'munus:pending-name'

export function isValidDisplayName(name: string): boolean {
  return !validateProfileDraft({ ...DEFAULT_PROFILE_DRAFT, displayName: name })
}

export function readPendingName(): string {
  try {
    const name = window.sessionStorage.getItem(KEY) ?? ''
    return isValidDisplayName(name) ? name : ''
  } catch {
    return ''
  }
}

export function storePendingName(name: string) {
  try {
    if (name) window.sessionStorage.setItem(KEY, name)
    else window.sessionStorage.removeItem(KEY)
  } catch {
    // React state remains usable when session storage is unavailable.
  }
}
