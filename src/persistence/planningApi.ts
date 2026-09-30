import type {
  Pocket,
  PocketAllocationDraft,
  PocketDraft,
  PlanningData,
  Reminder,
  ReminderDraft,
  ReminderStatus,
  SpendRule,
  SpendRuleDraft,
} from '../domain/planning'

export interface PlanningApi {
  load(): Promise<PlanningData>
  createPocket(draft: PocketDraft): Promise<Pocket>
  updatePocket(id: string, draft: PocketDraft): Promise<Pocket>
  archivePocket(id: string): Promise<Pocket>
  addPocketAllocation(id: string, draft: PocketAllocationDraft): Promise<{ pocket: Pocket }>
  createReminder(draft: ReminderDraft): Promise<Reminder>
  updateReminder(id: string, draft: ReminderDraft, status: ReminderStatus): Promise<Reminder>
  deleteReminder(id: string): Promise<void>
  createSpendRule(draft: SpendRuleDraft): Promise<SpendRule>
  updateSpendRule(id: string, draft: SpendRuleDraft): Promise<SpendRule>
  deleteSpendRule(id: string): Promise<void>
}

export class RemotePlanningApi implements PlanningApi {
  constructor(private readonly baseUrl: string) {}

  async load(): Promise<PlanningData> {
    const [pockets, reminders, spendRules] = await Promise.all([
      this.read<{ pockets: Pocket[] }>('/pockets'),
      this.read<{ reminders: Reminder[] }>('/reminders'),
      this.read<{ spendRules: SpendRule[] }>('/spend-rules'),
    ])
    return {
      pockets: pockets.pockets,
      reminders: reminders.reminders,
      spendRules: spendRules.spendRules,
    }
  }

  createPocket(draft: PocketDraft): Promise<Pocket> {
    return this.read('/pockets', { method: 'POST', body: JSON.stringify(draft) })
  }

  updatePocket(id: string, draft: PocketDraft): Promise<Pocket> {
    return this.read(`/pockets/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(draft),
    })
  }

  archivePocket(id: string): Promise<Pocket> {
    return this.read(`/pockets/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  addPocketAllocation(id: string, draft: PocketAllocationDraft): Promise<{ pocket: Pocket }> {
    return this.read(`/pockets/${encodeURIComponent(id)}/allocations`, {
      method: 'POST',
      body: JSON.stringify(draft),
    })
  }

  createReminder(draft: ReminderDraft): Promise<Reminder> {
    return this.read('/reminders', { method: 'POST', body: JSON.stringify(draft) })
  }

  updateReminder(id: string, draft: ReminderDraft, status: ReminderStatus): Promise<Reminder> {
    return this.read(`/reminders/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...draft, status }),
    })
  }

  async deleteReminder(id: string): Promise<void> {
    await this.request(`/reminders/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  createSpendRule(draft: SpendRuleDraft): Promise<SpendRule> {
    return this.read('/spend-rules', { method: 'POST', body: JSON.stringify(draft) })
  }

  updateSpendRule(id: string, draft: SpendRuleDraft): Promise<SpendRule> {
    return this.read(`/spend-rules/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(draft),
    })
  }

  async deleteSpendRule(id: string): Promise<void> {
    await this.request(`/spend-rules/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  private async read<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.request(path, init)
    return (await response.json()) as T
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    })
    if (!response.ok) {
      throw new Error(`Munus planning request failed (${response.status}).`)
    }
    return response
  }
}
