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
import { withTransaction, type DatabasePool } from './database'

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

export class PostgresPlanningRepository implements PlanningRepository {
  constructor(private readonly database: DatabasePool) {}

  async listPockets(userId: string, includeArchived = false): Promise<Pocket[]> {
    const result = await this.run('list pockets', () => this.database.query(
      `SELECT * FROM pockets
       WHERE user_id = $1${includeArchived ? '' : " AND status <> 'archived'"}
       ORDER BY created_at DESC`,
      [userId],
    ))
    return result.rows.map((row) => mapPocket(row))
  }

  async getPocket(userId: string, pocketId: string): Promise<Pocket | null> {
    const result = await this.run('load pocket', () => this.database.query(
      `SELECT * FROM pockets WHERE id = $1 AND user_id = $2`,
      [pocketId, userId],
    ))
    return result.rows[0] ? mapPocket(result.rows[0]) : null
  }

  async createPocket(userId: string, draft: PocketDraft): Promise<Pocket> {
    const result = await this.run('create pocket', () => this.database.query(
      `INSERT INTO pockets
        (user_id, name, type, unit, target_amount, planned_amount, deadline, status)
       VALUES ($1, $2, $3, $4, $5, 0, $6, 'active')
       RETURNING *`,
      [userId, draft.name, draft.type, draft.unit, draft.targetAmount, draft.deadline || null],
    ))
    return mapPocket(requireRow(result.rows[0], 'Pocket'))
  }

  async updatePocket(userId: string, pocketId: string, draft: PocketDraft): Promise<Pocket> {
    const current = await this.requirePocket(userId, pocketId)
    const nextStatus = calculatePocketStatus({ ...current, targetAmount: draft.targetAmount })
    const result = await this.run('update pocket', () => this.database.query(
      `UPDATE pockets
       SET name = $3, type = $4, unit = $5, target_amount = $6,
           deadline = $7, status = $8, updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [pocketId, userId, draft.name, draft.type, draft.unit, draft.targetAmount, draft.deadline || null, nextStatus],
    ))
    return mapPocket(requireRow(result.rows[0], 'Pocket'))
  }

  async archivePocket(userId: string, pocketId: string): Promise<Pocket | null> {
    const result = await this.run('archive pocket', () => this.database.query(
      `UPDATE pockets
       SET status = 'archived', archived_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [pocketId, userId],
    ))
    return result.rows[0] ? mapPocket(result.rows[0]) : null
  }

  async addPocketAllocation(
    userId: string,
    pocketId: string,
    draft: PocketAllocationDraft,
  ): Promise<{ pocket: Pocket; entry: PocketEntry }> {
    return this.run('add pocket allocation', () => withTransaction(this.database, async (client) => {
      const locked = await client.query(
        `SELECT * FROM pockets WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [pocketId, userId],
      )
      const current = locked.rows[0]
      if (!current) throw new PlanningRepositoryError('Pocket was not found.', 404)
      const pocket = mapPocket(current)
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
      const nextStatus = calculatePocketStatus({ ...pocket, plannedAmount })
      const entryResult = await client.query(
        `INSERT INTO pocket_entries (pocket_id, user_id, amount, direction, note)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, created_at`,
        [pocketId, userId, draft.amount, draft.direction, draft.note || null],
      )
      const updatedResult = await client.query(
        `UPDATE pockets
         SET planned_amount = $3, status = $4, updated_at = $5
         WHERE id = $1 AND user_id = $2
         RETURNING *`,
        [pocketId, userId, plannedAmount, nextStatus, now],
      )
      const entry = requireRow(entryResult.rows[0], 'Pocket entry')
      return {
        pocket: mapPocket(requireRow(updatedResult.rows[0], 'Pocket')),
        entry: {
          id: String(entry.id),
          pocketId,
          userId,
          amount: draft.amount,
          direction: draft.direction,
          note: draft.note || undefined,
          createdAt: timestampString(entry.created_at),
        },
      }
    }))
  }

  async listReminders(userId: string): Promise<Reminder[]> {
    const result = await this.run('list reminders', () => this.database.query(
      `SELECT * FROM reminders WHERE user_id = $1 ORDER BY due_at ASC`,
      [userId],
    ))
    return result.rows.map((row) => mapReminder(row))
  }

  async getReminder(userId: string, reminderId: string): Promise<Reminder | null> {
    const result = await this.run('load reminder', () => this.database.query(
      `SELECT * FROM reminders WHERE id = $1 AND user_id = $2`,
      [reminderId, userId],
    ))
    return result.rows[0] ? mapReminder(result.rows[0]) : null
  }

  async createReminder(userId: string, draft: ReminderDraft): Promise<Reminder> {
    await this.assertLinkedPocket(userId, draft)
    const result = await this.run('create reminder', () => this.database.query(
      `INSERT INTO reminders
        (user_id, linked_object_type, linked_object_id, title, due_at, repeat_rule, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'open')
       RETURNING *`,
      [userId, draft.linkedObjectType, draft.linkedObjectId || null, draft.title, draft.dueAt, draft.repeatRule || null],
    ))
    return mapReminder(requireRow(result.rows[0], 'Reminder'))
  }

  async updateReminder(
    userId: string,
    reminderId: string,
    draft: ReminderDraft,
    status: ReminderStatus,
  ): Promise<Reminder | null> {
    const current = await this.getReminder(userId, reminderId)
    if (!current) return null
    await this.assertLinkedPocket(userId, draft)
    const repeats = status === 'done' && Boolean(draft.repeatRule)
    const dueAt = repeats ? advanceReminderDueAt(draft.dueAt, draft.repeatRule) : draft.dueAt
    const nextStatus = repeats ? 'open' : status
    const result = await this.run('update reminder', () => this.database.query(
      `UPDATE reminders
       SET linked_object_type = $3, linked_object_id = $4, title = $5,
           due_at = $6, repeat_rule = $7, status = $8, updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [reminderId, userId, draft.linkedObjectType, draft.linkedObjectId || null, draft.title, dueAt, draft.repeatRule || null, nextStatus],
    ))
    return result.rows[0] ? mapReminder(result.rows[0]) : null
  }

  async deleteReminder(userId: string, reminderId: string): Promise<boolean> {
    const result = await this.run('delete reminder', () => this.database.query(
      `DELETE FROM reminders WHERE id = $1 AND user_id = $2 RETURNING id`,
      [reminderId, userId],
    ))
    return result.rowCount === 1 || result.rows.length === 1
  }

  async listSpendRules(userId: string): Promise<SpendRule[]> {
    const result = await this.run('list spend rules', () => this.database.query(
      `SELECT * FROM spend_rules WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId],
    ))
    return result.rows.map((row) => mapSpendRule(row))
  }

  async getSpendRule(userId: string, ruleId: string): Promise<SpendRule | null> {
    const result = await this.run('load spend rule', () => this.database.query(
      `SELECT * FROM spend_rules WHERE id = $1 AND user_id = $2`,
      [ruleId, userId],
    ))
    return result.rows[0] ? mapSpendRule(result.rows[0]) : null
  }

  async createSpendRule(userId: string, draft: SpendRuleDraft): Promise<SpendRule> {
    const result = await this.run('create spend rule', () => this.database.query(
      `INSERT INTO spend_rules
        (user_id, category, unit, limit_amount, period, warning_threshold, enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [userId, draft.category, draft.unit, draft.limitAmount, draft.period, draft.warningThreshold, draft.enabled],
    ))
    return mapSpendRule(requireRow(result.rows[0], 'Spend rule'))
  }

  async updateSpendRule(userId: string, ruleId: string, draft: SpendRuleDraft): Promise<SpendRule | null> {
    const result = await this.run('update spend rule', () => this.database.query(
      `UPDATE spend_rules
       SET category = $3, unit = $4, limit_amount = $5, period = $6,
           warning_threshold = $7, enabled = $8, updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [ruleId, userId, draft.category, draft.unit, draft.limitAmount, draft.period, draft.warningThreshold, draft.enabled],
    ))
    return result.rows[0] ? mapSpendRule(result.rows[0]) : null
  }

  async deleteSpendRule(userId: string, ruleId: string): Promise<boolean> {
    const result = await this.run('delete spend rule', () => this.database.query(
      `DELETE FROM spend_rules WHERE id = $1 AND user_id = $2 RETURNING id`,
      [ruleId, userId],
    ))
    return result.rowCount === 1 || result.rows.length === 1
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

  private async run<T>(label: string, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof PlanningRepositoryError) throw error
      throw new Error(`Could not ${label}: ${errorMessage(error)}`, { cause: error })
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
    deadline: row.deadline ? timestampString(row.deadline) : undefined,
    status: row.status as Pocket['status'],
    archivedAt: row.archived_at ? timestampString(row.archived_at) : undefined,
    createdAt: timestampString(row.created_at),
    updatedAt: timestampString(row.updated_at),
  }
}

function mapReminder(row: Record<string, unknown>): Reminder {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    linkedObjectType: row.linked_object_type as Reminder['linkedObjectType'],
    linkedObjectId: row.linked_object_id ? String(row.linked_object_id) : undefined,
    title: String(row.title),
    dueAt: timestampString(row.due_at),
    repeatRule: row.repeat_rule ? String(row.repeat_rule) : undefined,
    status: row.status as Reminder['status'],
    createdAt: timestampString(row.created_at),
    updatedAt: timestampString(row.updated_at),
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
    createdAt: timestampString(row.created_at),
    updatedAt: timestampString(row.updated_at),
  }
}

function requireRow(row: Record<string, unknown> | undefined, label: string): Record<string, unknown> {
  if (!row) throw new Error(`${label} was not returned by the database.`)
  return row
}

function timestampString(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
