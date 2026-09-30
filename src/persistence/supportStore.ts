import { normalizeMoney } from '../domain/planning'
import {
  canTransitionSupportRequest,
  maskPhone,
  normalizePhone,
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
} from '../domain/support'
import type { SupportApi, SupportData } from './supportApi'

const SUPPORT_KEY_PREFIX = 'munus:support:'

export class LocalSupportApi implements SupportApi {
  constructor(private readonly userId: string, private readonly storage: Storage | null = getStorage()) {}

  async load(): Promise<SupportData> { return this.readData() }

  async createContact(draft: ContactDraft): Promise<Contact> {
    const data = this.readData()
    if (data.contacts.some((contact) => contact.phone === draft.phone && !contact.archivedAt)) throw new Error('A contact with this phone is already saved.')
    const now = new Date().toISOString()
    const contact: Contact = { id: createId(), userId: this.userId, ...draft, phone: normalizePhone(draft.phone), relationship: draft.relationship || undefined, network: draft.network || undefined, usualProductType: draft.usualProductType || undefined, usualAmount: draft.usualAmount ? normalizeMoney(draft.usualAmount, false) : undefined, notes: draft.notes || undefined, createdAt: now, updatedAt: now }
    data.contacts.unshift(contact); this.writeData(data); return contact
  }

  async updateContact(id: string, draft: ContactDraft): Promise<Contact> {
    const data = this.readData(); const index = data.contacts.findIndex((contact) => contact.id === id)
    if (index < 0) throw new Error('Contact was not found.')
    const current = data.contacts[index]
    const updated: Contact = { ...current, ...draft, phone: normalizePhone(draft.phone), relationship: draft.relationship || undefined, network: draft.network || undefined, usualProductType: draft.usualProductType || undefined, usualAmount: draft.usualAmount ? normalizeMoney(draft.usualAmount, false) : undefined, notes: draft.notes || undefined, updatedAt: new Date().toISOString() }
    data.contacts[index] = updated; this.writeData(data); return updated
  }

  async archiveContact(id: string): Promise<Contact> {
    const data = this.readData(); const index = data.contacts.findIndex((contact) => contact.id === id)
    if (index < 0) throw new Error('Contact was not found.')
    const archived = { ...data.contacts[index], archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    data.contacts[index] = archived; this.writeData(data); return archived
  }

  async createSupportRule(draft: SupportRuleDraft): Promise<SupportRule> {
    const data = this.readData(); const now = new Date().toISOString()
    const rule: SupportRule = { id: createId(), userId: this.userId, ...draft, contactId: draft.contactId || undefined, softLimitAmount: normalizeMoney(draft.softLimitAmount, false), createdAt: now, updatedAt: now }
    data.supportRules.unshift(rule); this.writeData(data); return rule
  }

  async updateSupportRule(id: string, draft: SupportRuleDraft): Promise<SupportRule> {
    const data = this.readData(); const index = data.supportRules.findIndex((rule) => rule.id === id)
    if (index < 0) throw new Error('Support rule was not found.')
    const updated = { ...data.supportRules[index], ...draft, contactId: draft.contactId || undefined, softLimitAmount: normalizeMoney(draft.softLimitAmount, false), updatedAt: new Date().toISOString() }
    data.supportRules[index] = updated; this.writeData(data); return updated
  }

  async deleteSupportRule(id: string): Promise<void> {
    const data = this.readData(); data.supportRules = data.supportRules.filter((rule) => rule.id !== id); this.writeData(data)
  }

  async createSupportRequest(draft: SupportRequestDraft): Promise<SupportRequest> {
    const data = this.readData(); const now = new Date().toISOString()
    const request: SupportRequest = { id: createId(), requesterUserId: this.userId, ownerUserId: this.userId, contactId: draft.contactId || undefined, publicRequestId: createId(), category: draft.category, requestedAmount: normalizeMoney(draft.requestedAmount, false), requestedProduct: draft.requestedProduct, phone: draft.phone || undefined, network: draft.network || undefined, country: 'NG', message: draft.message || undefined, status: 'pending', expiresAt: draft.expiresAt || undefined, createdAt: now, updatedAt: now }
    data.supportRequests.unshift(request); this.writeData(data); return request
  }

  async updateSupportRequest(id: string, draft: SupportRequestDraft, status: SupportRequestStatus): Promise<SupportRequest> {
    const data = this.readData(); const index = data.supportRequests.findIndex((request) => request.id === id)
    if (index < 0) throw new Error('Support request was not found.')
    const current = data.supportRequests[index]
    if (!canTransitionSupportRequest(current.status, status)) throw new Error(`A ${current.status} request cannot become ${status}.`)
    const updated = { ...current, ...draft, contactId: draft.contactId || undefined, requestedAmount: normalizeMoney(draft.requestedAmount, false), phone: draft.phone || undefined, network: draft.network || undefined, message: draft.message || undefined, expiresAt: draft.expiresAt || undefined, status, updatedAt: new Date().toISOString() }
    data.supportRequests[index] = updated; this.writeData(data); return updated
  }

  async cancelSupportRequest(id: string): Promise<SupportRequest> {
    const request = this.readData().supportRequests.find((item) => item.id === id)
    if (!request) throw new Error('Support request was not found.')
    return this.updateSupportRequest(id, requestToDraft(request), 'cancelled')
  }

  async convertRequestToDraft(id: string): Promise<SupportDraft> {
    const data = this.readData(); const request = data.supportRequests.find((item) => item.id === id)
    if (!request || request.status !== 'approved') throw new Error('Only approved requests can become drafts.')
    const contact = data.contacts.find((item) => item.id === request.contactId)
    const now = new Date().toISOString()
    const draft: SupportDraft = { id: createId(), userId: this.userId, source: 'request', contactId: request.contactId, requestId: request.id, category: request.category, recipientName: contact?.displayName ?? 'Requested support', recipientPhone: request.phone ?? contact?.phone ?? '', recipientNetwork: request.network ?? contact?.network, recipientCountry: 'NG', amount: request.requestedAmount, unit: 'NGN', productDetails: request.requestedProduct, status: 'draft', createdAt: now, updatedAt: now }
    data.supportDrafts.unshift(draft); data.supportRequests[data.supportRequests.indexOf(request)] = { ...request, status: 'prepared', updatedAt: now }; this.writeData(data); return draft
  }

  async createSupportDraft(input: SupportDraftInput): Promise<SupportDraft> {
    const data = this.readData(); const now = new Date().toISOString()
    const draft: SupportDraft = { id: createId(), userId: this.userId, ...input, contactId: input.contactId || undefined, requestId: input.requestId || undefined, recipientNetwork: input.recipientNetwork || undefined, amount: normalizeMoney(input.amount, false), recipientCountry: 'NG', status: 'draft', createdAt: now, updatedAt: now }
    data.supportDrafts.unshift(draft); this.writeData(data); return draft
  }

  async updateSupportDraft(id: string, input: SupportDraftInput): Promise<SupportDraft> {
    const data = this.readData(); const index = data.supportDrafts.findIndex((draft) => draft.id === id)
    if (index < 0) throw new Error('Support draft was not found.')
    const updated = { ...data.supportDrafts[index], ...input, contactId: input.contactId || undefined, requestId: input.requestId || undefined, recipientNetwork: input.recipientNetwork || undefined, amount: normalizeMoney(input.amount, false), updatedAt: new Date().toISOString() }
    data.supportDrafts[index] = updated; this.writeData(data); return updated
  }

  async getPublicRequest(publicRequestId: string): Promise<PublicSupportRequest | null> {
    const request = this.readData().supportRequests.find((item) => item.publicRequestId === publicRequestId)
    if (!request || (request.status !== 'pending' && request.status !== 'approved')) return null
    return { publicRequestId: request.publicRequestId, requesterLabel: 'A Munus user', category: request.category, requestedAmount: request.requestedAmount, requestedProduct: request.requestedProduct, phone: request.phone ? maskPhone(request.phone) : undefined, network: request.network, country: 'NG', message: request.message, status: request.status, expiresAt: request.expiresAt }
  }

  private readData(): SupportData {
    const raw = this.storage?.getItem(`${SUPPORT_KEY_PREFIX}${this.userId}`)
    if (!raw) return emptySupportData()
    try { const value = JSON.parse(raw) as Partial<SupportData>; return { contacts: Array.isArray(value.contacts) ? value.contacts : [], supportRules: Array.isArray(value.supportRules) ? value.supportRules : [], supportRequests: Array.isArray(value.supportRequests) ? value.supportRequests : [], supportDrafts: Array.isArray(value.supportDrafts) ? value.supportDrafts : [] } } catch { return emptySupportData() }
  }

  private writeData(data: SupportData): void { this.storage?.setItem(`${SUPPORT_KEY_PREFIX}${this.userId}`, JSON.stringify(data)) }
}

function requestToDraft(request: SupportRequest): SupportRequestDraft {
  return { contactId: request.contactId ?? '', category: request.category, requestedAmount: request.requestedAmount, requestedProduct: request.requestedProduct, phone: request.phone ?? '', network: request.network ?? '', country: 'NG', message: request.message ?? '', expiresAt: request.expiresAt ?? '' }
}

function emptySupportData(): SupportData { return { contacts: [], supportRules: [], supportRequests: [], supportDrafts: [] } }
function createId(): string { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); return `${Date.now()}-${Math.random().toString(16).slice(2)}` }
function getStorage(): Storage | null { if (typeof window === 'undefined') return null; try { return window.localStorage } catch { return null } }
