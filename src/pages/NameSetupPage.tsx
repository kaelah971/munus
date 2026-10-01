import { useState, type FormEvent } from 'react'
import { Icon, PrimaryButton } from '../components/Primitives'
import { DEFAULT_PROFILE_DRAFT, validateProfileDraft } from '../domain/profile'

export function NameSetupPage({ initialName, onContinue, onBack }: {
  initialName: string
  onContinue: (name: string) => void
  onBack: () => void
}) {
  const [name, setName] = useState(initialName)
  const [error, setError] = useState<string | null>(null)

  function submit(event: FormEvent) {
    event.preventDefault()
    const validation = validateProfileDraft({ ...DEFAULT_PROFILE_DRAFT, displayName: name })
    setError(validation)
    if (!validation) onContinue(name.trim())
  }

  return <main className="setup-screen" aria-labelledby="name-title">
    <button className="icon-button setup-back" aria-label="Back" type="button" onClick={onBack}><Icon name="back" /></button>
    <div className="setup-body">
      <h1 id="name-title">What should we call you?</h1>
      <p className="setup-lede">Choose the name you’d like to see in Munus.</p>
      <form className="setup-form" onSubmit={submit}>
        <label htmlFor="personal-name">Your name</label>
        <input id="personal-name" autoComplete="given-name" value={name} onChange={(event) => setName(event.target.value)} aria-describedby={error ? 'name-error' : undefined} aria-invalid={Boolean(error)} />
        {error && <p className="inline-error" id="name-error" role="alert">{error}</p>}
        <PrimaryButton type="submit">Continue <Icon name="arrow" size={18} /></PrimaryButton>
      </form>
    </div>
  </main>
}
