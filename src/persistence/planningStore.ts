import {
  addMoney,
  advanceReminderDueAt,
  compareMoney,
  calculatePocketStatus,
  normalizeMoney,
  subtractMoney,
  type Pocket,
  type PocketAllocationDraft,
  type PocketDraft,
  type PlanningData,
  type Reminder,
  type ReminderDraft,
  type ReminderStatus,
  type SpendRule,
  type SpendRuleDraft,
} from '../domain/planning'
import type { PlanningApi } from './planningApi'

const PLANNING_KEY_PREFIX = 'munus:planning:'

export class LocalPlanningApi implements PlanningApi {
  constructor(
    private readonly userId: string,
    private readonly storage: Storage | null = getStorage(),
  ) {}

  async load(): Promise<PlanningData> {
    return this.readData()
  }

  async createPocket(draft: PocketDraft): Promise<Pocket> {
    const data = this.readData()
    const now = new Date().toISOString()
    const pocket: Pocket = {
      id: createId(),
      userId: this.userId,
      ...draft,
      targetAmount: normalizeMoney(draft.targetAmount, false),
      plannedAmount: '0',
      deadline: draft.deadline || undefined,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }
    data.pockets.unshift(pocket)
    this.writeData(data)
    return pocket
  }

  async updatePocket(id: string, draft: PocketDraft): Promise<Pocket> {
    const data = this.readData()
    const index = data.pockets.findIndex((pocket) => pocket.id === id)
    if (index < 0) throw new Error('Pocket was not found.')
    const current = data.pockets[index]
    if (draft.unit !== current.unit && compareMoney(current.plannedAmount, '0') !== 0) {
      throw new Error('A pocket with planned amount cannot change unit.')
    }
    const updated: Pocket = {
      ...current,
      ...draft,
      targetAmount: normalizeMoney(draft.targetAmount, false),
      deadline: draft.deadline || undefined,
      status: calculatePocketStatus({ ...current, targetAmount: draft.targetAmount }),
      updatedAt: new Date().toISOString(),
    }
    data.pockets[index] = updated
    this.writeData(data)
    return updated
  }

  async archivePocket(id: string): Promise<Pocket> {
    const data = this.readData()
    const index = data.pockets.findIndex((pocket) => pocket.id === id)
    if (index < 0) throw new Error('Pocket was not found.')
    const archived = {
      ...data.pockets[index],
      status: 'archived' as const,
      archivedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    data.pockets[index] = archived
    this.writeData(data)
    return archived
  }

  async addPocketAllocation(id: string, draft: PocketAllocationDraft): Promise<{ pocket: Pocket }> {
    const data = this.readData()
    const index = data.pockets.findIndex((pocket) => pocket.id === id)
    if (index < 0) throw new Error('Pocket was not found.')
    const current = data.pockets[index]
    if (current.status === 'archived') throw new Error('Archived pockets cannot receive allocations.')
    const plannedAmount = draft.direction === 'allocation'
      ? addMoney(current.plannedAmount, draft.amount)
      : subtractMoney(current.plannedAmount, draft.amount)
    const updated = {
      ...current,
      plannedAmount,
      status: calculatePocketStatus({ ...current, plannedAmount }),
      updatedAt: new Date().toISOString(),
    }
    data.pockets[index] = updated
    this.writeData(data)
    return { pocket: updated }
  }

  async createReminder(draft: ReminderDraft): Promise<Reminder> {
    if (draft.linkedObjectType === 'pocket' && !this.readData().pockets.some((pocket) => pocket.id === draft.linkedObjectId)) {
      throw new Error('Reminder pocket was not found.')
    }
    const data = this.readData()
    const now = new Date().toISOString()
    const reminder: Reminder = {
      id: createId(),
      userId: this.userId,
      ...draft,
      linkedObjectId: draft.linkedObjectId || undefined,
      repeatRule: draft.repeatRule || undefined,
      status: 'open',
      createdAt: now,
      updatedAt: now,
    }
    data.reminders.push(reminder)
    this.writeData(data)
    return reminder
  }

  async updateReminder(id: string, draft: ReminderDraft, status: ReminderStatus): Promise<Reminder> {
    const data = this.readData()
    const index = data.reminders.findIndex((reminder) => reminder.id === id)
    if (index < 0) throw new Error('Reminder was not found.')
    const repeats = status === 'done' && Boolean(draft.repeatRule)
    const updated = {
      ...data.reminders[index],
      ...draft,
      linkedObjectId: draft.linkedObjectId || undefined,
      dueAt: repeats ? advanceReminderDueAt(draft.dueAt, draft.repeatRule) : draft.dueAt,
      repeatRule: draft.repeatRule || undefined,
      status: repeats ? 'open' as const : status,
      updatedAt: new Date().toISOString(),
    }
    data.reminders[index] = updated
    this.writeData(data)
    return updated
  }

  async deleteReminder(id: string): Promise<void> {
    const data = this.readData()
    data.reminders = data.reminders.filter((reminder) => reminder.id !== id)
    this.writeData(data)
  }

  async createSpendRule(draft: SpendRuleDraft): Promise<SpendRule> {
    const data = this.readData()
    const now = new Date().toISOString()
    const rule: SpendRule = { id: createId(), userId: this.userId, ...draft, createdAt: now, updatedAt: now }
    data.spendRules.unshift(rule)
    this.writeData(data)
    return rule
  }

  async updateSpendRule(id: string, draft: SpendRuleDraft): Promise<SpendRule> {
    const data = this.readData()
    const index = data.spendRules.findIndex((rule) => rule.id === id)
    if (index < 0) throw new Error('Spend rule was not found.')
    const updated = { ...data.spendRules[index], ...draft, updatedAt: new Date().toISOString() }
    data.spendRules[index] = updated
    this.writeData(data)
    return updated
  }

  async deleteSpendRule(id: string): Promise<void> {
    const data = this.readData()
    data.spendRules = data.spendRules.filter((rule) => rule.id !== id)
    this.writeData(data)
  }

  private readData(): PlanningData {
    const raw = this.storage?.getItem(`${PLANNING_KEY_PREFIX}${this.userId}`)
    if (!raw) return emptyPlanningData()
    try {
      const parsed = JSON.parse(raw) as Partial<PlanningData>
      return {
        pockets: Array.isArray(parsed.pockets) ? parsed.pockets : [],
        reminders: Array.isArray(parsed.reminders) ? parsed.reminders : [],
        spendRules: Array.isArray(parsed.spendRules) ? parsed.spendRules : [],
      }
    } catch {
      return emptyPlanningData()
    }
  }

  private writeData(data: PlanningData): void {
    this.storage?.setItem(`${PLANNING_KEY_PREFIX}${this.userId}`, JSON.stringify(data))
  }
}

function emptyPlanningData(): PlanningData {
  return { pockets: [], reminders: [], spendRules: [] }
}

function createId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}
