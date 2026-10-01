import { useState } from 'react'
import { EmptyState, Icon, SectionHeading } from '../components/Primitives'
import type { NimiqConnectionState } from '../integration/nimiq'
import type { AppDestination } from '../navigation'
import {
  SUPPORT_CATEGORIES,
  SUPPORT_NETWORKS,
  type Contact,
  type ContactDraft,
  type SupportDraft,
  type SupportDraftInput,
  type SupportRequest,
  type SupportRequestDraft,
  type SupportRequestStatus,
  type SupportRule,
  type SupportRuleDraft,
} from '../domain/support'

export type SupportPageMode = 'support' | 'request' | 'contacts'

export function SupportPage({
  authenticated,
  initialMode,
  initialContactId,
  onOpenContacts,
  loading,
  error,
  contacts,
  supportRules,
  supportRequests,
  supportDrafts,
  onNavigate,
  onCreateSupportRule,
  onUpdateSupportRule,
  onDeleteSupportRule,
  onCreateSupportRequest,
  onUpdateSupportRequest,
  onCancelSupportRequest,
  onConvertRequest,
  onCreateSupportDraft,
  onUpdateSupportDraft,
}: {
  connection: NimiqConnectionState
  authenticated: boolean
  initialMode: SupportPageMode
  initialContactId?: string
  onOpenContacts?: (view?: 'list' | 'add') => void
  loading: boolean
  error: string | null
  contacts: Contact[]
  supportRules: SupportRule[]
  supportRequests: SupportRequest[]
  supportDrafts: SupportDraft[]
  onNavigate: (destination: AppDestination) => void
  onCreateContact: (draft: ContactDraft) => Promise<void>
  onUpdateContact: (id: string, draft: ContactDraft) => Promise<void>
  onArchiveContact: (id: string) => Promise<void>
  onCreateSupportRule: (draft: SupportRuleDraft) => Promise<void>
  onUpdateSupportRule: (id: string, draft: SupportRuleDraft) => Promise<void>
  onDeleteSupportRule: (id: string) => Promise<void>
  onCreateSupportRequest: (draft: SupportRequestDraft) => Promise<void>
  onUpdateSupportRequest: (id: string, draft: SupportRequestDraft, status: SupportRequestStatus) => Promise<void>
  onCancelSupportRequest: (id: string) => Promise<void>
  onConvertRequest: (id: string) => Promise<void>
  onCreateSupportDraft: (input: SupportDraftInput) => Promise<void>
  onUpdateSupportDraft: (id: string, input: SupportDraftInput) => Promise<void>
}) {
  const initialContact = contacts.find((contact) => contact.id === initialContactId && !contact.archivedAt) ?? null
  const [mode, setMode] = useState<SupportPageMode>(initialMode === 'contacts' ? 'support' : initialMode)
  const [supportStep, setSupportStep] = useState<'choose' | 'form' | 'review'>(initialContact ? 'form' : 'choose')
  const [supportContact, setSupportContact] = useState<Contact | null>(initialContact)
  const [editingDraft, setEditingDraft] = useState<SupportDraft | null>(null)
  const [supportForm, setSupportForm] = useState<SupportDraftInput>(() => initialContact ? { ...supportFormFromContact(initialContact), productDetails: initialContact.usualProductType ? `${initialContact.usualProductType} support` : '' } : emptySupportDraft())
  const [requestForm, setRequestForm] = useState<SupportRequestDraft>(emptyRequestDraft())
  const [requestFormOpen, setRequestFormOpen] = useState(initialMode === 'request')
  const [ruleFormOpen, setRuleFormOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<SupportRule | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  function openContacts(view: 'list' | 'add' = 'list') {
    if (onOpenContacts) onOpenContacts(view)
    else onNavigate('contacts')
  }

  async function runAction(action: () => Promise<void>, after?: () => void) {
    setActionError(null)
    try { await action(); after?.() } catch (caught) { setActionError(caught instanceof Error ? caught.message : 'Munus could not save that support detail.') }
  }

  function chooseSupportContact(contact: Contact) {
    setSupportContact(contact)
    setSupportForm({ ...supportFormFromContact(contact), category: contact.usualProductType ?? 'Airtime', amount: contact.usualAmount ?? '', productDetails: contact.usualProductType ? `${contact.usualProductType} support` : '' })
    setSupportStep('form')
  }

  function editDraft(draft: SupportDraft) {
    setEditingDraft(draft)
    setSupportContact(contacts.find((contact) => contact.id === draft.contactId) ?? null)
    setSupportForm(draftToInput(draft))
    setSupportStep('form')
    setMode('support')
  }

  return (
    <section className="screen-content support-page" aria-labelledby="support-title">
          <p className="eyebrow">Human support</p>
          <h1 id="support-title">Support Mode</h1>
          <p className="screen-lede">Prepare specific help for someone you care about. Nothing moves until you review and approve a payment.</p>
          {error ? <p className="inline-error" role="alert">{error}</p> : null}
          {actionError ? <p className="inline-error" role="alert">{actionError}</p> : null}
          <div className="support-tabs" role="tablist" aria-label="Support areas">
            <button className={mode === 'support' ? 'support-tab support-tab--active' : 'support-tab'} type="button" onClick={() => setMode('support')}>Support someone</button>
            <button className={mode === 'request' ? 'support-tab support-tab--active' : 'support-tab'} type="button" onClick={() => setMode('request')}>Request help</button>
            <button className={mode === 'contacts' ? 'support-tab support-tab--active' : 'support-tab'} type="button" onClick={() => openContacts()}>Contacts</button>
          </div>

          {loading ? <p className="loading-copy">Loading your support context…</p> : null}
          {!authenticated ? <EmptyState description="Connect your Munus account to save contacts and review support drafts." icon="user" title="Connect to support someone" /> : null}

          {authenticated && mode === 'support' ? (
            <>
              {supportStep === 'choose' ? (
                <section className="support-section"><div className="section-heading-row"><SectionHeading>Choose a person</SectionHeading><button className="quiet-button" type="button" onClick={() => openContacts()}>Manage contacts</button></div>{contacts.length ? <div className="support-contact-list">{contacts.map((contact) => <ContactChoice key={contact.id} contact={contact} onClick={() => chooseSupportContact(contact)} />)}</div> : <EmptyState description="Save Mum, Dad, Home, or another person manually before preparing support." icon="user" title="No contacts yet" />}<button className="primary-button" type="button" onClick={() => openContacts('add')}>Save a contact</button></section>
              ) : null}
              {supportStep === 'form' ? <SupportDraftForm contact={supportContact} draft={supportForm} onBack={() => setSupportStep('choose')} onChange={setSupportForm} onSubmit={() => setSupportStep('review')} /> : null}
              {supportStep === 'review' ? <SupportDraftReview contact={supportContact} draft={supportForm} onBack={() => setSupportStep('form')} onSubmit={() => void runAction(() => editingDraft ? onUpdateSupportDraft(editingDraft.id, supportForm) : onCreateSupportDraft(supportForm), () => { setEditingDraft(null); setSupportForm(emptySupportDraft()); setSupportStep('choose') })} /> : null}
              <SupportDraftList drafts={supportDrafts} onEdit={editDraft} />
              <SupportRulesSection contacts={contacts} rules={supportRules} formOpen={ruleFormOpen} editingRule={editingRule} onToggleForm={() => { setEditingRule(null); setRuleFormOpen((open) => !open) }} onEdit={(rule) => { setEditingRule(rule); setRuleFormOpen(true) }} onDelete={(id) => void runAction(() => onDeleteSupportRule(id))} onSubmit={(draft) => void runAction(() => editingRule ? onUpdateSupportRule(editingRule.id, draft) : onCreateSupportRule(draft), () => { setRuleFormOpen(false); setEditingRule(null) })} />
            </>
          ) : null}

          {authenticated && mode === 'request' ? <RequestHelpSection contacts={contacts} requests={supportRequests} requestForm={requestForm} requestFormOpen={requestFormOpen} onCreate={(draft) => void runAction(() => onCreateSupportRequest(draft), () => { setRequestForm(emptyRequestDraft()); setRequestFormOpen(false) })} onCancel={(id) => void runAction(() => onCancelSupportRequest(id))} onChange={setRequestForm} onConvert={(id) => void runAction(() => onConvertRequest(id))} onToggleForm={() => setRequestFormOpen((open) => !open)} onUpdate={(id, draft, status) => void runAction(() => onUpdateSupportRequest(id, draft, status))} /> : null}
    </section>
  )
}

function ContactChoice({ contact, onClick }: { contact: Contact; onClick: () => void }) { return <button className="support-contact-choice" type="button" onClick={onClick}><span className="pocket-row-icon"><Icon name="user" size={18} /></span><span><strong>{contact.displayName}</strong><small>{contact.relationship ?? 'Saved contact'} · {maskContact(contact.phone)}{contact.network ? ` · ${contact.network}` : ''}</small></span><Icon name="arrow" size={16} /></button> }

function SupportDraftForm({ contact, draft, onBack, onChange, onSubmit }: { contact: Contact | null; draft: SupportDraftInput; onBack: () => void; onChange: (draft: SupportDraftInput) => void; onSubmit: () => void }) { return <section className="support-section planning-form"><button className="back-link" type="button" onClick={onBack}><Icon name="arrow" size={16} /> Choose someone else</button><SectionHeading>Prepare support for {contact?.displayName ?? draft.recipientName}</SectionHeading><div className="recipient-summary"><strong>{contact?.displayName ?? draft.recipientName}</strong><span>{maskContact(draft.recipientPhone)} · {draft.recipientNetwork || 'Network to confirm'}</span></div><div className="form-grid"><label><span>Category</span><select value={draft.category} onChange={(event) => onChange({ ...draft, category: event.target.value as SupportDraftInput['category'] })}>{SUPPORT_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label><label><span>Unit</span><select value={draft.unit} onChange={(event) => onChange({ ...draft, unit: event.target.value as SupportDraftInput['unit'] })}><option>NGN</option><option>NIM</option></select></label><label><span>Amount</span><input inputMode="decimal" value={draft.amount} onChange={(event) => onChange({ ...draft, amount: event.target.value })} placeholder="100" /></label><label className="form-grid__wide"><span>Product/details</span><input value={draft.productDetails} onChange={(event) => onChange({ ...draft, productDetails: event.target.value })} placeholder="₦100 airtime" /></label></div><p className="truth-note"><Icon name="info" size={18} /><span>Nothing moves until you review and approve a payment. This is only a support draft.</span></p><button className="primary-button" type="button" onClick={onSubmit}>Continue to review</button></section> }

function SupportDraftReview({ contact, draft, onBack, onSubmit }: { contact: Contact | null; draft: SupportDraftInput; onBack: () => void; onSubmit: () => void }) { return <section className="support-section planning-form"><button className="back-link" type="button" onClick={onBack}><Icon name="arrow" size={16} /> Edit draft</button><SectionHeading>Review support draft</SectionHeading><div className="review-list"><div><span>Person</span><strong>{contact?.displayName ?? draft.recipientName} · {maskContact(draft.recipientPhone)}</strong></div><div><span>Need</span><strong>{draft.productDetails}</strong></div><div><span>Planned amount</span><strong>{draft.amount} {draft.unit}</strong></div><div><span>Network</span><strong>{draft.recipientNetwork || 'Confirm later'}</strong></div></div><p className="truth-note"><Icon name="info" size={18} /><span>Nothing moves until you review and approve a payment.</span></p><button className="primary-button" type="button" onClick={onSubmit}>Save support draft</button></section> }

function SupportDraftList({ drafts, onEdit }: { drafts: SupportDraft[]; onEdit: (draft: SupportDraft) => void }) { return <section className="support-section"><div className="section-heading-row"><SectionHeading>Saved support drafts</SectionHeading><span className="section-meta">No payment action</span></div>{drafts.length ? <div className="planning-list">{drafts.map((draft) => <div className="planning-row" key={draft.id}><div><strong>{draft.recipientName}</strong><small>{draft.productDetails} · {draft.amount} {draft.unit} · {draft.status}</small></div><button className="quiet-button" type="button" onClick={() => onEdit(draft)}>Edit</button></div>)}</div> : <p className="section-copy">Support plans you save will stay reviewable here.</p>}</section> }

function SupportRulesSection({ contacts, rules, formOpen, editingRule, onToggleForm, onEdit, onDelete, onSubmit }: { contacts: Contact[]; rules: SupportRule[]; formOpen: boolean; editingRule: SupportRule | null; onToggleForm: () => void; onEdit: (rule: SupportRule) => void; onDelete: (id: string) => void; onSubmit: (draft: SupportRuleDraft) => void }) { return <section className="support-section"><div className="section-heading-row"><SectionHeading>Support boundaries</SectionHeading><button className="quiet-button" type="button" onClick={onToggleForm}>{formOpen ? 'Close' : 'Add boundary'}</button></div><p className="section-copy">Soft warnings for planned support only. They never block a future payment.</p>{formOpen ? <SupportRuleForm key={editingRule?.id ?? 'new'} contacts={contacts} initial={editingRule ? ruleToDraft(editingRule) : undefined} onSubmit={onSubmit} /> : null}{rules.length ? <div className="planning-list">{rules.map((rule) => <div className="planning-row" key={rule.id}><div><strong>{rule.category}</strong><small>{rule.softLimitAmount} {rule.unit} · {rule.period} · {rule.enabled ? `Warn at ${rule.warningThreshold}%` : 'Disabled'}</small></div><div className="planning-row-actions"><button className="quiet-button" type="button" onClick={() => onEdit(rule)}>Edit</button><button className="quiet-button" type="button" onClick={() => onDelete(rule.id)}>Delete</button></div></div>)}</div> : <p className="section-copy">No support boundaries set.</p>}</section> }

function SupportRuleForm({ contacts, initial = emptyRuleDraft(), onSubmit }: { contacts: Contact[]; initial?: SupportRuleDraft; onSubmit: (draft: SupportRuleDraft) => void }) { const [draft, setDraft] = useState(initial); return <div className="planning-form planning-form--compact"><div className="form-grid"><label><span>Person (optional)</span><select value={draft.contactId} onChange={(event) => setDraft({ ...draft, contactId: event.target.value })}><option value="">General support</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.displayName}</option>)}</select></label><label><span>Category</span><select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as SupportRuleDraft['category'] })}>{SUPPORT_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label><label><span>Limit</span><input inputMode="decimal" value={draft.softLimitAmount} onChange={(event) => setDraft({ ...draft, softLimitAmount: event.target.value })} placeholder="5000" /></label><label><span>Unit</span><select value={draft.unit} onChange={(event) => setDraft({ ...draft, unit: event.target.value as SupportRuleDraft['unit'] })}><option>NGN</option><option>NIM</option></select></label><label><span>Period</span><select value={draft.period} onChange={(event) => setDraft({ ...draft, period: event.target.value as SupportRuleDraft['period'] })}><option>monthly</option><option>weekly</option></select></label><label><span>Warn at %</span><input inputMode="numeric" value={draft.warningThreshold} onChange={(event) => setDraft({ ...draft, warningThreshold: Number(event.target.value) })} /></label></div><button className="primary-button" type="button" onClick={() => onSubmit(draft)}>Save boundary</button></div> }

function RequestHelpSection({ contacts, requests, requestForm, requestFormOpen, onCreate, onCancel, onChange, onConvert, onToggleForm, onUpdate }: { contacts: Contact[]; requests: SupportRequest[]; requestForm: SupportRequestDraft; requestFormOpen: boolean; onCreate: (draft: SupportRequestDraft) => void; onCancel: (id: string) => void; onChange: (draft: SupportRequestDraft) => void; onConvert: (id: string) => void; onToggleForm: () => void; onUpdate: (id: string, draft: SupportRequestDraft, status: SupportRequestStatus) => void }) { return <><section className="support-section"><div className="section-heading-row"><SectionHeading>Request a specific essential</SectionHeading><button className="primary-button" type="button" onClick={onToggleForm}>{requestFormOpen ? 'Close' : 'Create request'}</button></div><p className="section-copy">Ask for a specific need, not open-ended cash. Requests are reviewable drafts until payment infrastructure exists.</p>{requestFormOpen ? <RequestForm contacts={contacts} draft={requestForm} onChange={onChange} onSubmit={() => onCreate(requestForm)} /> : null}</section><section className="support-section"><SectionHeading>Your requests</SectionHeading>{requests.length ? <div className="planning-list">{requests.map((request) => <RequestRow key={request.id} request={request} onApprove={() => onUpdate(request.id, requestToDraft(request), 'approved')} onDecline={() => onUpdate(request.id, requestToDraft(request), 'declined')} onCancel={() => onCancel(request.id)} onConvert={() => onConvert(request.id)} />)}</div> : <EmptyState description="Examples: ₦100 airtime, data under ₦500, or ₦2,000 transport." icon="arrow" title="No help requests yet" />}</section></> }

function RequestForm({ contacts, draft, onChange, onSubmit }: { contacts: Contact[]; draft: SupportRequestDraft; onChange: (draft: SupportRequestDraft) => void; onSubmit: () => void }) { return <div className="planning-form"><div className="form-grid"><label><span>Category</span><select value={draft.category} onChange={(event) => onChange({ ...draft, category: event.target.value as SupportRequestDraft['category'] })}>{SUPPORT_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label><label><span>Amount</span><input inputMode="decimal" value={draft.requestedAmount} onChange={(event) => onChange({ ...draft, requestedAmount: event.target.value })} placeholder="100" /></label><label className="form-grid__wide"><span>Specific need</span><input value={draft.requestedProduct} onChange={(event) => onChange({ ...draft, requestedProduct: event.target.value })} placeholder="Please send me ₦100 airtime" /></label><label><span>Contact (optional)</span><select value={draft.contactId} onChange={(event) => { const contact = contacts.find((item) => item.id === event.target.value); onChange({ ...draft, contactId: event.target.value, phone: contact?.phone ?? draft.phone, network: contact?.network ?? draft.network }) }}><option value="">No saved contact</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.displayName}</option>)}</select></label><label><span>Phone</span><input inputMode="tel" value={draft.phone} onChange={(event) => onChange({ ...draft, phone: event.target.value })} placeholder="08012345678" /></label><label><span>Network</span><select value={draft.network} onChange={(event) => onChange({ ...draft, network: event.target.value as SupportRequestDraft['network'] })}><option value="">Not known</option>{SUPPORT_NETWORKS.map((network) => <option key={network}>{network}</option>)}</select></label><label className="form-grid__wide"><span>Message (optional)</span><textarea value={draft.message} onChange={(event) => onChange({ ...draft, message: event.target.value })} placeholder="A little context" /></label></div><button className="primary-button" type="button" onClick={onSubmit}>Save request</button></div> }

function RequestRow({ request, onApprove, onDecline, onCancel, onConvert }: { request: SupportRequest; onApprove: () => void; onDecline: () => void; onCancel: () => void; onConvert: () => void }) { const share = typeof window !== 'undefined' ? `${window.location.origin}/request/${request.publicRequestId}` : ''; return <div className="planning-row"><div><strong>{request.requestedProduct}</strong><small>{request.requestedAmount} NGN · {request.status}{request.expiresAt ? ` · Expires ${formatDate(request.expiresAt)}` : ''}</small></div><div className="planning-row-actions">{request.status === 'pending' ? <><button className="quiet-button" type="button" onClick={onApprove}>Approve</button><button className="quiet-button" type="button" onClick={onDecline}>Decline</button><button className="quiet-button" type="button" onClick={onCancel}>Cancel</button></> : null}{request.status === 'approved' ? <button className="quiet-button" type="button" onClick={onConvert}>Prepare draft</button> : null}{share ? <button className="quiet-button" type="button" onClick={() => void navigator.clipboard?.writeText(share)}>Copy link</button> : null}</div></div> }

function emptySupportDraft(): SupportDraftInput { return { source: 'manual', contactId: '', requestId: '', category: 'Airtime', recipientName: '', recipientPhone: '', recipientNetwork: '', recipientCountry: 'NG', amount: '', unit: 'NGN', productDetails: '' } }
function emptyRequestDraft(): SupportRequestDraft { return { contactId: '', category: 'Airtime', requestedAmount: '', requestedProduct: '', phone: '', network: '', country: 'NG', message: '', expiresAt: '' } }
function emptyRuleDraft(): SupportRuleDraft { return { contactId: '', category: 'Airtime', period: 'monthly', softLimitAmount: '', unit: 'NGN', warningThreshold: 80, enabled: true } }
function supportFormFromContact(contact: Contact): SupportDraftInput { return { source: 'contact', contactId: contact.id, requestId: '', category: contact.usualProductType ?? 'Airtime', recipientName: contact.displayName, recipientPhone: contact.phone, recipientNetwork: contact.network ?? '', recipientCountry: 'NG', amount: contact.usualAmount ?? '', unit: 'NGN', productDetails: '' } }
function draftToInput(draft: SupportDraft): SupportDraftInput { return { source: draft.source, contactId: draft.contactId ?? '', requestId: draft.requestId ?? '', category: draft.category, recipientName: draft.recipientName, recipientPhone: draft.recipientPhone, recipientNetwork: draft.recipientNetwork ?? '', recipientCountry: 'NG', amount: draft.amount, unit: draft.unit, productDetails: draft.productDetails } }
function requestToDraft(request: SupportRequest): SupportRequestDraft { return { contactId: request.contactId ?? '', category: request.category, requestedAmount: request.requestedAmount, requestedProduct: request.requestedProduct, phone: request.phone ?? '', network: request.network ?? '', country: 'NG', message: request.message ?? '', expiresAt: request.expiresAt ?? '' } }
function ruleToDraft(rule: SupportRule): SupportRuleDraft { return { contactId: rule.contactId ?? '', category: rule.category, period: rule.period, softLimitAmount: rule.softLimitAmount, unit: rule.unit, warningThreshold: rule.warningThreshold, enabled: rule.enabled } }
function maskContact(phone: string): string { return phone.length > 4 ? `${phone.slice(0, 3)}•••${phone.slice(-4)}` : '••••' }
function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'date not set' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }
