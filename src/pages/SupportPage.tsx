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
  type SupportNetwork,
} from '../domain/support'
import {
  buildEssentialShareText,
  describeEssentialNeed,
  describeEssentialStatusCopy,
  displayEssentialStatus,
  type EssentialRequest,
  type EssentialRequestDraft,
} from '../domain/essentialRequests'
import type { DataPlan } from '../domain/orders'

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
  essentialRequests,
  onCreateEssentialRequest,
  onCancelEssentialRequest,
  onSyncEssentialRequest,
  onListDataPlans,
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
  essentialRequests: EssentialRequest[]
  onCreateEssentialRequest: (draft: EssentialRequestDraft) => Promise<void>
  onCancelEssentialRequest: (id: string) => Promise<void>
  onSyncEssentialRequest: (id: string) => Promise<void>
  onListDataPlans: (network: SupportNetwork) => Promise<DataPlan[]>
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

          {authenticated && mode === 'request' ? <><EssentialRequestsSection requests={essentialRequests} onCreate={(draft) => void runAction(() => onCreateEssentialRequest(draft))} onCancel={(id) => void runAction(() => onCancelEssentialRequest(id))} onSync={(id) => void runAction(() => onSyncEssentialRequest(id))} onListDataPlans={onListDataPlans} /><RequestHelpSection contacts={contacts} requests={supportRequests} requestForm={requestForm} requestFormOpen={requestFormOpen} onCreate={(draft) => void runAction(() => onCreateSupportRequest(draft), () => { setRequestForm(emptyRequestDraft()); setRequestFormOpen(false) })} onCancel={(id) => void runAction(() => onCancelSupportRequest(id))} onChange={setRequestForm} onConvert={(id) => void runAction(() => onConvertRequest(id))} onToggleForm={() => setRequestFormOpen((open) => !open)} onUpdate={(id, draft, status) => void runAction(() => onUpdateSupportRequest(id, draft, status))} /></> : null}
    </section>
  )
}

function ContactChoice({ contact, onClick }: { contact: Contact; onClick: () => void }) { return <button className="support-contact-choice" type="button" onClick={onClick}><span className="pocket-row-icon"><Icon name="user" size={18} /></span><span><strong>{contact.displayName}</strong><small>{contact.relationship ?? 'Saved contact'} · {maskContact(contact.phone)}{contact.network ? ` · ${contact.network}` : ''}</small></span><Icon name="arrow" size={16} /></button> }

function SupportDraftForm({ contact, draft, onBack, onChange, onSubmit }: { contact: Contact | null; draft: SupportDraftInput; onBack: () => void; onChange: (draft: SupportDraftInput) => void; onSubmit: () => void }) { return <section className="support-section planning-form"><button className="back-link" type="button" onClick={onBack}><Icon name="arrow" size={16} /> Choose someone else</button><SectionHeading>Prepare support for {contact?.displayName ?? draft.recipientName}</SectionHeading><div className="recipient-summary"><strong>{contact?.displayName ?? draft.recipientName}</strong><span>{maskContact(draft.recipientPhone)} · {draft.recipientNetwork || 'Network to confirm'}</span></div><div className="form-grid"><label><span>Category</span><select value={draft.category} onChange={(event) => onChange({ ...draft, category: event.target.value as SupportDraftInput['category'] })}>{SUPPORT_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label><label><span>Unit</span><select value={draft.unit} onChange={(event) => onChange({ ...draft, unit: event.target.value as SupportDraftInput['unit'] })}><option>NGN</option><option>NIM</option></select></label><label><span>Amount</span><input inputMode="decimal" value={draft.amount} onChange={(event) => onChange({ ...draft, amount: event.target.value })} placeholder="100" /></label><label className="form-grid__wide"><span>Product/details</span><input value={draft.productDetails} onChange={(event) => onChange({ ...draft, productDetails: event.target.value })} placeholder="₦100 airtime" /></label></div><p className="truth-note"><Icon name="info" size={18} /><span>Nothing moves until you review and approve a payment. This is only a support draft.</span></p><button className="primary-button" type="button" onClick={onSubmit}>Continue to review</button></section> }

function SupportDraftReview({ contact, draft, onBack, onSubmit }: { contact: Contact | null; draft: SupportDraftInput; onBack: () => void; onSubmit: () => void }) { return <section className="support-section planning-form"><button className="back-link" type="button" onClick={onBack}><Icon name="arrow" size={16} /> Edit draft</button><SectionHeading>Review support draft</SectionHeading><div className="review-list"><div><span>Person</span><strong>{contact?.displayName ?? draft.recipientName} · {maskContact(draft.recipientPhone)}</strong></div><div><span>Need</span><strong>{draft.productDetails}</strong></div><div><span>Planned amount</span><strong>{draft.amount} {draft.unit}</strong></div><div><span>Network</span><strong>{draft.recipientNetwork || 'Confirm later'}</strong></div></div><p className="truth-note"><Icon name="info" size={18} /><span>Nothing moves until you review and approve a payment.</span></p><button className="primary-button" type="button" onClick={onSubmit}>Save support draft</button></section> }

function SupportDraftList({ drafts, onEdit }: { drafts: SupportDraft[]; onEdit: (draft: SupportDraft) => void }) { return <section className="support-section"><div className="section-heading-row"><SectionHeading>Saved support drafts</SectionHeading><span className="section-meta">No payment action</span></div>{drafts.length ? <div className="planning-list">{drafts.map((draft) => <div className="planning-row" key={draft.id}><div><strong>{draft.recipientName}</strong><small>{draft.productDetails} · {draft.amount} {draft.unit} · {draft.status}</small></div><button className="quiet-button" type="button" onClick={() => onEdit(draft)}>Edit</button></div>)}</div> : <p className="section-copy">Support plans you save will stay reviewable here.</p>}</section> }

function SupportRulesSection({ contacts, rules, formOpen, editingRule, onToggleForm, onEdit, onDelete, onSubmit }: { contacts: Contact[]; rules: SupportRule[]; formOpen: boolean; editingRule: SupportRule | null; onToggleForm: () => void; onEdit: (rule: SupportRule) => void; onDelete: (id: string) => void; onSubmit: (draft: SupportRuleDraft) => void }) { return <section className="support-section"><div className="section-heading-row"><SectionHeading>Support boundaries</SectionHeading><button className="quiet-button" type="button" onClick={onToggleForm}>{formOpen ? 'Close' : 'Add boundary'}</button></div><p className="section-copy">Soft warnings for planned support only. They never block a future payment.</p>{formOpen ? <SupportRuleForm key={editingRule?.id ?? 'new'} contacts={contacts} initial={editingRule ? ruleToDraft(editingRule) : undefined} onSubmit={onSubmit} /> : null}{rules.length ? <div className="planning-list">{rules.map((rule) => <div className="planning-row" key={rule.id}><div><strong>{rule.category}</strong><small>{rule.softLimitAmount} {rule.unit} · {rule.period} · {rule.enabled ? `Warn at ${rule.warningThreshold}%` : 'Disabled'}</small></div><div className="planning-row-actions"><button className="quiet-button" type="button" onClick={() => onEdit(rule)}>Edit</button><button className="quiet-button" type="button" onClick={() => onDelete(rule.id)}>Delete</button></div></div>)}</div> : <p className="section-copy">No support boundaries set.</p>}</section> }

function SupportRuleForm({ contacts, initial = emptyRuleDraft(), onSubmit }: { contacts: Contact[]; initial?: SupportRuleDraft; onSubmit: (draft: SupportRuleDraft) => void }) { const [draft, setDraft] = useState(initial); return <div className="planning-form planning-form--compact"><div className="form-grid"><label><span>Person (optional)</span><select value={draft.contactId} onChange={(event) => setDraft({ ...draft, contactId: event.target.value })}><option value="">General support</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.displayName}</option>)}</select></label><label><span>Category</span><select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as SupportRuleDraft['category'] })}>{SUPPORT_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label><label><span>Limit</span><input inputMode="decimal" value={draft.softLimitAmount} onChange={(event) => setDraft({ ...draft, softLimitAmount: event.target.value })} placeholder="5000" /></label><label><span>Unit</span><select value={draft.unit} onChange={(event) => setDraft({ ...draft, unit: event.target.value as SupportRuleDraft['unit'] })}><option>NGN</option><option>NIM</option></select></label><label><span>Period</span><select value={draft.period} onChange={(event) => setDraft({ ...draft, period: event.target.value as SupportRuleDraft['period'] })}><option>monthly</option><option>weekly</option></select></label><label><span>Warn at %</span><input inputMode="numeric" value={draft.warningThreshold} onChange={(event) => setDraft({ ...draft, warningThreshold: Number(event.target.value) })} /></label></div><button className="primary-button" type="button" onClick={() => onSubmit(draft)}>Save boundary</button></div> }

function EssentialRequestsSection({ requests, onCreate, onCancel, onSync, onListDataPlans }: { requests: EssentialRequest[]; onCreate: (draft: EssentialRequestDraft) => void; onCancel: (id: string) => void; onSync: (id: string) => void; onListDataPlans: (network: SupportNetwork) => Promise<DataPlan[]> }) {
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<EssentialRequestDraft>(emptyEssentialDraft())
  const [plans, setPlans] = useState<DataPlan[]>([])
  const [plansLoading, setPlansLoading] = useState(false)
  const [plansError, setPlansError] = useState<string | null>(null)
  const [nowMs] = useState(() => Date.now())
  const groups: Array<{ title: string; rows: EssentialRequest[] }> = [
    { title: 'Open needs', rows: requests.filter((request) => displayEssentialStatus(request, nowMs) === 'OPEN') },
    { title: 'In progress', rows: requests.filter((request) => ['PAYMENT_IN_PROGRESS', 'PAID', 'FULFILLING'].includes(displayEssentialStatus(request, nowMs))) },
    { title: 'Needs attention', rows: requests.filter((request) => displayEssentialStatus(request, nowMs) === 'NEEDS_ATTENTION') },
    { title: 'Completed', rows: requests.filter((request) => displayEssentialStatus(request, nowMs) === 'COMPLETED') },
    { title: 'Closed', rows: requests.filter((request) => ['CANCELLED', 'EXPIRED'].includes(displayEssentialStatus(request, nowMs))) },
  ]
  function chooseNetwork(network: SupportNetwork | '') {
    setForm({ ...form, network, providerPlanId: '' })
    setPlans([])
    setPlansError(null)
    if (form.serviceType === 'DATA' && network) {
      setPlansLoading(true)
      void onListDataPlans(network).then(setPlans).catch((caught: unknown) => {
        setPlansError(caught instanceof Error ? caught.message : 'Data bundles could not be loaded.')
      }).finally(() => setPlansLoading(false))
    }
  }
  function chooseService(serviceType: EssentialRequestDraft['serviceType']) {
    setForm({ ...emptyEssentialDraft(), serviceType, network: form.network, recipientPhone: form.recipientPhone, message: form.message })
    setPlans([])
    setPlansError(null)
    if (serviceType === 'DATA' && form.network) void chooseNetwork(form.network)
  }
  return <><section className="support-section"><div className="section-heading-row"><SectionHeading>Essential needs</SectionHeading><button className="primary-button" type="button" onClick={() => setFormOpen((open) => !open)}>{formOpen ? 'Close' : 'Request a need'}</button></div><p className="section-copy">Ask for airtime or a data bundle someone else can pay directly. You share a link; they pay the need, not cash.</p>{formOpen ? <div className="planning-form"><div className="form-grid"><label><span>Need</span><select value={form.serviceType} onChange={(event) => chooseService(event.target.value as EssentialRequestDraft['serviceType'])}><option value="AIRTIME">Airtime</option><option value="DATA">Data bundle</option></select></label><label><span>Network</span><select value={form.network} onChange={(event) => chooseNetwork(event.target.value as SupportNetwork | '')}><option value="">Choose network</option>{SUPPORT_NETWORKS.map((network) => <option key={network} value={network}>{network}</option>)}</select></label>{form.serviceType === 'AIRTIME' ? <label><span>Amount (NGN)</span><input inputMode="decimal" value={form.requestedAmount} onChange={(event) => setForm({ ...form, requestedAmount: event.target.value })} placeholder="1000" /></label> : <label><span>Bundle</span><select value={form.providerPlanId} onChange={(event) => setForm({ ...form, providerPlanId: event.target.value })}><option value="">{plansLoading ? 'Loading bundles…' : 'Choose bundle'}</option>{plans.map((plan) => <option key={plan.providerPlanId} value={plan.providerPlanId}>{plan.displayName} · ₦{plan.localPriceNgn}</option>)}</select></label>}<label><span>Recipient phone</span><input inputMode="tel" value={form.recipientPhone} onChange={(event) => setForm({ ...form, recipientPhone: event.target.value })} placeholder="08012345678" /></label><label className="form-grid__wide"><span>Note for the payer (optional)</span><textarea value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} placeholder="Need airtime for work" /></label></div>{plansError ? <p className="inline-error" role="alert">{plansError}</p> : null}<button className="primary-button" type="button" onClick={() => { onCreate(form); setForm(emptyEssentialDraft()); setPlans([]); setFormOpen(false) }}>Create shareable request</button></div> : null}</section>{groups.map((group) => group.rows.length ? <section className="support-section" key={group.title}><SectionHeading>{group.title}</SectionHeading><div className="planning-list">{group.rows.map((request) => <EssentialRequestRow key={request.id} request={request} onCancel={() => onCancel(request.id)} onSync={() => onSync(request.id)} />)}</div></section> : null)}</> }

function EssentialRequestRow({ request, onCancel, onSync }: { request: EssentialRequest; onCancel: () => void; onSync: () => void }) {
  const status = displayEssentialStatus(request)
  const copy = describeEssentialStatusCopy(status)
  const link = typeof window !== 'undefined' ? `${window.location.origin}/request/${request.publicRequestId}` : ''
  const [shared, setShared] = useState(false)
  async function share() {
    const text = buildEssentialShareText({ needSummary: describeEssentialNeed(request), linkUrl: link })
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({ title: 'Munus need', text, url: link })
        return
      }
      throw new Error('Web Share unavailable')
    } catch {
      try {
        await navigator.clipboard?.writeText(text)
        setShared(true)
      } catch {
        // Sharing stays best-effort; the link remains copyable below.
      }
    }
  }
  const cancellable = status === 'OPEN' || status === 'PAYMENT_IN_PROGRESS'
  return <div className="planning-row"><div><strong>{describeEssentialNeed(request)}</strong><small>For {maskContact(request.recipientPhone)}{request.network ? ` · ${request.network}` : ''} · {copy.label}{request.message ? ` · “${request.message}”` : ''}</small></div><div className="planning-row-actions">{link ? <button className="quiet-button" type="button" onClick={() => void share()}>{shared ? 'Shared ✓' : 'Share'}</button> : null}{link ? <button className="quiet-button" type="button" onClick={() => void navigator.clipboard?.writeText(link)}>Copy link</button> : null}<button className="quiet-button" type="button" onClick={onSync}>Refresh</button>{cancellable ? <button className="quiet-button" type="button" onClick={onCancel}>Cancel</button> : null}</div></div>
}

function emptyEssentialDraft(): EssentialRequestDraft { return { serviceType: 'AIRTIME', network: '', recipientPhone: '', requestedAmount: '', providerPlanId: '', message: '' } }

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
