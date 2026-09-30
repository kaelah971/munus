import { useState } from 'react'
import {
  DEFAULT_PROFILE_DRAFT,
  PROFILE_COUNTRIES,
  PROFILE_NETWORKS,
  validateProfileDraft,
  type ProfileDraft,
} from '../domain/profile'
import { PrimaryButton, QuietButton } from './Primitives'

export function ProfileForm({
  initialDraft = DEFAULT_PROFILE_DRAFT,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initialDraft?: ProfileDraft
  submitLabel: string
  onSubmit: (draft: ProfileDraft) => Promise<void> | void
  onCancel?: () => void
}) {
  const [draft, setDraft] = useState<ProfileDraft>(initialDraft)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const validationError = validateProfileDraft(draft)
    if (validationError) {
      setError(validationError)
      return
    }

    setError(null)
    setBusy(true)
    try {
      await onSubmit(draft)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Profile could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="profile-form" onSubmit={handleSubmit}>
      <label>
        <span>Display name</span>
        <input
          autoComplete="name"
          maxLength={80}
          onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
          placeholder="How should Munus greet you?"
          value={draft.displayName}
        />
      </label>

      <div className="form-grid">
        <label>
          <span>Country</span>
          <select
            onChange={(event) =>
              setDraft({
                ...draft,
                country: event.target.value as ProfileDraft['country'],
                localCurrency: 'NGN',
              })
            }
            value={draft.country}
          >
            {PROFILE_COUNTRIES.map((country) => (
              <option key={country.code} value={country.code}>
                {country.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Currency</span>
          <input disabled value={draft.localCurrency} />
        </label>
      </div>

      <label>
        <span>Default phone <em>Optional</em></span>
        <input
          autoComplete="tel"
          inputMode="tel"
          onChange={(event) => setDraft({ ...draft, defaultPhone: event.target.value })}
          placeholder="080…"
          value={draft.defaultPhone}
        />
      </label>

      <label>
        <span>Default network <em>Optional</em></span>
        <select
          onChange={(event) =>
            setDraft({
              ...draft,
              defaultNetwork: event.target.value as ProfileDraft['defaultNetwork'],
            })
          }
          value={draft.defaultNetwork}
        >
          <option value="">Choose later</option>
          {PROFILE_NETWORKS.map((network) => (
            <option key={network} value={network}>
              {network}
            </option>
          ))}
        </select>
      </label>

      <div className="profile-asset-choice">
        <span>Preferred payment asset</span>
        <strong>NIM</strong>
        <small>NIM is the primary Munus payment asset.</small>
      </div>

      {error ? <p className="form-error" role="alert">{error}</p> : null}

      <div className="form-actions">
        {onCancel ? <QuietButton onClick={onCancel}>Cancel</QuietButton> : null}
        <PrimaryButton disabled={busy} type="submit">
          {busy ? 'Saving…' : submitLabel}
        </PrimaryButton>
      </div>
    </form>
  )
}
