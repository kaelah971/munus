import type {
  Contact,
  ContactDraft,
  PublicSupportRequest,
  SupportDraft,
  SupportDraftInput,
  SupportRequest,
  SupportRequestDraft,
  SupportRequestStatus,
  SupportRule,
  SupportRuleDraft,
} from '../domain/support'
import type {
  EssentialRequest,
  EssentialRequestDraft,
  PublicEssentialRequest,
} from '../domain/essentialRequests'
import type { PaymentOrder } from '../domain/orders'

export interface SupportData {
  contacts: Contact[]
  supportRules: SupportRule[]
  supportRequests: SupportRequest[]
  supportDrafts: SupportDraft[]
}

export interface SupportApi {
  load(): Promise<SupportData>
  createContact(draft: ContactDraft): Promise<Contact>
  updateContact(id: string, draft: ContactDraft): Promise<Contact>
  archiveContact(id: string): Promise<Contact>
  createSupportRule(draft: SupportRuleDraft): Promise<SupportRule>
  updateSupportRule(id: string, draft: SupportRuleDraft): Promise<SupportRule>
  deleteSupportRule(id: string): Promise<void>
  createSupportRequest(draft: SupportRequestDraft): Promise<SupportRequest>
  updateSupportRequest(id: string, draft: SupportRequestDraft, status: SupportRequestStatus): Promise<SupportRequest>
  cancelSupportRequest(id: string): Promise<SupportRequest>
  convertRequestToDraft(id: string): Promise<SupportDraft>
  createSupportDraft(input: SupportDraftInput): Promise<SupportDraft>
  updateSupportDraft(id: string, input: SupportDraftInput): Promise<SupportDraft>
  getPublicRequest(publicRequestId: string): Promise<PublicSupportRequest | null>
  listEssentialRequests(): Promise<EssentialRequest[]>
  getEssentialRequest(id: string): Promise<EssentialRequest>
  createEssentialRequest(draft: EssentialRequestDraft): Promise<EssentialRequest>
  cancelEssentialRequest(id: string): Promise<EssentialRequest>
  syncEssentialRequest(id: string): Promise<PublicEssentialRequest>
  claimEssentialRequest(publicRequestId: string): Promise<{ order: PaymentOrder; request: PublicEssentialRequest | null }>
  getPublicEssentialRequest(publicRequestId: string): Promise<PublicEssentialRequest | null>
}

export class RemoteSupportApi implements SupportApi {
  constructor(private readonly baseUrl: string) {}

  async load(): Promise<SupportData> {
    const [contacts, supportRules, supportRequests, supportDrafts] = await Promise.all([
      this.read<{ contacts: Contact[] }>('/contacts'),
      this.read<{ supportRules: SupportRule[] }>('/support-rules'),
      this.read<{ supportRequests: SupportRequest[] }>('/support-requests'),
      this.read<{ supportDrafts: SupportDraft[] }>('/support-drafts'),
    ])
    return {
      contacts: contacts.contacts,
      supportRules: supportRules.supportRules,
      supportRequests: supportRequests.supportRequests,
      supportDrafts: supportDrafts.supportDrafts,
    }
  }

  createContact(draft: ContactDraft): Promise<Contact> { return this.read('/contacts', { method: 'POST', body: JSON.stringify(draft) }) }
  updateContact(id: string, draft: ContactDraft): Promise<Contact> { return this.read(`/contacts/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(draft) }) }
  archiveContact(id: string): Promise<Contact> { return this.read(`/contacts/${encodeURIComponent(id)}`, { method: 'DELETE' }) }
  createSupportRule(draft: SupportRuleDraft): Promise<SupportRule> { return this.read('/support-rules', { method: 'POST', body: JSON.stringify(draft) }) }
  updateSupportRule(id: string, draft: SupportRuleDraft): Promise<SupportRule> { return this.read(`/support-rules/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(draft) }) }

  async deleteSupportRule(id: string): Promise<void> {
    await this.request(`/support-rules/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  createSupportRequest(draft: SupportRequestDraft): Promise<SupportRequest> { return this.read('/support-requests', { method: 'POST', body: JSON.stringify(draft) }) }
  updateSupportRequest(id: string, draft: SupportRequestDraft, status: SupportRequestStatus): Promise<SupportRequest> { return this.read(`/support-requests/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ ...draft, status }) }) }
  cancelSupportRequest(id: string): Promise<SupportRequest> { return this.read(`/support-requests/${encodeURIComponent(id)}`, { method: 'DELETE' }) }
  convertRequestToDraft(id: string): Promise<SupportDraft> { return this.read(`/support-requests/${encodeURIComponent(id)}/convert`, { method: 'POST' }) }
  createSupportDraft(input: SupportDraftInput): Promise<SupportDraft> { return this.read('/support-drafts', { method: 'POST', body: JSON.stringify(input) }) }
  updateSupportDraft(id: string, input: SupportDraftInput): Promise<SupportDraft> { return this.read(`/support-drafts/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) }) }

  async getPublicRequest(publicRequestId: string): Promise<PublicSupportRequest | null> {
    const response = await this.request(`/request/${encodeURIComponent(publicRequestId)}`, {
      headers: { accept: 'application/json' },
    })
    if (response.status === 404) return null
    return (await response.json()) as PublicSupportRequest
  }

  async listEssentialRequests(): Promise<EssentialRequest[]> {
    return (await this.read<{ essentialRequests: EssentialRequest[] }>('/essential-requests')).essentialRequests
  }

  async getEssentialRequest(id: string): Promise<EssentialRequest> {
    return this.read(`/essential-requests/${encodeURIComponent(id)}`)
  }

  async createEssentialRequest(draft: EssentialRequestDraft): Promise<EssentialRequest> {
    return this.read('/essential-requests', { method: 'POST', body: JSON.stringify(draft) })
  }

  async cancelEssentialRequest(id: string): Promise<EssentialRequest> {
    return this.read(`/essential-requests/${encodeURIComponent(id)}/cancel`, { method: 'POST' })
  }

  async syncEssentialRequest(id: string): Promise<PublicEssentialRequest> {
    return this.read(`/essential-requests/${encodeURIComponent(id)}/sync`, { method: 'POST' })
  }

  async claimEssentialRequest(publicRequestId: string): Promise<{ order: PaymentOrder; request: PublicEssentialRequest | null }> {
    return this.read(`/request/${encodeURIComponent(publicRequestId)}/claim`, { method: 'POST' })
  }

  async getPublicEssentialRequest(publicRequestId: string): Promise<PublicEssentialRequest | null> {
    const response = await this.request(`/request/${encodeURIComponent(publicRequestId)}`, {
      headers: { accept: 'application/json' },
    })
    if (response.status === 404) return null
    const body = (await response.json()) as Record<string, unknown>
    if (typeof body.serviceType !== 'string') return null
    return body as unknown as PublicEssentialRequest
  }

  private async read<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.request(path, init)
    return (await response.json()) as T
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
      ...init,
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    })
    if (!response.ok && response.status !== 404) {
      throw new Error((await readErrorBody(response)) ?? `Munus support request failed (${response.status}).`)
    }
    return response
  }
}

async function readErrorBody(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: unknown }
    return typeof body.error === 'string' && body.error ? body.error : null
  } catch {
    return null
  }
}
