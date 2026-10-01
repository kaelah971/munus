import { useState, type FormEvent } from 'react'
import { Icon } from '../components/Primitives'
import { normalizeMoney } from '../domain/planning'
import { maskPhone, normalizePhone, SUPPORT_CATEGORIES, SUPPORT_NETWORKS, type Contact, type ContactDraft } from '../domain/support'

type ContactsView = 'list' | 'add' | 'detail' | 'edit'

export function ContactsPage({ contacts, loading = false, error = null, initialView = 'list', initialContactId, onBack, onCreateContact, onUpdateContact, onArchiveContact, onSupportContact }: {
  contacts: Contact[]
  loading?: boolean
  error?: string | null
  initialView?: 'list' | 'add' | 'detail'
  initialContactId?: string
  onBack: () => void
  onCreateContact: (draft: ContactDraft) => Promise<void>
  onUpdateContact: (id: string, draft: ContactDraft) => Promise<void>
  onArchiveContact: (id: string) => Promise<void>
  onSupportContact: (id: string) => void
}) {
  const [view, setView] = useState<ContactsView>(initialView)
  const [contactId, setContactId] = useState(initialContactId)
  const [search, setSearch] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [archiving, setArchiving] = useState(false)
  const activeContacts = contacts.filter((contact) => !contact.archivedAt)
  const contact = activeContacts.find((item) => item.id === contactId)
  const query = search.toLowerCase().trim()
  const visible = activeContacts.filter((item) => `${item.displayName} ${item.relationship ?? ''} ${item.phone}`.toLowerCase().includes(query))

  async function save(draft: ContactDraft) {
    if (view === 'edit' && contact) await onUpdateContact(contact.id, draft)
    else await onCreateContact(draft)
    setView('list')
    setActionError(null)
  }

  async function archive() {
    if (!contact || archiving) return
    setArchiving(true)
    setActionError(null)
    try { await onArchiveContact(contact.id); setView('list') }
    catch (caught) { setActionError(errorMessage(caught)) }
    finally { setArchiving(false) }
  }

  function returnToList() { setView('list'); setActionError(null) }

  return (
    <section className="contacts-page screen-content" aria-labelledby="contacts-title">
      <button className="back-link" type="button" onClick={view === 'list' ? onBack : returnToList}><Icon name="back" size={18} />{view === 'list' ? 'Back' : 'All contacts'}</button>
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
      {actionError ? <p className="inline-error" role="alert">{actionError}</p> : null}
      {loading ? <p className="loading-copy" role="status">Loading your contacts…</p> : null}
      {view === 'add' || view === 'edit' ? (
        <ContactEditor key={view === 'edit' ? contact?.id : 'new'} initial={view === 'edit' && contact ? toDraft(contact) : emptyDraft()} editing={view === 'edit'} onCancel={returnToList} onSubmit={save} />
      ) : view === 'detail' && contact ? (
        <div className="contact-detail-screen">
          <span className="contact-avatar contact-avatar--large" aria-hidden="true">{initials(contact.displayName)}</span>
          <h1 id="contacts-title">{contact.displayName}</h1>
          <p className="section-copy">{contact.relationship || 'Saved contact'}</p>
          <dl className="contact-details">
            <div><dt>Phone</dt><dd>{maskPhone(contact.phone)}</dd></div>
            <div><dt>Network</dt><dd>{contact.network || 'Not saved'}</dd></div>
            {contact.usualProductType ? <div><dt>Usual product</dt><dd>{contact.usualProductType}</dd></div> : null}
            {contact.usualAmount ? <div><dt>Usual amount</dt><dd>{contact.usualAmount}</dd></div> : null}
            {contact.notes ? <div><dt>Notes</dt><dd>{contact.notes}</dd></div> : null}
          </dl>
          <button className="primary-button" type="button" onClick={() => onSupportContact(contact.id)}>Support this person</button>
          <div className="form-actions"><button className="quiet-button" type="button" onClick={() => setView('edit')} disabled={archiving}>Edit</button><button className="quiet-button" type="button" onClick={() => void archive()} disabled={archiving}>{archiving ? 'Archiving…' : 'Archive'}</button></div>
        </div>
      ) : (
        <>
          <div className="section-heading-row"><h1 id="contacts-title">Saved contacts</h1><button className="quiet-button" type="button" onClick={() => setView('add')}>Add</button></div>
          <label className="search-field"><span>Search contacts</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name or phone" /></label>
          <div className="contacts-list">
            {visible.map((item) => (
              <button className="contact-list-row" type="button" key={item.id} onClick={() => { setContactId(item.id); setView('detail') }}>
                <span className="contact-avatar" aria-hidden="true">{initials(item.displayName)}</span>
                <span className="contact-row-copy"><strong>{item.displayName}</strong><small>{item.relationship || 'Saved contact'} · {maskPhone(item.phone)}</small></span>
                <Icon name="arrow" size={18} />
              </button>
            ))}
          </div>
          {!loading && !visible.length ? <p className="section-copy">{query ? 'No contacts match your search.' : 'Add someone you support often.'}</p> : null}
        </>
      )}
    </section>
  )
}

function ContactEditor({ initial, editing, onSubmit, onCancel }: { initial: ContactDraft; editing: boolean; onSubmit: (draft: ContactDraft) => Promise<void>; onCancel: () => void }) {
  const [draft, setDraft] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError(null)
    try {
      if (draft.displayName.trim().length < 2) throw new Error('Use a name with at least 2 characters.')
      const normalized = { ...draft, displayName: draft.displayName.trim(), phone: normalizePhone(draft.phone), usualAmount: draft.usualAmount ? normalizeMoney(draft.usualAmount, false) : '' }
      setBusy(true)
      await onSubmit(normalized)
    } catch (caught) { setError(errorMessage(caught)) }
    finally { setBusy(false) }
  }
  return (
    <form className="contact-editor planning-form" onSubmit={(event) => void submit(event)}>
      <h1 id="contacts-title">{editing ? 'Edit contact' : 'Add contact'}</h1>
      <div className="form-grid">
        <label><span>Name</span><input autoComplete="name" value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} disabled={busy} /></label>
        <label><span>Phone</span><input autoComplete="tel" type="tel" inputMode="tel" value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} disabled={busy} /></label>
        <label><span>Network</span><select value={draft.network} onChange={(event) => setDraft({ ...draft, network: event.target.value as ContactDraft['network'] })} disabled={busy}><option value="">Not saved</option>{SUPPORT_NETWORKS.map((network) => <option key={network}>{network}</option>)}</select></label>
        <label><span>Relationship</span><input value={draft.relationship} onChange={(event) => setDraft({ ...draft, relationship: event.target.value })} disabled={busy} /></label>
      </div>
      <details className="contact-more-details">
        <summary>More details</summary>
        <div className="form-grid">
          <label><span>Usual product</span><select value={draft.usualProductType} onChange={(event) => setDraft({ ...draft, usualProductType: event.target.value as ContactDraft['usualProductType'] })} disabled={busy}><option value="">Not saved</option>{SUPPORT_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>
          <label><span>Usual amount</span><input inputMode="decimal" value={draft.usualAmount} onChange={(event) => setDraft({ ...draft, usualAmount: event.target.value })} disabled={busy} /></label>
          <label className="form-grid__wide"><span>Notes</span><textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} disabled={busy} /></label>
        </div>
      </details>
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
      <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save contact'}</button>
      <button className="quiet-button" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
    </form>
  )
}

function emptyDraft(): ContactDraft { return { displayName: '', relationship: '', phone: '', network: '', country: 'NG', usualProductType: '', usualAmount: '', notes: '' } }
function toDraft(contact: Contact): ContactDraft { return { displayName: contact.displayName, relationship: contact.relationship || '', phone: contact.phone, network: contact.network || '', country: contact.country, usualProductType: contact.usualProductType || '', usualAmount: contact.usualAmount || '', notes: contact.notes || '' } }
function initials(name: string) { return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() }
function errorMessage(caught: unknown) { return caught instanceof Error ? caught.message : 'Munus could not save that contact. Try again.' }
