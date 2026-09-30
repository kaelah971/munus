import { describe, expect, it } from 'vitest'
import { InMemoryPlanningRepository, PlanningRepositoryError } from './planningRepository'

const pocketDraft = {
  name: 'Monthly data',
  type: 'Data' as const,
  unit: 'NGN' as const,
  targetAmount: '1000',
  deadline: '',
}

describe('Munus planning persistence', () => {
  it('keeps pocket ownership and exact allocation totals', async () => {
    const repository = new InMemoryPlanningRepository()
    const pocket = await repository.createPocket('user-a', pocketDraft)

    await repository.addPocketAllocation('user-a', pocket.id, {
      amount: '0.1',
      direction: 'allocation',
      note: '',
    })
    const allocated = await repository.addPocketAllocation('user-a', pocket.id, {
      amount: '0.2',
      direction: 'allocation',
      note: '',
    })

    expect(allocated.pocket.plannedAmount).toBe('0.3')
    expect(await repository.getPocket('user-b', pocket.id)).toBeNull()
    await expect(
      repository.addPocketAllocation('user-a', pocket.id, {
        amount: '0.31',
        direction: 'reduction',
        note: '',
      }),
    ).rejects.toMatchObject<Partial<PlanningRepositoryError>>({ statusCode: 400 })
  })

  it('archives pockets without deleting planning history', async () => {
    const repository = new InMemoryPlanningRepository()
    const pocket = await repository.createPocket('user-a', pocketDraft)
    const archived = await repository.archivePocket('user-a', pocket.id)

    expect(archived?.status).toBe('archived')
    expect(await repository.getPocket('user-a', pocket.id)).toMatchObject({ status: 'archived' })
    expect(await repository.listPockets('user-a')).toEqual([])
    expect(await repository.listPockets('user-a', true)).toHaveLength(1)
  })

  it('requires linked reminders to use an owned pocket and persists spend rules', async () => {
    const repository = new InMemoryPlanningRepository()
    const pocket = await repository.createPocket('user-a', pocketDraft)
    const reminder = await repository.createReminder('user-a', {
      linkedObjectType: 'pocket',
      linkedObjectId: pocket.id,
      title: 'Review data plan',
      dueAt: '2026-02-01T00:00:00.000Z',
      repeatRule: 'monthly',
    })

    expect(await repository.getReminder('user-b', reminder.id)).toBeNull()
    await expect(repository.createReminder('user-b', {
      linkedObjectType: 'pocket',
      linkedObjectId: pocket.id,
      title: 'Not yours',
      dueAt: '2026-02-01T00:00:00.000Z',
      repeatRule: '',
    })).rejects.toMatchObject({ statusCode: 404 })

    const rule = await repository.createSpendRule('user-a', {
      category: 'Data',
      limitAmount: '5000',
      unit: 'NGN',
      period: 'monthly',
      warningThreshold: 80,
      enabled: true,
    })
    expect(await repository.listSpendRules('user-a')).toMatchObject([{ id: rule.id, limitAmount: '5000' }])
  })
})
