import {
  PROFILE_COUNTRIES,
  PROFILE_NETWORKS,
  type ProfileDraft,
} from '../src/domain/profile'
import type { PreferencesRecord } from './repository'

export class RequestValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RequestValidationError'
  }
}

export function parsePreferences(
  value: unknown,
  current: PreferencesRecord,
): PreferencesRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RequestValidationError('Preferences body must be an object.')
  }

  const input = value as Record<string, unknown>
  const notificationsEnabled = booleanField(
    input.notificationsEnabled,
    current.notificationsEnabled,
    'notificationsEnabled',
  )
  const appLockEnabled = booleanField(
    input.appLockEnabled,
    current.appLockEnabled,
    'appLockEnabled',
  )

  return {
    userId: current.userId,
    notificationsEnabled,
    appLockEnabled,
  }
}

export function parseProfileDraft(value: unknown): ProfileDraft {
  if (!value || typeof value !== 'object') {
    throw new RequestValidationError('Profile body must be an object.')
  }

  const input = value as Record<string, unknown>
  const displayName = stringField(input.displayName, 'displayName')
  const defaultPhone = optionalStringField(input.defaultPhone, 'defaultPhone')
  const defaultNetwork = optionalStringField(input.defaultNetwork, 'defaultNetwork')

  if (displayName.trim().length < 2 || displayName.trim().length > 80) {
    throw new RequestValidationError('Display name must be between 2 and 80 characters.')
  }
  if (defaultPhone && !/^\+?\d{10,15}$/.test(defaultPhone.replace(/[\s-]/g, ''))) {
    throw new RequestValidationError('Use a valid phone number or leave it blank.')
  }
  if (defaultNetwork && !PROFILE_NETWORKS.some((network) => network === defaultNetwork)) {
    throw new RequestValidationError('Choose a supported Nigerian network or leave it blank.')
  }
  if (input.country !== 'NG' || input.localCurrency !== 'NGN') {
    throw new RequestValidationError('Munus currently supports Nigeria and NGN profiles only.')
  }
  if (input.preferredPaymentAsset !== 'NIM' || input.language !== 'en') {
    throw new RequestValidationError('Profile asset and language defaults are not supported.')
  }

  return {
    displayName: displayName.trim(),
    country: PROFILE_COUNTRIES[0].code,
    localCurrency: 'NGN',
    defaultPhone,
    defaultNetwork: (defaultNetwork ?? '') as ProfileDraft['defaultNetwork'],
    preferredPaymentAsset: 'NIM',
    language: 'en',
  }
}

function booleanField(value: unknown, fallback: boolean, name: string): boolean {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') {
    throw new RequestValidationError(`${name} must be a boolean.`)
  }
  return value
}

function stringField(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    throw new RequestValidationError(`${name} must be a string.`)
  }
  return value
}

function optionalStringField(value: unknown, name: string): string {
  if (value === undefined || value === null) return ''
  return stringField(value, name)
}
