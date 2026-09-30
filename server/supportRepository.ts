import { randomBytes, randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  canTransitionSupportRequest,
  maskPhone,
  type Contact,
  type ContactDraft,
  type PublicSupportRequest,
  type SupportDraft,
  type SupportDraftInput,
  type SupportRequest,
  type SupportRequestDraft,
  type SupportRequestStatus,
  type SupportRule,
  type SupportRuleDraft,
} from '../src/domain/support'

export class SupportRepositoryError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message)
    this.name = 'SupportRepositoryError'
  }
}

export interface SupportRepository {
  listContacts(userId: string, includeArchived?: boolean): Promise<Contact[]>
  getContact(userId: string, contactId: string): Promise<Contact | null>
  createContact(userId: string, draft: ContactDraft): Promise<Contact>
  updateContact(userId: string, contactId: string, draft: ContactDraft): Promise<Contact | null>
  archiveContact(userId: string, contactId: string): Promise<Contact | null>
  listSupportRules(userId: string): Promise<SupportRule[]>
  getSupportRule(userId: string, ruleId: string): Promise<SupportRule | null>
  createSupportRule(userId: string, draft: SupportRuleDraft): Promise<SupportRule>
  updateSupportRule(userId: string, ruleId: string, draft: SupportRuleDraft): Promise<SupportRule | null>
  deleteSupportRule(userId: string, ruleId: string): Promise<boolean>
  listSupportRequests(userId: string): Promise<SupportRequest[]>
  getSupportRequest(userId: string, requestId: string): Promise<SupportRequest | null>
  createSupportRequest(userId: string, draft: SupportRequestDraft): Promise<SupportRequest>
  updateSupportRequest(userId: string, requestId: string, draft: SupportRequestDraft, status: SupportRequestStatus): Promise<SupportRequest | null>
  createSupportDraft(userId: string, input: SupportDraftInput): Promise<SupportDraft>
  listSupportDrafts(userId: string): Promise<SupportDraft[]>
  updateSupportDraft(userId: string, draftId: string, input: SupportDraftInput): Promise<SupportDraft | null>
  getPublicSupportRequest(publicRequestId: string): Promise<PublicSupportRequest | null>
  convertRequestToDraft(userId: string, requestId: string): Promise<SupportDraft | null>
}

export class InMemorySupportRepository implements SupportRepository {
  readonly contacts = new Map<string, Contact>()
  readonly supportRules = new Map<string, SupportRule>()
  readonly supportRequests = new Map<string, SupportRequest>()
  readonly supportDrafts = new Map<string, SupportDraft>()
  private readonly profileNames = new Map<string, string>()

  setProfileName(userId: string, displayName: string): void {
    this.profileNames.set(userId, displayName)
  }

  async listContacts(userId: string, includeArchived = false): Promise<Contact[]> {
    return [...this.contacts.values()].filter(
      (contact) => contact.userId === userId && (includeArchived || !contact.archivedAt),
    )
  }

  async getContact(userId: string, contactId: string): Promise<Contact | null> {
    const contact = this.contacts.get(contactId)
    return contact?.userId === userId ? contact : null
  }

  async createContact(userId: string, draft: ContactDraft): Promise<Contact> {
    const duplicate = [...this.contacts.values()].find(
      (contact) => contact.userId === userId && !contact.archivedAt && contact.phone === draft.phone,
    )
    if (duplicate) throw new SupportRepositoryError('A contact with this phone is already saved.', 409)
    const now = new Date().toISOString()
    const contact: Contact = {
      id: randomUUID(),
      userId,
      displayName: draft.displayName,
      relationship: draft.relationship || undefined,
      phone: draft.phone,
      network: draft.network || undefined,
      country: 'NG',
      usualProductType: draft.usualProductType || undefined,
      usualAmount: draft.usualAmount || undefined,
      notes: draft.notes || undefined,
      createdAt: now,
      updatedAt: now,
    }
    this.contacts.set(contact.id, contact)
    return contact
  }

  async updateContact(userId: string, contactId: string, draft: ContactDraft): Promise<Contact | null> {
    const contact = await this.getContact(userId, contactId)
    if (!contact) return null
    const duplicate = [...this.contacts.values()].find(
      (item) => item.id !== contactId && item.userId === userId && !item.archivedAt && item.phone === draft.phone,
    )
    if (duplicate) throw new SupportRepositoryError('A contact with this phone is already saved.', 409)
    const updated: Contact = {
      ...contact,
      displayName: draft.displayName,
      relationship: draft.relationship || undefined,
      phone: draft.phone,
      network: draft.network || undefined,
      usualProductType: draft.usualProductType || undefined,
      usualAmount: draft.usualAmount || undefined,
      notes: draft.notes || undefined,
      updatedAt: new Date().toISOString(),
    }
    this.contacts.set(contactId, updated)
    return updated
  }

  async archiveContact(userId: string, contactId: string): Promise<Contact | null> {
    const contact = await this.getContact(userId, contactId)
    if (!contact) return null
    const archived = { ...contact, archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    this.contacts.set(contactId, archived)
    return archived
  }

  async listSupportRules(userId: string): Promise<SupportRule[]> {
    return [...this.supportRules.values()].filter((rule) => rule.userId === userId)
  }

  async getSupportRule(userId: string, ruleId: string): Promise<SupportRule | null> {
    const rule = this.supportRules.get(ruleId)
    return rule?.userId === userId ? rule : null
  }

  async createSupportRule(userId: string, draft: SupportRuleDraft): Promise<SupportRule> {
    await this.assertContact(userId, draft.contactId)
    const now = new Date().toISOString()
    const rule: SupportRule = { id: randomUUID(), userId, ...draft, contactId: draft.contactId || undefined, createdAt: now, updatedAt: now }
    this.supportRules.set(rule.id, rule)
    return rule
  }

  async updateSupportRule(userId: string, ruleId: string, draft: SupportRuleDraft): Promise<SupportRule | null> {
    const rule = await this.getSupportRule(userId, ruleId)
    if (!rule) return null
    await this.assertContact(userId, draft.contactId)
    const updated = { ...rule, ...draft, contactId: draft.contactId || undefined, updatedAt: new Date().toISOString() }
    this.supportRules.set(ruleId, updated)
    return updated
  }

  async deleteSupportRule(userId: string, ruleId: string): Promise<boolean> {
    const rule = await this.getSupportRule(userId, ruleId)
    if (!rule) return false
    this.supportRules.delete(ruleId)
    return true
  }

  async listSupportRequests(userId: string): Promise<SupportRequest[]> {
    return [...this.supportRequests.values()].filter(
      (request) => request.ownerUserId === userId || request.requesterUserId === userId || request.recipientUserId === userId,
    )
  }

  async getSupportRequest(userId: string, requestId: string): Promise<SupportRequest | null> {
    const request = this.supportRequests.get(requestId)
    if (!request) return null
    return request.ownerUserId === userId || request.requesterUserId === userId || request.recipientUserId === userId ? request : null
  }

  async createSupportRequest(userId: string, draft: SupportRequestDraft): Promise<SupportRequest> {
    await this.assertContact(userId, draft.contactId)
    const now = new Date().toISOString()
    const request: SupportRequest = {
      id: randomUUID(),
      requesterUserId: userId,
      ownerUserId: userId,
      contactId: draft.contactId || undefined,
      publicRequestId: randomBytes(18).toString('base64url'),
      category: draft.category,
      requestedAmount: draft.requestedAmount,
      requestedProduct: draft.requestedProduct,
      phone: draft.phone || undefined,
      network: draft.network || undefined,
      country: 'NG',
      message: draft.message || undefined,
      status: 'pending',
      expiresAt: draft.expiresAt || undefined,
      createdAt: now,
      updatedAt: now,
    }
    this.supportRequests.set(request.id, request)
    return request
  }

  async updateSupportRequest(userId: string, requestId: string, draft: SupportRequestDraft, status: SupportRequestStatus): Promise<SupportRequest | null> {
    const current = await this.getSupportRequest(userId, requestId)
    if (!current) return null
    if (!canTransitionSupportRequest(current.status, status)) {
      throw new SupportRepositoryError(`A ${current.status} request cannot become ${status}.`, 409)
    }
    await this.assertContact(userId, draft.contactId)
    const updated = {
      ...current,
      ...draft,
      contactId: draft.contactId || undefined,
      phone: draft.phone || undefined,
      network: draft.network || undefined,
      message: draft.message || undefined,
      expiresAt: draft.expiresAt || undefined,
      status,
      updatedAt: new Date().toISOString(),
    }
    this.supportRequests.set(requestId, updated)
    return updated
  }

  async createSupportDraft(userId: string, input: SupportDraftInput): Promise<SupportDraft> {
    await this.assertContact(userId, input.contactId)
    const now = new Date().toISOString()
    const draft: SupportDraft = {
      id: randomUUID(),
      userId,
      source: input.source,
      contactId: input.contactId || undefined,
      requestId: input.requestId || undefined,
      category: input.category,
      recipientName: input.recipientName,
      recipientPhone: input.recipientPhone,
      recipientNetwork: input.recipientNetwork || undefined,
      recipientCountry: 'NG',
      amount: input.amount,
      unit: input.unit,
      productDetails: input.productDetails,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    }
    this.supportDrafts.set(draft.id, draft)
    return draft
  }

  async listSupportDrafts(userId: string): Promise<SupportDraft[]> {
    return [...this.supportDrafts.values()].filter((draft) => draft.userId === userId)
  }

  async updateSupportDraft(userId: string, draftId: string, input: SupportDraftInput): Promise<SupportDraft | null> {
    const current = this.supportDrafts.get(draftId)
    if (!current || current.userId !== userId) return null
    await this.assertContact(userId, input.contactId)
    const updated = { ...current, ...input, contactId: input.contactId || undefined, requestId: input.requestId || undefined, recipientNetwork: input.recipientNetwork || undefined, updatedAt: new Date().toISOString() }
    this.supportDrafts.set(draftId, updated)
    return updated
  }

  async getPublicSupportRequest(publicRequestId: string): Promise<PublicSupportRequest | null> {
    const request = [...this.supportRequests.values()].find((item) => item.publicRequestId === publicRequestId)
    if (!request || (request.status !== 'pending' && request.status !== 'approved')) return null
    if (request.expiresAt && Date.parse(request.expiresAt) <= Date.now()) return null
    return {
      publicRequestId: request.publicRequestId,
      requesterLabel: this.profileNames.get(request.ownerUserId) ?? 'A Munus user',
      category: request.category,
      requestedAmount: request.requestedAmount,
      requestedProduct: request.requestedProduct,
      phone: request.phone ? maskPhone(request.phone) : undefined,
      network: request.network,
      country: request.country,
      message: request.message,
      status: request.status,
      expiresAt: request.expiresAt,
    }
  }

  async convertRequestToDraft(userId: string, requestId: string): Promise<SupportDraft | null> {
    const request = await this.getSupportRequest(userId, requestId)
    if (!request) return null
    if (request.status !== 'approved') throw new SupportRepositoryError('Only approved requests can become drafts.', 409)
    const contact = request.contactId ? await this.getContact(userId, request.contactId) : null
    const draft = await this.createSupportDraft(userId, {
      source: 'request',
      contactId: request.contactId ?? '',
      requestId,
      category: request.category,
      recipientName: contact?.displayName ?? 'Requested support',
      recipientPhone: request.phone ?? contact?.phone ?? '',
      recipientNetwork: request.network ?? contact?.network ?? '',
      recipientCountry: request.country,
      amount: request.requestedAmount,
      unit: 'NGN',
      productDetails: request.requestedProduct,
    })
    this.supportRequests.set(requestId, { ...request, status: 'prepared', updatedAt: new Date().toISOString() })
    return draft
  }

  private async assertContact(userId: string, contactId: string): Promise<void> {
    if (contactId && !(await this.getContact(userId, contactId))) {
      throw new SupportRepositoryError('Contact was not found.', 404)
    }
  }
}

export class SupabaseSupportRepository implements SupportRepository {
  constructor(private readonly client: SupabaseClient) {}

  async listContacts(userId: string, includeArchived = false): Promise<Contact[]> {
    let query = this.client.from('contacts').select('*').eq('user_id', userId).order('display_name')
    if (!includeArchived) query = query.is('archived_at', null)
    const { data, error } = await query
    if (error) throw new Error(`Could not list contacts: ${error.message}`)
    return (data ?? []).map((row: Record<string, unknown>) => mapContact(row))
  }

  async getContact(userId: string, contactId: string): Promise<Contact | null> {
    const { data, error } = await this.client.from('contacts').select('*').eq('id', contactId).eq('user_id', userId).maybeSingle()
    if (error) throw new Error(`Could not load contact: ${error.message}`)
    return data ? mapContact(data) : null
  }

  async createContact(userId: string, draft: ContactDraft): Promise<Contact> {
    const { data: duplicate, error: duplicateError } = await this.client.from('contacts').select('id').eq('user_id', userId).eq('phone', draft.phone).is('archived_at', null).maybeSingle()
    if (duplicateError) throw new Error(`Could not check contact duplicates: ${duplicateError.message}`)
    if (duplicate) throw new SupportRepositoryError('A contact with this phone is already saved.', 409)
    const { data, error } = await this.client.from('contacts').insert(contactRow(userId, draft)).select('*').single()
    if (error) throw new Error(`Could not create contact: ${error.message}`)
    return mapContact(data)
  }

  async updateContact(userId: string, contactId: string, draft: ContactDraft): Promise<Contact | null> {
    const current = await this.getContact(userId, contactId)
    if (!current) return null
    const { data: duplicate, error: duplicateError } = await this.client.from('contacts').select('id').eq('user_id', userId).eq('phone', draft.phone).neq('id', contactId).is('archived_at', null).maybeSingle()
    if (duplicateError) throw new Error(`Could not check contact duplicates: ${duplicateError.message}`)
    if (duplicate) throw new SupportRepositoryError('A contact with this phone is already saved.', 409)
    const { data, error } = await this.client.from('contacts').update(contactRow(userId, draft)).eq('id', contactId).eq('user_id', userId).select('*').maybeSingle()
    if (error) throw new Error(`Could not update contact: ${error.message}`)
    return data ? mapContact(data) : null
  }

  async archiveContact(userId: string, contactId: string): Promise<Contact | null> {
    const { data, error } = await this.client.from('contacts').update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', contactId).eq('user_id', userId).select('*').maybeSingle()
    if (error) throw new Error(`Could not archive contact: ${error.message}`)
    return data ? mapContact(data) : null
  }

  async listSupportRules(userId: string): Promise<SupportRule[]> {
    const { data, error } = await this.client.from('support_rules').select('*').eq('user_id', userId).order('created_at', { ascending: false })
    if (error) throw new Error(`Could not list support rules: ${error.message}`)
    return (data ?? []).map((row: Record<string, unknown>) => mapSupportRule(row))
  }

  async getSupportRule(userId: string, ruleId: string): Promise<SupportRule | null> {
    const { data, error } = await this.client.from('support_rules').select('*').eq('id', ruleId).eq('user_id', userId).maybeSingle()
    if (error) throw new Error(`Could not load support rule: ${error.message}`)
    return data ? mapSupportRule(data) : null
  }

  async createSupportRule(userId: string, draft: SupportRuleDraft): Promise<SupportRule> {
    await this.assertContact(userId, draft.contactId)
    const { data, error } = await this.client.from('support_rules').insert({ user_id: userId, contact_id: draft.contactId || null, category: draft.category, period: draft.period, soft_limit_amount: draft.softLimitAmount, unit: draft.unit, warning_threshold: draft.warningThreshold, enabled: draft.enabled }).select('*').single()
    if (error) throw new Error(`Could not create support rule: ${error.message}`)
    return mapSupportRule(data)
  }

  async updateSupportRule(userId: string, ruleId: string, draft: SupportRuleDraft): Promise<SupportRule | null> {
    await this.assertContact(userId, draft.contactId)
    const { data, error } = await this.client.from('support_rules').update({ contact_id: draft.contactId || null, category: draft.category, period: draft.period, soft_limit_amount: draft.softLimitAmount, unit: draft.unit, warning_threshold: draft.warningThreshold, enabled: draft.enabled, updated_at: new Date().toISOString() }).eq('id', ruleId).eq('user_id', userId).select('*').maybeSingle()
    if (error) throw new Error(`Could not update support rule: ${error.message}`)
    return data ? mapSupportRule(data) : null
  }

  async deleteSupportRule(userId: string, ruleId: string): Promise<boolean> {
    const { data, error } = await this.client.from('support_rules').delete().eq('id', ruleId).eq('user_id', userId).select('id')
    if (error) throw new Error(`Could not delete support rule: ${error.message}`)
    return Array.isArray(data) && data.length > 0
  }

  async listSupportRequests(userId: string): Promise<SupportRequest[]> {
    const { data, error } = await this.client.from('support_requests').select('*').or(`owner_user_id.eq.${userId},requester_user_id.eq.${userId},recipient_user_id.eq.${userId}`).order('created_at', { ascending: false })
    if (error) throw new Error(`Could not list support requests: ${error.message}`)
    return (data ?? []).map((row: Record<string, unknown>) => mapSupportRequest(row))
  }

  async getSupportRequest(userId: string, requestId: string): Promise<SupportRequest | null> {
    const { data, error } = await this.client.from('support_requests').select('*').eq('id', requestId).maybeSingle()
    if (error) throw new Error(`Could not load support request: ${error.message}`)
    if (!data) return null
    const request = mapSupportRequest(data)
    return request.ownerUserId === userId || request.requesterUserId === userId || request.recipientUserId === userId ? request : null
  }

  async createSupportRequest(userId: string, draft: SupportRequestDraft): Promise<SupportRequest> {
    await this.assertContact(userId, draft.contactId)
    const { data, error } = await this.client.from('support_requests').insert({ ...requestRow(userId, draft), public_request_id: randomBytes(18).toString('base64url'), requester_user_id: userId, owner_user_id: userId, status: 'pending' }).select('*').single()
    if (error) throw new Error(`Could not create support request: ${error.message}`)
    return mapSupportRequest(data)
  }

  async updateSupportRequest(userId: string, requestId: string, draft: SupportRequestDraft, status: SupportRequestStatus): Promise<SupportRequest | null> {
    const current = await this.getSupportRequest(userId, requestId)
    if (!current) return null
    if (!canTransitionSupportRequest(current.status, status)) throw new SupportRepositoryError(`A ${current.status} request cannot become ${status}.`, 409)
    await this.assertContact(userId, draft.contactId)
    const { data, error } = await this.client.from('support_requests').update({ ...requestRow(userId, draft), status, updated_at: new Date().toISOString() }).eq('id', requestId).eq('owner_user_id', userId).select('*').maybeSingle()
    if (error) throw new Error(`Could not update support request: ${error.message}`)
    return data ? mapSupportRequest(data) : null
  }

  async createSupportDraft(userId: string, input: SupportDraftInput): Promise<SupportDraft> {
    await this.assertContact(userId, input.contactId)
    const { data, error } = await this.client.from('support_drafts').insert(draftRow(userId, input)).select('*').single()
    if (error) throw new Error(`Could not create support draft: ${error.message}`)
    return mapSupportDraft(data)
  }

  async listSupportDrafts(userId: string): Promise<SupportDraft[]> {
    const { data, error } = await this.client.from('support_drafts').select('*').eq('user_id', userId).order('created_at', { ascending: false })
    if (error) throw new Error(`Could not list support drafts: ${error.message}`)
    return (data ?? []).map((row: Record<string, unknown>) => mapSupportDraft(row))
  }

  async updateSupportDraft(userId: string, draftId: string, input: SupportDraftInput): Promise<SupportDraft | null> {
    await this.assertContact(userId, input.contactId)
    const { data, error } = await this.client.from('support_drafts').update({ ...draftRow(userId, input), updated_at: new Date().toISOString() }).eq('id', draftId).eq('user_id', userId).select('*').maybeSingle()
    if (error) throw new Error(`Could not update support draft: ${error.message}`)
    return data ? mapSupportDraft(data) : null
  }

  async getPublicSupportRequest(publicRequestId: string): Promise<PublicSupportRequest | null> {
    const { data, error } = await this.client.from('support_requests').select('*').eq('public_request_id', publicRequestId).maybeSingle()
    if (error) throw new Error(`Could not load public support request: ${error.message}`)
    if (!data) return null
    const request = mapSupportRequest(data)
    if (request.status !== 'pending' && request.status !== 'approved') return null
    if (request.expiresAt && Date.parse(request.expiresAt) <= Date.now()) return null
    const { data: profile } = await this.client.from('profiles').select('display_name').eq('user_id', request.ownerUserId).maybeSingle()
    return {
      publicRequestId: request.publicRequestId,
      requesterLabel: profile?.display_name ?? 'A Munus user',
      category: request.category,
      requestedAmount: request.requestedAmount,
      requestedProduct: request.requestedProduct,
      phone: request.phone ? maskPhone(request.phone) : undefined,
      network: request.network,
      country: request.country,
      message: request.message,
      status: request.status,
      expiresAt: request.expiresAt,
    }
  }

  async convertRequestToDraft(userId: string, requestId: string): Promise<SupportDraft | null> {
    const request = await this.getSupportRequest(userId, requestId)
    if (!request) return null
    if (request.status !== 'approved') throw new SupportRepositoryError('Only approved requests can become drafts.', 409)
    const contact = request.contactId ? await this.getContact(userId, request.contactId) : null
    const draft = await this.createSupportDraft(userId, { source: 'request', contactId: request.contactId ?? '', requestId, category: request.category, recipientName: contact?.displayName ?? 'Requested support', recipientPhone: request.phone ?? contact?.phone ?? '', recipientNetwork: request.network ?? contact?.network ?? '', recipientCountry: request.country, amount: request.requestedAmount, unit: 'NGN', productDetails: request.requestedProduct })
    await this.client.from('support_requests').update({ status: 'prepared', updated_at: new Date().toISOString() }).eq('id', requestId).eq('owner_user_id', userId)
    return draft
  }

  private async assertContact(userId: string, contactId: string): Promise<void> {
    if (contactId && !(await this.getContact(userId, contactId))) throw new SupportRepositoryError('Contact was not found.', 404)
  }
}

function contactRow(userId: string, draft: ContactDraft) {
  return { user_id: userId, display_name: draft.displayName, relationship: draft.relationship || null, phone: draft.phone, network: draft.network || null, country: 'NG', usual_product_type: draft.usualProductType || null, usual_amount: draft.usualAmount || null, notes: draft.notes || null, updated_at: new Date().toISOString() }
}

function requestRow(userId: string, draft: SupportRequestDraft) {
  return { requester_user_id: userId, contact_id: draft.contactId || null, category: draft.category, requested_amount: draft.requestedAmount, requested_product: draft.requestedProduct, phone: draft.phone || null, network: draft.network || null, country: 'NG', message: draft.message || null, expires_at: draft.expiresAt || null }
}

function draftRow(userId: string, input: SupportDraftInput) {
  return { user_id: userId, source: input.source, contact_id: input.contactId || null, request_id: input.requestId || null, category: input.category, recipient_name: input.recipientName, recipient_phone: input.recipientPhone, recipient_network: input.recipientNetwork || null, recipient_country: 'NG', amount: input.amount, unit: input.unit, product_details: input.productDetails, status: 'draft' }
}

function mapContact(row: Record<string, unknown>): Contact {
  return { id: String(row.id), userId: String(row.user_id), displayName: String(row.display_name), relationship: row.relationship ? String(row.relationship) : undefined, phone: String(row.phone), network: row.network as Contact['network'], country: 'NG', usualProductType: row.usual_product_type as Contact['usualProductType'], usualAmount: row.usual_amount ? String(row.usual_amount) : undefined, notes: row.notes ? String(row.notes) : undefined, archivedAt: row.archived_at ? String(row.archived_at) : undefined, createdAt: String(row.created_at), updatedAt: String(row.updated_at) }
}

function mapSupportRule(row: Record<string, unknown>): SupportRule {
  return { id: String(row.id), userId: String(row.user_id), contactId: row.contact_id ? String(row.contact_id) : undefined, category: row.category as SupportRule['category'], period: row.period as SupportRule['period'], softLimitAmount: String(row.soft_limit_amount), unit: row.unit as SupportRule['unit'], warningThreshold: Number(row.warning_threshold), enabled: Boolean(row.enabled), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }
}

function mapSupportRequest(row: Record<string, unknown>): SupportRequest {
  return { id: String(row.id), requesterUserId: row.requester_user_id ? String(row.requester_user_id) : undefined, recipientUserId: row.recipient_user_id ? String(row.recipient_user_id) : undefined, ownerUserId: String(row.owner_user_id), contactId: row.contact_id ? String(row.contact_id) : undefined, publicRequestId: String(row.public_request_id), category: row.category as SupportRequest['category'], requestedAmount: String(row.requested_amount), requestedProduct: String(row.requested_product), phone: row.phone ? String(row.phone) : undefined, network: row.network as SupportRequest['network'], country: 'NG', message: row.message ? String(row.message) : undefined, status: row.status as SupportRequest['status'], expiresAt: row.expires_at ? String(row.expires_at) : undefined, createdAt: String(row.created_at), updatedAt: String(row.updated_at) }
}

function mapSupportDraft(row: Record<string, unknown>): SupportDraft {
  return { id: String(row.id), userId: String(row.user_id), source: row.source as SupportDraft['source'], contactId: row.contact_id ? String(row.contact_id) : undefined, requestId: row.request_id ? String(row.request_id) : undefined, category: row.category as SupportDraft['category'], recipientName: String(row.recipient_name), recipientPhone: String(row.recipient_phone), recipientNetwork: row.recipient_network as SupportDraft['recipientNetwork'], recipientCountry: 'NG', amount: String(row.amount), unit: row.unit as SupportDraft['unit'], productDetails: String(row.product_details), status: row.status as SupportDraft['status'], createdAt: String(row.created_at), updatedAt: String(row.updated_at) }
}
