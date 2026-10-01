import { useMemo, useState } from 'react'
import { EmptyState, Icon, SectionHeading } from '../components/Primitives'
import type { AppDestination } from '../navigation'
import type { NimiqConnectionState } from '../integration/nimiq'
import {
  calculatePocketProgress,
  formatPlanningAmount,
  getPocketNextAction,
  isDueSoon,
  POCKET_TYPES,
  SPEND_RULE_CATEGORIES,
  type Pocket,
  type PocketAllocationDraft,
  type PocketDraft,
  type PlanningUnit,
  type Reminder,
  type ReminderDraft,
  type ReminderStatus,
  type SpendRule,
  type SpendRuleDraft,
} from '../domain/planning'

export function PocketsPage({
  authenticated,
  pockets,
  reminders,
  spendRules,
  loading,
  error,
  onCreatePocket,
  onUpdatePocket,
  onArchivePocket,
  onAddAllocation,
  onCreateReminder,
  onUpdateReminder,
  onDeleteReminder,
  onCreateSpendRule,
  onUpdateSpendRule,
  onDeleteSpendRule,
}: {
  connection: NimiqConnectionState
  authenticated: boolean
  pockets: Pocket[]
  reminders: Reminder[]
  spendRules: SpendRule[]
  loading: boolean
  error: string | null
  onNavigate: (destination: AppDestination) => void
  onCreatePocket: (draft: PocketDraft) => Promise<void>
  onUpdatePocket: (id: string, draft: PocketDraft) => Promise<void>
  onArchivePocket: (id: string) => Promise<void>
  onAddAllocation: (id: string, draft: PocketAllocationDraft) => Promise<void>
  onCreateReminder: (draft: ReminderDraft) => Promise<void>
  onUpdateReminder: (id: string, draft: ReminderDraft, status: ReminderStatus) => Promise<void>
  onDeleteReminder: (id: string) => Promise<void>
  onCreateSpendRule: (draft: SpendRuleDraft) => Promise<void>
  onUpdateSpendRule: (id: string, draft: SpendRuleDraft) => Promise<void>
  onDeleteSpendRule: (id: string) => Promise<void>
}) {
  const [screen, setScreen] = useState<'list' | 'create' | 'detail' | 'edit'>('list')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [allocationAmount, setAllocationAmount] = useState('')
  const [allocationDirection, setAllocationDirection] = useState<'allocation' | 'reduction'>('allocation')
  const [allocationNote, setAllocationNote] = useState('')
  const [reminderFormOpen, setReminderFormOpen] = useState(false)
  const [editingReminder, setEditingReminder] = useState<Reminder | null>(null)
  const [spendRuleFormOpen, setSpendRuleFormOpen] = useState(false)
  const [editingSpendRule, setEditingSpendRule] = useState<SpendRule | null>(null)

  const selectedPocket = pockets.find((pocket) => pocket.id === selectedId) ?? null
  const dueSoon = useMemo(
    () => reminders.filter((reminder) => reminder.status === 'open' && isDueSoon(reminder.dueAt)),
    [reminders],
  )

  async function runAction(action: () => Promise<void>, after?: () => void) {
    setActionError(null)
    try {
      await action()
      after?.()
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Munus could not save that planning change.')
    }
  }

  function openPocket(pocket: Pocket) {
    setSelectedId(pocket.id)
    setScreen('detail')
    setActionError(null)
    setAllocationAmount('')
  }

  function goList() {
    setScreen('list')
    setSelectedId(null)
    setActionError(null)
  }

  return (
    <section className="screen-content pockets-page" aria-labelledby="pockets-title">
      <p className="eyebrow">Plan ahead</p>
      <h1 id="pockets-title">Life Pockets</h1>
      <p className="screen-lede">Give an upcoming need a place to grow, without moving or locking your NIM.</p>

      {error ? <p className="inline-error" role="alert">{error}</p> : null}
      {actionError ? <p className="inline-error" role="alert">{actionError}</p> : null}

      {screen === 'create' ? (
        <PocketForm
          onCancel={goList}
          onSubmit={(draft) => runAction(() => onCreatePocket(draft), goList)}
        />
      ) : screen === 'edit' && selectedPocket ? (
        <PocketForm
          initial={pocketToDraft(selectedPocket)}
          onCancel={() => setScreen('detail')}
          onSubmit={(draft) => runAction(() => onUpdatePocket(selectedPocket.id, draft), () => setScreen('detail'))}
          submitLabel="Save changes"
        />
      ) : screen === 'detail' && selectedPocket ? (
        <PocketDetail
          pocket={selectedPocket}
          allocationAmount={allocationAmount}
          allocationDirection={allocationDirection}
          allocationNote={allocationNote}
          onBack={goList}
          onEdit={() => setScreen('edit')}
          onArchive={() => runAction(() => onArchivePocket(selectedPocket.id), goList)}
          onAllocationAmountChange={setAllocationAmount}
          onAllocationDirectionChange={setAllocationDirection}
          onAllocationNoteChange={setAllocationNote}
          onAddAllocation={() => runAction(
            () => onAddAllocation(selectedPocket.id, {
              amount: allocationAmount,
              direction: allocationDirection,
              note: allocationNote,
            }),
            () => {
              setAllocationAmount('')
              setAllocationNote('')
            },
          )}
        />
      ) : (
        <>
          <div className="pockets-toolbar">
            <SectionHeading>{pockets.length ? 'Your pockets' : 'Start with one need'}</SectionHeading>
            <button className="primary-button" type="button" disabled={!authenticated} onClick={() => setScreen('create')}>
              <Icon name="pocket" size={17} /> Create pocket
            </button>
          </div>

          {loading ? <p className="loading-copy">Loading your planning context…</p> : null}
          {!loading && pockets.length === 0 ? (
            <EmptyState
              description={authenticated ? 'Plan Data, rent, school, or any recurring need. This pocket does not reserve or move NIM.' : 'Connect your Munus account to save pockets to your profile.'}
              icon="pocket"
              title="Give an upcoming need a place to grow."
            />
          ) : null}
          {!loading && pockets.length > 0 ? (
            <div className="pocket-list" aria-label="Life pockets">
              {pockets.map((pocket) => <PocketRow key={pocket.id} pocket={pocket} onClick={() => openPocket(pocket)} />)}
            </div>
          ) : null}

          <section className="planning-section">
            <div className="section-heading-row">
              <SectionHeading>Due soon</SectionHeading>
              {dueSoon.length ? <span className="section-meta">{dueSoon.length} open</span> : null}
            </div>
            {dueSoon.length ? (
              <div className="planning-list">
                {dueSoon.map((reminder) => <ReminderRow key={reminder.id} reminder={reminder} onDone={() => void runAction(() => onUpdateReminder(reminder.id, reminderToDraft(reminder), 'done'))} onDelete={() => void runAction(() => onDeleteReminder(reminder.id))} onDismiss={() => void runAction(() => onUpdateReminder(reminder.id, reminderToDraft(reminder), 'dismissed'))} onEdit={() => { setEditingReminder(reminder); setReminderFormOpen(true) }} />)}
              </div>
            ) : <p className="section-copy">Nothing is scheduled in the next seven days.</p>}
          </section>

          <section className="planning-section">
            <div className="section-heading-row">
              <SectionHeading>Reminders</SectionHeading>
              <button className="quiet-button" type="button" disabled={!authenticated} onClick={() => { setEditingReminder(null); setReminderFormOpen((open) => !open) }}>{reminderFormOpen ? 'Close' : 'Add reminder'}</button>
            </div>
            {reminderFormOpen ? <ReminderForm key={editingReminder?.id ?? 'new'} initial={editingReminder ? reminderToDraft(editingReminder) : undefined} pockets={pockets} onSubmit={(draft) => runAction(() => editingReminder ? onUpdateReminder(editingReminder.id, draft, editingReminder.status) : onCreateReminder(draft), () => { setReminderFormOpen(false); setEditingReminder(null) })} /> : null}
            {reminders.length ? <div className="planning-list">{reminders.map((reminder) => <ReminderRow key={reminder.id} reminder={reminder} onDone={() => void runAction(() => onUpdateReminder(reminder.id, reminderToDraft(reminder), reminder.status === 'done' ? 'open' : 'done'))} onDelete={() => void runAction(() => onDeleteReminder(reminder.id))} onDismiss={() => void runAction(() => onUpdateReminder(reminder.id, reminderToDraft(reminder), reminder.status === 'dismissed' ? 'open' : 'dismissed'))} onEdit={() => { setEditingReminder(reminder); setReminderFormOpen(true) }} />)}</div> : <p className="section-copy">Create an in-app reminder for a pocket or a standalone need.</p>}
          </section>

          <section className="planning-section">
            <div className="section-heading-row">
              <SectionHeading>Spend Guard</SectionHeading>
              <button className="quiet-button" type="button" disabled={!authenticated} onClick={() => { setEditingSpendRule(null); setSpendRuleFormOpen((open) => !open) }}>{spendRuleFormOpen ? 'Close' : 'Add guard'}</button>
            </div>
            <p className="section-copy">Soft planning limits only. Munus does not block wallet transactions or invent actual spend.</p>
            {spendRuleFormOpen ? <SpendRuleForm key={editingSpendRule?.id ?? 'new'} initial={editingSpendRule ? ruleToDraft(editingSpendRule) : undefined} onSubmit={(draft) => runAction(() => editingSpendRule ? onUpdateSpendRule(editingSpendRule.id, draft) : onCreateSpendRule(draft), () => { setSpendRuleFormOpen(false); setEditingSpendRule(null) })} /> : null}
            {spendRules.length ? <div className="planning-list">{spendRules.map((rule) => <SpendRuleRow key={rule.id} rule={rule} onEdit={() => { setEditingSpendRule(rule); setSpendRuleFormOpen(true) }} onDelete={() => void runAction(() => onDeleteSpendRule(rule.id))} onToggle={() => void runAction(() => onUpdateSpendRule(rule.id, { ...ruleToDraft(rule), enabled: !rule.enabled }))} />)}</div> : <p className="section-copy">No planning guards set yet.</p>}
          </section>
        </>
      )}
    </section>
  )
}

function PocketRow({ pocket, onClick }: { pocket: Pocket; onClick: () => void }) {
  const progress = calculatePocketProgress(pocket.targetAmount, pocket.plannedAmount)
  return (
    <button className="pocket-row" type="button" onClick={onClick}>
      <span className="pocket-row-icon"><Icon name="pocket" size={18} /></span>
      <span className="pocket-row-main"><strong>{pocket.name}</strong><small>{pocket.type} · {pocket.status === 'completed' ? 'Target reached' : 'Active plan'} · {getPocketNextAction(pocket)}</small><span className="progress-track"><span style={{ width: `${progress}%` }} /></span></span>
      <span className="pocket-row-amount"><strong>{formatPlanningAmount(pocket.plannedAmount, pocket.unit)}</strong><small>of {formatPlanningAmount(pocket.targetAmount, pocket.unit)}</small></span>
    </button>
  )
}

function PocketDetail({
  pocket,
  allocationAmount,
  allocationDirection,
  allocationNote,
  onBack,
  onEdit,
  onArchive,
  onAllocationAmountChange,
  onAllocationDirectionChange,
  onAllocationNoteChange,
  onAddAllocation,
}: {
  pocket: Pocket
  allocationAmount: string
  allocationDirection: 'allocation' | 'reduction'
  allocationNote: string
  onBack: () => void
  onEdit: () => void
  onArchive: () => void
  onAllocationAmountChange: (value: string) => void
  onAllocationDirectionChange: (value: 'allocation' | 'reduction') => void
  onAllocationNoteChange: (value: string) => void
  onAddAllocation: () => void
}) {
  const progress = calculatePocketProgress(pocket.targetAmount, pocket.plannedAmount)
  return (
    <section className="pocket-detail">
      <button className="back-link" type="button" onClick={onBack}><Icon name="arrow" size={16} /> All pockets</button>
      <div className="pocket-detail-heading"><span className="pocket-row-icon"><Icon name="pocket" size={22} /></span><div><p className="eyebrow">{pocket.type} · {pocket.status === 'completed' ? 'Target reached' : 'Active plan'}</p><h2>{pocket.name}</h2></div></div>
      <div className="pocket-progress-card"><div className="pocket-progress-value"><strong>{formatPlanningAmount(pocket.plannedAmount, pocket.unit)}</strong><span>{Math.round(progress)}% planned</span></div><span className="progress-track progress-track--large"><span style={{ width: `${progress}%` }} /></span><p>Target {formatPlanningAmount(pocket.targetAmount, pocket.unit)}{pocket.deadline ? ` · Due ${formatDate(pocket.deadline)}` : ''}</p></div>
      <p className="truth-note"><Icon name="info" size={18} /><span>This pocket helps you plan. It does not lock or move your NIM.</span></p>
      {pocket.status === 'completed' ? <p className="status-note">Target reached in your plan. Actual wallet funds remain controlled by Nimiq Pay.</p> : null}
      <section className="planning-section"><SectionHeading>Add allocation</SectionHeading><p className="section-copy">Record an amount you plan to set aside. This is not a transfer.</p><div className="form-grid"><label><span>Amount</span><input inputMode="decimal" value={allocationAmount} onChange={(event) => onAllocationAmountChange(event.target.value)} placeholder="0.00" /></label><label><span>Action</span><select value={allocationDirection} onChange={(event) => onAllocationDirectionChange(event.target.value as 'allocation' | 'reduction')}><option value="allocation">Add planned amount</option><option value="reduction">Reduce planned amount</option></select></label><label className="form-grid__wide"><span>Note (optional)</span><input value={allocationNote} onChange={(event) => onAllocationNoteChange(event.target.value)} placeholder="What is this for?" /></label></div><button className="primary-button" type="button" onClick={onAddAllocation}>Save planning amount</button></section>
      <div className="form-actions"><button className="quiet-button" type="button" onClick={onEdit}>Edit pocket</button><button className="quiet-button" type="button" onClick={onArchive}>Archive pocket</button></div>
    </section>
  )
}

function PocketForm({ initial = emptyPocketDraft(), onCancel, onSubmit, submitLabel = 'Create pocket' }: { initial?: PocketDraft; onCancel: () => void; onSubmit: (draft: PocketDraft) => void; submitLabel?: string }) {
  const [draft, setDraft] = useState(initial)
  return <section className="planning-form"><div className="section-heading-row"><SectionHeading>{submitLabel === 'Create pocket' ? 'Create a pocket' : 'Edit pocket'}</SectionHeading><button className="quiet-button" type="button" onClick={onCancel}>Cancel</button></div><p className="section-copy">A pocket is a plan for an everyday need, not a separate wallet.</p><div className="form-grid"><label className="form-grid__wide"><span>Name</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="e.g. April data" /></label><label><span>Type</span><select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as PocketDraft['type'] })}>{POCKET_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label><label><span>Unit</span><select value={draft.unit} onChange={(event) => setDraft({ ...draft, unit: event.target.value as PlanningUnit })}><option>NIM</option><option>NGN</option></select></label><label><span>Target amount</span><input inputMode="decimal" value={draft.targetAmount} onChange={(event) => setDraft({ ...draft, targetAmount: event.target.value })} placeholder="0.00" /></label><label><span>Deadline (optional)</span><input type="datetime-local" value={toDateTimeLocal(draft.deadline)} onChange={(event) => setDraft({ ...draft, deadline: event.target.value ? new Date(event.target.value).toISOString() : '' })} /></label></div><button className="primary-button" type="button" onClick={() => onSubmit(draft)}>{submitLabel}</button></section>
}

function ReminderForm({ pockets, initial, onSubmit }: { pockets: Pocket[]; initial?: ReminderDraft; onSubmit: (draft: ReminderDraft) => void }) {
  const [draft, setDraft] = useState<ReminderDraft>(initial ?? { linkedObjectType: pockets.length ? 'pocket' : 'standalone', linkedObjectId: pockets[0]?.id ?? '', title: '', dueAt: '', repeatRule: '' })
  return <div className="planning-form planning-form--compact"><div className="form-grid"><label className="form-grid__wide"><span>Title</span><input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Check school plan" /></label><label><span>Link</span><select value={draft.linkedObjectType === 'pocket' ? draft.linkedObjectId : 'standalone'} onChange={(event) => setDraft({ ...draft, linkedObjectType: event.target.value === 'standalone' ? 'standalone' : 'pocket', linkedObjectId: event.target.value === 'standalone' ? '' : event.target.value })}><option value="standalone">Standalone need</option>{pockets.map((pocket) => <option key={pocket.id} value={pocket.id}>{pocket.name}</option>)}</select></label><label><span>Due</span><input type="datetime-local" value={toDateTimeLocal(draft.dueAt)} onChange={(event) => setDraft({ ...draft, dueAt: event.target.value ? new Date(event.target.value).toISOString() : '' })} /></label><label><span>Repeat</span><select value={draft.repeatRule} onChange={(event) => setDraft({ ...draft, repeatRule: event.target.value })}><option value="">One time</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label></div><button className="primary-button" type="button" onClick={() => onSubmit(draft)}>Save reminder</button></div>
}

function ReminderRow({ reminder, onEdit, onDone, onDismiss, onDelete }: { reminder: Reminder; onEdit: () => void; onDone: () => void; onDismiss: () => void; onDelete: () => void }) {
  return <div className={`planning-row planning-row--${reminder.status}`}><div><strong>{reminder.title}</strong><small>{formatDate(reminder.dueAt)}{reminder.repeatRule ? ` · ${reminder.repeatRule}` : ''}</small></div><div className="planning-row-actions"><button className="quiet-button" type="button" onClick={onEdit}>Edit</button><button className="quiet-button" type="button" onClick={onDone}>{reminder.status === 'done' ? 'Reopen' : 'Done'}</button><button className="quiet-button" type="button" onClick={onDismiss}>{reminder.status === 'dismissed' ? 'Restore' : 'Dismiss'}</button><button className="quiet-button" type="button" onClick={onDelete}>Delete</button></div></div>
}

function SpendRuleForm({ initial, onSubmit }: { initial?: SpendRuleDraft; onSubmit: (draft: SpendRuleDraft) => void }) {
  const [draft, setDraft] = useState<SpendRuleDraft>(initial ?? { category: 'General essentials', limitAmount: '', unit: 'NGN', period: 'monthly', warningThreshold: 80, enabled: true })
  return <div className="planning-form planning-form--compact"><div className="form-grid"><label><span>Category</span><select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as SpendRuleDraft['category'] })}>{SPEND_RULE_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label><label><span>Limit</span><input inputMode="decimal" value={draft.limitAmount} onChange={(event) => setDraft({ ...draft, limitAmount: event.target.value })} placeholder="0.00" /></label><label><span>Unit</span><select value={draft.unit} onChange={(event) => setDraft({ ...draft, unit: event.target.value as PlanningUnit })}><option>NGN</option><option>NIM</option></select></label><label><span>Period</span><select value={draft.period} onChange={(event) => setDraft({ ...draft, period: event.target.value as SpendRuleDraft['period'] })}><option value="monthly">Monthly</option><option value="weekly">Weekly</option></select></label><label><span>Warn at %</span><input inputMode="numeric" value={draft.warningThreshold} onChange={(event) => setDraft({ ...draft, warningThreshold: Number(event.target.value) })} /></label></div><button className="primary-button" type="button" onClick={() => onSubmit(draft)}>Save guard</button></div>
}

function SpendRuleRow({ rule, onEdit, onToggle, onDelete }: { rule: SpendRule; onEdit: () => void; onToggle: () => void; onDelete: () => void }) {
  return <div className="planning-row"><div><strong>{rule.category}</strong><small>{formatPlanningAmount(rule.limitAmount, rule.unit)} · {rule.period} · {rule.enabled ? `Warn at ${rule.warningThreshold}% · planned only` : 'Disabled'}</small></div><div className="planning-row-actions"><button className="quiet-button" type="button" onClick={onEdit}>Edit</button><button className="quiet-button" type="button" onClick={onToggle}>{rule.enabled ? 'Disable' : 'Enable'}</button><button className="quiet-button" type="button" onClick={onDelete}>Delete</button></div></div>
}

function emptyPocketDraft(): PocketDraft { return { name: '', type: 'Custom', unit: 'NGN', targetAmount: '', deadline: '' } }
function pocketToDraft(pocket: Pocket): PocketDraft { return { name: pocket.name, type: pocket.type, unit: pocket.unit, targetAmount: pocket.targetAmount, deadline: pocket.deadline ?? '' } }
function reminderToDraft(reminder: Reminder): ReminderDraft { return { linkedObjectType: reminder.linkedObjectType, linkedObjectId: reminder.linkedObjectId ?? '', title: reminder.title, dueAt: reminder.dueAt, repeatRule: reminder.repeatRule ?? '' } }
function ruleToDraft(rule: SpendRule): SpendRuleDraft { return { category: rule.category, limitAmount: rule.limitAmount, unit: rule.unit, period: rule.period, warningThreshold: rule.warningThreshold, enabled: rule.enabled } }
function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Date not set' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) }
function toDateTimeLocal(value: string): string { if (!value) return ''; const date = new Date(value); if (Number.isNaN(date.getTime())) return ''; const offset = date.getTimezoneOffset() * 60_000; return new Date(date.getTime() - offset).toISOString().slice(0, 16) }
