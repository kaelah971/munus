import { randomUUID } from 'node:crypto'
import type {
  Pocket,
  PocketAllocationDraft,
  PocketDraft,
  PocketEntry,
  Reminder,
  ReminderDraft,
  ReminderStatus,
  SpendRule,
  SpendRuleDraft,
} from '../src/domain/planning'
import {
  addMoney,
  advanceReminderDueAt,
  calculatePocketStatus,
  subtractMoney,
} from '../src/domain/planning'
import type { SupabaseClient } from '@supabase/supabase-js'

export class PlanningRepositoryError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message)
    this.name = 'PlanningRepositoryError'
  }
}

export interface PlanningRepository {
  listPockets(userId: string, includeArchived?: boolean): Promise<Pocket[]>
  getPocket(userId: string, pocketId: string): Promise<Pocket | null>
  createPocket(userId: string, draft: PocketDraft): Promise<Pocket>
  updatePocket(userId: string, pocketId: string, draft: PocketDraft): Promise<Pocket>
  archivePocket(userId: string, pocketId: string): Promise<Pocket | null>
  addPocketAllocation(
    userId: string,
    pocketId: string,
    draft: PocketAllocationDraft,
  ): Promise<{ pocket: Pocket; entry: PocketEntry }>
  listReminders(userId: string): Promise<Reminder[]>
  getReminder(userId: string, reminderId: string): Promise<Reminder | null>
  createReminder(userId: string, draft: ReminderDraft): Promise<Reminder>
  updateReminder(
    userId: string,
    reminderId: string,
    draft: ReminderDraft,
    status: ReminderStatus,
  ): Promise<Reminder | null>
  deleteReminder(userId: string, reminderId: string): Promise<boolean>
  listSpendRules(userId: string): Promise<SpendRule[]>
  getSpendRule(userId: string, ruleId: string): Promise<SpendRule | null>
  createSpendRule(userId: string, draft: SpendRuleDraft): Promise<SpendRule>
  updateSpendRule(userId: string, ruleId: string, draft: SpendRuleDraft): Promise<SpendRule | null>
  deleteSpendRule(userId: string, ruleId: string): Promise<boolean>
}

export class InMemoryPlanningRepository implements PlanningRepository {
  readonly pockets = new Map<string, Pocket>()
  readonly pocketEntries = new Map<string, PocketEntry>()
  readonly reminders = new Map<string, Reminder>()
  readonly spendRules = new Map<string, SpendRule>()

  async listPockets(userId: string, includeArchived = false): Promise<Pocket[]> {
    return [...this.pockets.values()].filter(
      (pocket) => pocket.userId === userId && (includeArchived || pocket.status !== 'archived'),
    )
  }

  async getPocket(userId: string, pocketId: string): Promise<Pocket | null> {
    const pocket = this.pockets.get(pocketId)
    return pocket?.userId === userId ? pocket : null
  }

  async createPocket(userId: string, draft: PocketDraft): Promise<Pocket> {
    const now = new Date().toISOString()
    const pocket: Pocket = {
      id: randomUUID(),
      userId,
      name: draft.name,
      type: draft.type,
      unit: draft.unit,
      targetAmount: draft.targetAmount,
      plannedAmount: '0',
      deadline: draft.deadline || undefined,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }
    this.pockets.set(pocket.id, pocket)
    return pocket
  }

  async updatePocket(userId: string, pocketId: string, draft: PocketDraft): Promise<Pocket> {
    const pocket = await this.requirePocket(userId, pocketId)
    const updated: Pocket = {
      ...pocket,
      name: draft.name,
      type: draft.type,
      unit: draft.unit,
      targetAmount: draft.targetAmount,
      deadline: draft.deadline || undefined,
      status: calculatePocketStatus({ ...pocket, targetAmount: draft.targetAmount }),
      updatedAt: new Date().toISOString(),
    }
    this.pockets.set(pocket.id, updated)
    return updated
  }

  async archivePocket(userId: string, pocketId: string): Promise<Pocket | null> {
    const pocket = await this.getPocket(userId, pocketId)
    if (!pocket) return null
    const archived: Pocket = {
      ...pocket,
      status: 'archived',
      archivedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    this.pockets.set(pocket.id, archived)
    return archived
  }

  async addPocketAllocation(
    userId: string,
    pocketId: string,
    draft: PocketAllocationDraft,
  ): Promise<{ pocket: Pocket; entry: PocketEntry }> {
    const pocket = await this.requirePocket(userId, pocketId)
    if (pocket.status === 'archived') throw new PlanningRepositoryError('Archived pockets cannot receive allocations.', 409)
    let plannedAmount: string
    try {
      plannedAmount = draft.direction === 'allocation'
        ? addMoney(pocket.plannedAmount, draft.amount)
        : subtractMoney(pocket.plannedAmount, draft.amount)
    } catch (error) {
      throw new PlanningRepositoryError(error instanceof Error ? error.message : 'Allocation is invalid.')
    }
    const now = new Date().toISOString()
    const updated: Pocket = {
      ...pocket,
      plannedAmount,
      status: calculatePocketStatus({ ...pocket, plannedAmount }),
      updatedAt: now,
    }
    const entry: PocketEntry = {
      id: randomUUID(),
      pocketId,
      userId,
      amount: draft.amount,
      direction: draft.direction,
      note: draft.note || undefined,
      createdAt: now,
    }
    this.pockets.set(pocketId, updated)
    this.pocketEntries.set(entry.id, entry)
    return { pocket: updated, entry }
  }

  async listReminders(userId: string): Promise<Reminder[]> {
    return [...this.reminders.values()].filter((reminder) => reminder.userId === userId)
  }

  async getReminder(userId: string, reminderId: string): Promise<Reminder | null> {
    const reminder = this.reminders.get(reminderId)
    return reminder?.userId === userId ? reminder : null
  }

  async createReminder(userId: string, draft: ReminderDraft): Promise<Reminder> {
    await this.assertLinkedPocket(userId, draft)
    const now = new Date().toISOString()
    const reminder: Reminder = {
      id: randomUUID(),
      userId,
      linkedObjectType: draft.linkedObjectType,
      linkedObjectId: draft.linkedObjectId || undefined,
      title: draft.title,
      dueAt: draft.dueAt,
      repeatRule: draft.repeatRule || undefined,
      status: 'open',
      createdAt: now,
      updatedAt: now,
    }
    this.reminders.set(reminder.id, reminder)
    return reminder
  }

  async updateReminder(
    userId: string,
    reminderId: string,
    draft: ReminderDraft,
    status: ReminderStatus,
  ): Promise<Reminder | null> {
    const reminder = await this.getReminder(userId, reminderId)
    if (!reminder) return null
    await this.assertLinkedPocket(userId, draft)
    const repeats = status === 'done' && Boolean(draft.repeatRule)
    const updated: Reminder = {
      ...reminder,
      ...draft,
      linkedObjectId: draft.linkedObjectId || undefined,
      dueAt: repeats ? advanceReminderDueAt(draft.dueAt, draft.repeatRule) : draft.dueAt,
      repeatRule: draft.repeatRule || undefined,
      status: repeats ? 'open' : status,
      updatedAt: new Date().toISOString(),
    }
    this.reminders.set(reminderId, updated)
    return updated
  }

  async deleteReminder(userId: string, reminderId: string): Promise<boolean> {
    const reminder = await this.getReminder(userId, reminderId)
    if (!reminder) return false
    this.reminders.delete(reminderId)
    return true
  }

  async listSpendRules(userId: string): Promise<SpendRule[]> {
    return [...this.spendRules.values()].filter((rule) => rule.userId === userId)
  }

  async getSpendRule(userId: string, ruleId: string): Promise<SpendRule | null> {
    const rule = this.spendRules.get(ruleId)
    return rule?.userId === userId ? rule : null
  }

  async createSpendRule(userId: string, draft: SpendRuleDraft): Promise<SpendRule> {
    const now = new Date().toISOString()
    const rule: SpendRule = { id: randomUUID(), userId, ...draft, createdAt: now, updatedAt: now }
    this.spendRules.set(rule.id, rule)
    return rule
  }

  async updateSpendRule(userId: string, ruleId: string, draft: SpendRuleDraft): Promise<SpendRule | null> {
    const rule = await this.getSpendRule(userId, ruleId)
    if (!rule) return null
    const updated = { ...rule, ...draft, updatedAt: new Date().toISOString() }
    this.spendRules.set(ruleId, updated)
    return updated
  }

  async deleteSpendRule(userId: string, ruleId: string): Promise<boolean> {
    const rule = await this.getSpendRule(userId, ruleId)
    if (!rule) return false
    this.spendRules.delete(ruleId)
    return true
  }

  private async requirePocket(userId: string, pocketId: string): Promise<Pocket> {
    const pocket = await this.getPocket(userId, pocketId)
    if (!pocket) throw new PlanningRepositoryError('Pocket was not found.', 404)
    return pocket
  }

  private async assertLinkedPocket(userId: string, draft: ReminderDraft): Promise<void> {
    if (draft.linkedObjectType === 'pocket' && !(await this.getPocket(userId, draft.linkedObjectId))) {
      throw new PlanningRepositoryError('Reminder pocket was not found.', 404)
    }
  }
}

export class SupabasePlanningRepository implements PlanningRepository {
  constructor(private readonly client: SupabaseClient) {}

  async listPockets(userId: string, includeArchived = false): Promise<Pocket[]> {
    let query = this.client
      .from('pockets')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
    if (!includeArchived) query = query.neq('status', 'archived')
    const { data, error } = await query
    if (error) throw new Error(`Could not list pockets: ${error.message}`)
    return (data ?? []).map((row: Record<string, unknown>) => mapPocket(row))
  }

  async getPocket(userId: string, pocketId: string): Promise<Pocket | null> {
    const { data, error } = await this.client
      .from('pockets')
      .select('*')
      .eq('id', pocketId)
      .eq('user_id', userId)
      .maybeSingle()
    if (error) throw new Error(`Could not load pocket: ${error.message}`)
    return data ? mapPocket(data) : null
  }

  async createPocket(userId: string, draft: PocketDraft): Promise<Pocket> {
    const { data, error } = await this.client
      .from('pockets')
      .insert({
        user_id: userId,
        name: draft.name,
        type: draft.type,
        unit: draft.unit,
        target_amount: draft.targetAmount,
        planned_amount: '0',
        deadline: draft.deadline || null,
        status: 'active',
      })
      .select('*')
      .single()
    if (error) throw new Error(`Could not create pocket: ${error.message}`)
    return mapPocket(data)
  }

  async updatePocket(userId: string, pocketId: string, draft: PocketDraft): Promise<Pocket> {
    const current = await this.requirePocket(userId, pocketId)
    const nextStatus = calculatePocketStatus({ ...current, targetAmount: draft.targetAmount })
    const { data, error } = await this.client
      .from('pockets')
      .update({
        name: draft.name,
        type: draft.type,
        unit: draft.unit,
        target_amount: draft.targetAmount,
        deadline: draft.deadline || null,
        status: nextStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', pocketId)
      .eq('user_id', userId)
      .select('*')
      .single()
    if (error) throw new Error(`Could not update pocket: ${error.message}`)
    return mapPocket(data)
  }

  async archivePocket(userId: string, pocketId: string): Promise<Pocket | null> {
    const { data, error } = await this.client
      .from('pockets')
      .update({ status: 'archived', archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', pocketId)
      .eq('user_id', userId)
      .select('*')
      .maybeSingle()
    if (error) throw new Error(`Could not archive pocket: ${error.message}`)
    return data ? mapPocket(data) : null
  }

  async addPocketAllocation(
    userId: string,
    pocketId: string,
    draft: PocketAllocationDraft,
  ): Promise<{ pocket: Pocket; entry: PocketEntry }> {
    const { data, error } = await this.client.rpc('add_pocket_entry', {
      p_pocket_id: pocketId,
      p_user_id: userId,
      p_amount: draft.amount,
      p_direction: draft.direction,
      p_note: draft.note || null,
    })
    if (error) throw new Error(`Could not add pocket allocation: ${error.message}`)
    const pocket = await this.requirePocket(userId, pocketId)
    const row = Array.isArray(data) ? data[0] : data
    return {
      pocket,
      entry: {
        id: String(row?.entry_id ?? randomUUID()),
        pocketId,
        userId,
        amount: draft.amount,
        direction: draft.direction,
        note: draft.note || undefined,
        createdAt: String(row?.entry_created_at ?? new Date().toISOString()),
      },
    }
  }

  async listReminders(userId: string): Promise<Reminder[]> {
    const { data, error } = await this.client
      .from('reminders')
      .select('*')
      .eq('user_id', userId)
      .order('due_at', { ascending: true })
    if (error) throw new Error(`Could not list reminders: ${error.message}`)
    return (data ?? []).map((row: Record<string, unknown>) => mapReminder(row))
  }

  async getReminder(userId: string, reminderId: string): Promise<Reminder | null> {
    const { data, error } = await this.client
      .from('reminders')
      .select('*')
      .eq('id', reminderId)
      .eq('user_id', userId)
      .maybeSingle()
    if (error) throw new Error(`Could not load reminder: ${error.message}`)
    return data ? mapReminder(data) : null
  }

  async createReminder(userId: string, draft: ReminderDraft): Promise<Reminder> {
    await this.assertLinkedPocket(userId, draft)
    const { data, error } = await this.client
      .from('reminders')
      .insert({
        user_id: userId,
        linked_object_type: draft.linkedObjectType,
        linked_object_id: draft.linkedObjectId || null,
        title: draft.title,
        due_at: draft.dueAt,
        repeat_rule: draft.repeatRule || null,
        status: 'open',
      })
      .select('*')
      .single()
    if (error) throw new Error(`Could not create reminder: ${error.message}`)
    return mapReminder(data)
  }

  async updateReminder(
    userId: string,
    reminderId: string,
    draft: ReminderDraft,
    status: ReminderStatus,
  ): Promise<Reminder | null> {
    await this.assertLinkedPocket(userId, draft)
    const { data, error } = await this.client
      .from('reminders')
      .update({
        linked_object_type: draft.linkedObjectType,
        linked_object_id: draft.linkedObjectId || null,
        title: draft.title,
        due_at: status === 'done' && draft.repeatRule ? advanceReminderDueAt(draft.dueAt, draft.repeatRule) : draft.dueAt,
        repeat_rule: draft.repeatRule || null,
        status: status === 'done' && draft.repeatRule ? 'open' : status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', reminderId)
      .eq('user_id', userId)
      .select('*')
      .maybeSingle()
    if (error) throw new Error(`Could not update reminder: ${error.message}`)
    return data ? mapReminder(data) : null
  }

  async deleteReminder(userId: string, reminderId: string): Promise<boolean> {
    const { data, error } = await this.client
      .from('reminders')
      .delete()
      .eq('id', reminderId)
      .eq('user_id', userId)
      .select('id')
    if (error) throw new Error(`Could not delete reminder: ${error.message}`)
    return Array.isArray(data) && data.length > 0
  }

  async listSpendRules(userId: string): Promise<SpendRule[]> {
    const { data, error } = await this.client
      .from('spend_rules')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
    if (error) throw new Error(`Could not list spend rules: ${error.message}`)
    return (data ?? []).map((row: Record<string, unknown>) => mapSpendRule(row))
  }

  async getSpendRule(userId: string, ruleId: string): Promise<SpendRule | null> {
    const { data, error } = await this.client
      .from('spend_rules')
      .select('*')
      .eq('id', ruleId)
      .eq('user_id', userId)
      .maybeSingle()
    if (error) throw new Error(`Could not load spend rule: ${error.message}`)
    return data ? mapSpendRule(data) : null
  }

  async createSpendRule(userId: string, draft: SpendRuleDraft): Promise<SpendRule> {
    const { data, error } = await this.client
      .from('spend_rules')
      .insert({ user_id: userId, category: draft.category, unit: draft.unit, limit_amount: draft.limitAmount, period: draft.period, warning_threshold: draft.warningThreshold, enabled: draft.enabled })
      .select('*')
      .single()
    if (error) throw new Error(`Could not create spend rule: ${error.message}`)
    return mapSpendRule(data)
  }

  async updateSpendRule(userId: string, ruleId: string, draft: SpendRuleDraft): Promise<SpendRule | null> {
    const { data, error } = await this.client
      .from('spend_rules')
      .update({ category: draft.category, unit: draft.unit, limit_amount: draft.limitAmount, period: draft.period, warning_threshold: draft.warningThreshold, enabled: draft.enabled, updated_at: new Date().toISOString() })
      .eq('id', ruleId)
      .eq('user_id', userId)
      .select('*')
      .maybeSingle()
    if (error) throw new Error(`Could not update spend rule: ${error.message}`)
    return data ? mapSpendRule(data) : null
  }

  async deleteSpendRule(userId: string, ruleId: string): Promise<boolean> {
    const { data, error } = await this.client
      .from('spend_rules')
      .delete()
      .eq('id', ruleId)
      .eq('user_id', userId)
      .select('id')
    if (error) throw new Error(`Could not delete spend rule: ${error.message}`)
    return Array.isArray(data) && data.length > 0
  }

  private async requirePocket(userId: string, pocketId: string): Promise<Pocket> {
    const pocket = await this.getPocket(userId, pocketId)
    if (!pocket) throw new PlanningRepositoryError('Pocket was not found.', 404)
    return pocket
  }

  private async assertLinkedPocket(userId: string, draft: ReminderDraft): Promise<void> {
    if (draft.linkedObjectType === 'pocket' && !(await this.getPocket(userId, draft.linkedObjectId))) {
      throw new PlanningRepositoryError('Reminder pocket was not found.', 404)
    }
  }
}

function mapPocket(row: Record<string, unknown>): Pocket {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    name: String(row.name),
    type: row.type as Pocket['type'],
    unit: row.unit as Pocket['unit'],
    targetAmount: String(row.target_amount),
    plannedAmount: String(row.planned_amount),
    deadline: row.deadline ? String(row.deadline) : undefined,
    status: row.status as Pocket['status'],
    archivedAt: row.archived_at ? String(row.archived_at) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function mapReminder(row: Record<string, unknown>): Reminder {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    linkedObjectType: row.linked_object_type as Reminder['linkedObjectType'],
    linkedObjectId: row.linked_object_id ? String(row.linked_object_id) : undefined,
    title: String(row.title),
    dueAt: String(row.due_at),
    repeatRule: row.repeat_rule ? String(row.repeat_rule) : undefined,
    status: row.status as Reminder['status'],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function mapSpendRule(row: Record<string, unknown>): SpendRule {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    category: row.category as SpendRule['category'],
    limitAmount: String(row.limit_amount),
    unit: row.unit as SpendRule['unit'],
    period: row.period as SpendRule['period'],
    warningThreshold: Number(row.warning_threshold),
    enabled: Boolean(row.enabled),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}
