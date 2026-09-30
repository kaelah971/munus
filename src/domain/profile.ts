export const PROFILE_COUNTRIES = [
  { code: 'NG', label: 'Nigeria', currency: 'NGN' },
] as const

export const PROFILE_NETWORKS = ['MTN', 'Airtel', 'Glo', '9mobile'] as const

export type ProfileCountry = (typeof PROFILE_COUNTRIES)[number]['code']
export type ProfileNetwork = (typeof PROFILE_NETWORKS)[number]
export type PreferredPaymentAsset = 'NIM'

export interface MunusProfile {
  userId: string
  displayName: string
  avatarReference?: string
  country: ProfileCountry
  localCurrency: 'NGN'
  defaultPhone?: string
  defaultNetwork?: ProfileNetwork
  preferredPaymentAsset: PreferredPaymentAsset
  language: 'en'
  createdAt: string
  updatedAt: string
}

export interface ProfileDraft {
  displayName: string
  country: ProfileCountry
  localCurrency: 'NGN'
  defaultPhone: string
  defaultNetwork: ProfileNetwork | ''
  preferredPaymentAsset: PreferredPaymentAsset
  language: 'en'
}

export const DEFAULT_PROFILE_DRAFT: ProfileDraft = {
  displayName: '',
  country: 'NG',
  localCurrency: 'NGN',
  defaultPhone: '',
  defaultNetwork: '',
  preferredPaymentAsset: 'NIM',
  language: 'en',
}

export function profileToDraft(profile: MunusProfile): ProfileDraft {
  return {
    displayName: profile.displayName,
    country: profile.country,
    localCurrency: profile.localCurrency,
    defaultPhone: profile.defaultPhone ?? '',
    defaultNetwork: profile.defaultNetwork ?? '',
    preferredPaymentAsset: profile.preferredPaymentAsset,
    language: profile.language,
  }
}

export function validateProfileDraft(draft: ProfileDraft): string | null {
  if (draft.displayName.trim().length < 2) {
    return 'Add at least two characters for your display name.'
  }

  if (draft.defaultPhone && !/^\+?\d{10,15}$/.test(draft.defaultPhone.replace(/[\s-]/g, ''))) {
    return 'Use a valid phone number or leave it blank.'
  }

  return null
}

export function createProfile(
  userId: string,
  draft: ProfileDraft,
  now = new Date().toISOString(),
): MunusProfile {
  const error = validateProfileDraft(draft)
  if (error) {
    throw new Error(error)
  }

  return {
    userId,
    displayName: draft.displayName.trim(),
    country: draft.country,
    localCurrency: draft.localCurrency,
    defaultPhone: draft.defaultPhone.trim() || undefined,
    defaultNetwork: draft.defaultNetwork || undefined,
    preferredPaymentAsset: draft.preferredPaymentAsset,
    language: draft.language,
    createdAt: now,
    updatedAt: now,
  }
}

export function updateProfile(
  current: MunusProfile,
  draft: ProfileDraft,
  now = new Date().toISOString(),
): MunusProfile {
  return {
    ...createProfile(current.userId, draft, current.createdAt),
    updatedAt: now,
  }
}
