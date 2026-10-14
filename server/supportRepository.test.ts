import { describe, expect, it } from 'vitest'
import { InMemorySupportRepository, SupportRepositoryError } from './supportRepository'

const contactDraft = {
  displayName: 'Mum',
  relationship: 'Parent',
  phone: '08012345678',
  network: 'MTN' as const,
  country: 'NG' as const,
  usualProductType: 'Airtime' as const,
  usualAmount: '1000',
  notes: 'Usually monthly',
}

const requestDraft = {
  contactId: '',
  category: 'Airtime' as const,
  requestedAmount: '100',
  requestedProduct: 'Airtime for today',
  phone: '08012345678',
  network: 'MTN' as const,
  country: 'NG' as const,
  message: 'Please help with airtime.',
  expiresAt: '',
}

describe('Munus support persistence', () => {
  it('keeps contacts private and prevents destructive duplicates', async () => {
    const repository = new InMemorySupportRepository()
    const contact = await repository.createContact('user-a', contactDraft)

    expect(await repository.getContact('user-b', contact.id)).toBeNull()
    await expect(repository.createContact('user-a', contactDraft)).rejects.toMatchObject<Partial<SupportRepositoryError>>({ statusCode: 409 })
    const archived = await repository.archiveContact('user-a', contact.id)
    expect(archived?.archivedAt).toBeTruthy()
    expect(await repository.listContacts('user-a')).toEqual([])
  })

  it('creates a reviewable request, transitions it, and converts it to a draft', async () => {
    const repository = new InMemorySupportRepository()
    repository.setProfileName('user-a', 'Amina')
    const contact = await repository.createContact('user-a', contactDraft)
    const request = await repository.createSupportRequest('user-a', { ...requestDraft, contactId: contact.id })
    const publicRequest = await repository.getPublicSupportRequest(request.publicRequestId)

    expect(publicRequest).toMatchObject({ requesterLabel: 'Amina', requestedAmount: '100', phone: '080•••5678' })
    expect(publicRequest).not.toHaveProperty('id')
    const approved = await repository.updateSupportRequest('user-a', request.id, { ...requestDraft, contactId: contact.id }, 'approved')
    expect(approved?.status).toBe('approved')

    const draft = await repository.convertRequestToDraft('user-a', request.id)
    expect(draft).toMatchObject({ source: 'request', contactId: contact.id, amount: '100', recipientName: 'Mum' })
    expect((await repository.getSupportRequest('user-a', request.id))?.status).toBe('prepared')
  })

  it('keeps essential rows out of legacy planning flows', async () => {
    const repository = new InMemorySupportRepository()
    repository.setProfileName('user-a', 'Amina')
    const essential = await repository.createEssentialRequest('user-a', {
      serviceType: 'AIRTIME',
      network: 'MTN',
      recipientPhone: '08012345678',
      requestedAmount: '1000',
      message: 'Need airtime',
      expiresAt: '2099-01-01T00:00:00.000Z',
    })
    expect(essential).toMatchObject({ essentialStatus: 'OPEN', recipientPhone: '08012345678' })
    expect(await repository.listSupportRequests('user-a')).toEqual([])
    expect(await repository.getSupportRequest('user-a', essential.id)).toBeNull()
    expect(await repository.getPublicSupportRequest(essential.publicRequestId)).toBeNull()
    expect(await repository.listEssentialRequests('user-b')).toEqual([])
    expect(await repository.getEssentialRequest('user-b', essential.id)).toBeNull()
    expect(await repository.listEssentialRequests('user-a')).toHaveLength(1)
    const projection = await repository.getPublicEssentialRequest(essential.publicRequestId)
    expect(projection).toMatchObject({ requesterLabel: 'Amina', recipientMasked: '080•••5678', essentialStatus: 'OPEN' })
    expect(projection).not.toHaveProperty('recipientPhone')
    expect(await repository.getPublicEssentialRequest('missing')).toBeNull()
  })

  it('claims atomically, releases stale claims, and syncs forward only', async () => {
    const repository = new InMemorySupportRepository()
    const created = await repository.createEssentialRequest('user-a', {
      serviceType: 'DATA',
      network: 'MTN',
      recipientPhone: '08012345678',
      requestedAmount: '350',
      providerPlanId: 'MTN-15',
      planDisplayLabel: '1.5GB - 7 days',
      message: '',
      expiresAt: '2099-01-01T00:00:00.000Z',
    })
    const now = '2026-06-01T00:00:00.000Z'
    const live = '2026-06-01T00:15:00.000Z'
    const claimed = await repository.claimEssentialRequest('user-b', created.id, 'ord-1', now, live)
    expect(claimed).toMatchObject({ essentialStatus: 'PAYMENT_IN_PROGRESS', paymentOrderId: 'ord-1' })
    expect(await repository.claimEssentialRequest('user-c', created.id, 'ord-2', now, live)).toBeNull()
    expect(await repository.findEssentialRequestByOrder('ord-1')).toMatchObject({ id: created.id })
    expect(await repository.findEssentialRequestByOrder('ord-2')).toBeNull()

    // A lapsed claim frees the need for the next payer.
    const reclaimed = await repository.claimEssentialRequest('user-c', created.id, 'ord-2', '2026-06-01T00:16:00.000Z', '2026-06-01T00:31:00.000Z')
    expect(reclaimed).toMatchObject({ paymentOrderId: 'ord-2' })

    // Sync guards terminal states and lost races.
    const advanced = await repository.applyEssentialSync(created.id, { expectedStatus: 'PAYMENT_IN_PROGRESS', essentialStatus: 'PAID', paidAt: now, clearClaim: true })
    expect(advanced).toMatchObject({ essentialStatus: 'PAID', paidAt: now })
    expect(await repository.applyEssentialSync(created.id, { expectedStatus: 'PAYMENT_IN_PROGRESS', essentialStatus: 'OPEN', clearClaim: true })).toBeNull()
    // Illegal jumps are refused; legal steps walk forward.
    expect(await repository.applyEssentialSync(created.id, { expectedStatus: 'PAID', essentialStatus: 'COMPLETED', fulfilledAt: now, clearClaim: true })).toBeNull()
    const delivering = await repository.applyEssentialSync(created.id, { expectedStatus: 'PAID', essentialStatus: 'FULFILLING', clearClaim: true })
    expect(delivering?.essentialStatus).toBe('FULFILLING')
    const done = await repository.applyEssentialSync(created.id, { expectedStatus: 'FULFILLING', essentialStatus: 'COMPLETED', fulfilledAt: now, clearClaim: true })
    expect(done?.essentialStatus).toBe('COMPLETED')
    // Cancel is refused once terminal; owner cancel works while open.
    expect(await repository.cancelEssentialRequest('user-a', created.id)).toBeNull()
    const fresh = await repository.createEssentialRequest('user-a', {
      serviceType: 'AIRTIME',
      network: 'MTN',
      recipientPhone: '08012345678',
      requestedAmount: '100',
      message: '',
      expiresAt: '2099-01-01T00:00:00.000Z',
    })
    expect((await repository.cancelEssentialRequest('user-a', fresh.id))?.essentialStatus).toBe('CANCELLED')
    expect(await repository.cancelEssentialRequest('user-b', fresh.id)).toBeNull()
  })

  it('isolates support rules by account', async () => {
    const repository = new InMemorySupportRepository()
    const rule = await repository.createSupportRule('user-a', {
      contactId: '',
      category: 'Data',
      period: 'monthly',
      softLimitAmount: '500',
      unit: 'NGN',
      warningThreshold: 80,
      enabled: true,
    })
    expect(await repository.getSupportRule('user-b', rule.id)).toBeNull()
    expect(await repository.listSupportRules('user-b')).toEqual([])
  })
})
