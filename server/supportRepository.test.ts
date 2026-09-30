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
