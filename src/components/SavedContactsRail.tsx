import type { Contact } from '../domain/support'

export function SavedContactsRail({ contacts, loading = false, onAdd, onSeeAll, onContact }: {
  contacts: Contact[]
  loading?: boolean
  onAdd: () => void
  onSeeAll: () => void
  onContact: (id: string) => void
}) {
  const visibleContacts = contacts.filter((contact) => !contact.archivedAt)
    .slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4)
  return (
    <section className="saved-contacts" aria-labelledby="saved-contacts-title">
      <div className="section-heading-row">
        <h2 id="saved-contacts-title">Saved contacts</h2>
        <button className="quiet-button" type="button" onClick={onSeeAll}>See all</button>
      </div>
      <div className="saved-contacts-rail">
        <button className="contact-rail-item" type="button" aria-label="Add contact" onClick={onAdd}>
          <span className="contact-avatar contact-avatar--add" aria-hidden="true">+</span><span>Add</span>
        </button>
        {visibleContacts.map((contact) => (
          <button className="contact-rail-item" type="button" key={contact.id} aria-label={`Open contact ${contact.displayName}`} onClick={() => onContact(contact.id)}>
            <span className="contact-avatar" aria-hidden="true">{initials(contact.displayName)}</span>
            <span>{contact.displayName}</span>
          </button>
        ))}
      </div>
      {loading ? <p className="section-copy" role="status">Loading contacts…</p> : null}
    </section>
  )
}

function initials(name: string) { return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() }
