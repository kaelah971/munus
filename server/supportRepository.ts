import { randomBytes, randomUUID } from 'node:crypto'
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
import { withTransaction, type DatabasePool, type DatabaseTransaction } from './database'

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
      country: 'NG',
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

export class PostgresSupportRepository implements SupportRepository {
  constructor(private readonly database: DatabasePool) {}

  async listContacts(userId: string, includeArchived = false): Promise<Contact[]> {
    const result = await this.run('list contacts', () => this.database.query(
      `SELECT * FROM contacts
       WHERE user_id = $1${includeArchived ? '' : ' AND archived_at IS NULL'}
       ORDER BY display_name`,
      [userId],
    ))
    return result.rows.map((row) => mapContact(row))
  }

  async getContact(userId: string, contactId: string): Promise<Contact | null> {
    const result = await this.run('load contact', () => this.database.query(
      `SELECT * FROM contacts WHERE id = $1 AND user_id = $2`,
      [contactId, userId],
    ))
    return result.rows[0] ? mapContact(result.rows[0]) : null
  }

  async createContact(userId: string, draft: ContactDraft): Promise<Contact> {
    const duplicate = await this.run('check contact duplicates', () => this.database.query(
      `SELECT id FROM contacts
       WHERE user_id = $1 AND phone = $2 AND archived_at IS NULL`,
      [userId, draft.phone],
    ))
    if (duplicate.rows.length > 0) throw new SupportRepositoryError('A contact with this phone is already saved.', 409)
    const result = await this.run('create contact', () => this.database.query(
      `INSERT INTO contacts
        (user_id, display_name, relationship, phone, network, country,
         usual_product_type, usual_amount, notes)
       VALUES ($1, $2, $3, $4, $5, 'NG', $6, $7, $8)
       RETURNING *`,
      [userId, draft.displayName, draft.relationship || null, draft.phone, draft.network || null, draft.usualProductType || null, draft.usualAmount || null, draft.notes || null],
    ))
    return mapContact(requireRow(result.rows[0], 'Contact'))
  }

  async updateContact(userId: string, contactId: string, draft: ContactDraft): Promise<Contact | null> {
    const current = await this.getContact(userId, contactId)
    if (!current) return null
    const duplicate = await this.run('check contact duplicates', () => this.database.query(
      `SELECT id FROM contacts
       WHERE user_id = $1 AND phone = $2 AND id <> $3 AND archived_at IS NULL`,
      [userId, draft.phone, contactId],
    ))
    if (duplicate.rows.length > 0) throw new SupportRepositoryError('A contact with this phone is already saved.', 409)
    const result = await this.run('update contact', () => this.database.query(
      `UPDATE contacts
       SET display_name = $3, relationship = $4, phone = $5, network = $6,
           usual_product_type = $7, usual_amount = $8, notes = $9, updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [contactId, userId, draft.displayName, draft.relationship || null, draft.phone, draft.network || null, draft.usualProductType || null, draft.usualAmount || null, draft.notes || null],
    ))
    return result.rows[0] ? mapContact(result.rows[0]) : null
  }

  async archiveContact(userId: string, contactId: string): Promise<Contact | null> {
    const result = await this.run('archive contact', () => this.database.query(
      `UPDATE contacts
       SET archived_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [contactId, userId],
    ))
    return result.rows[0] ? mapContact(result.rows[0]) : null
  }

  async listSupportRules(userId: string): Promise<SupportRule[]> {
    const result = await this.run('list support rules', () => this.database.query(
      `SELECT * FROM support_rules WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId],
    ))
    return result.rows.map((row) => mapSupportRule(row))
  }

  async getSupportRule(userId: string, ruleId: string): Promise<SupportRule | null> {
    const result = await this.run('load support rule', () => this.database.query(
      `SELECT * FROM support_rules WHERE id = $1 AND user_id = $2`,
      [ruleId, userId],
    ))
    return result.rows[0] ? mapSupportRule(result.rows[0]) : null
  }

  async createSupportRule(userId: string, draft: SupportRuleDraft): Promise<SupportRule> {
    await this.assertContact(userId, draft.contactId)
    const result = await this.run('create support rule', () => this.database.query(
      `INSERT INTO support_rules
        (user_id, contact_id, category, period, soft_limit_amount, unit, warning_threshold, enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [userId, draft.contactId || null, draft.category, draft.period, draft.softLimitAmount, draft.unit, draft.warningThreshold, draft.enabled],
    ))
    return mapSupportRule(requireRow(result.rows[0], 'Support rule'))
  }

  async updateSupportRule(userId: string, ruleId: string, draft: SupportRuleDraft): Promise<SupportRule | null> {
    await this.assertContact(userId, draft.contactId)
    const result = await this.run('update support rule', () => this.database.query(
      `UPDATE support_rules
       SET contact_id = $3, category = $4, period = $5, soft_limit_amount = $6,
           unit = $7, warning_threshold = $8, enabled = $9, updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [ruleId, userId, draft.contactId || null, draft.category, draft.period, draft.softLimitAmount, draft.unit, draft.warningThreshold, draft.enabled],
    ))
    return result.rows[0] ? mapSupportRule(result.rows[0]) : null
  }

  async deleteSupportRule(userId: string, ruleId: string): Promise<boolean> {
    const result = await this.run('delete support rule', () => this.database.query(
      `DELETE FROM support_rules WHERE id = $1 AND user_id = $2 RETURNING id`,
      [ruleId, userId],
    ))
    return result.rowCount === 1 || result.rows.length === 1
  }

  async listSupportRequests(userId: string): Promise<SupportRequest[]> {
    const result = await this.run('list support requests', () => this.database.query(
      `SELECT * FROM support_requests
       WHERE owner_user_id = $1 OR requester_user_id = $1 OR recipient_user_id = $1
       ORDER BY created_at DESC`,
      [userId],
    ))
    return result.rows.map((row) => mapSupportRequest(row))
  }

  async getSupportRequest(userId: string, requestId: string): Promise<SupportRequest | null> {
    const result = await this.run('load support request', () => this.database.query(
      `SELECT * FROM support_requests
       WHERE id = $1
         AND (owner_user_id = $2 OR requester_user_id = $2 OR recipient_user_id = $2)`,
      [requestId, userId],
    ))
    return result.rows[0] ? mapSupportRequest(result.rows[0]) : null
  }

  async createSupportRequest(userId: string, draft: SupportRequestDraft): Promise<SupportRequest> {
    await this.assertContact(userId, draft.contactId)
    const result = await this.run('create support request', () => this.database.query(
      `INSERT INTO support_requests
        (requester_user_id, owner_user_id, contact_id, public_request_id,
         category, requested_amount, requested_product, phone, network, country,
         message, status, expires_at)
       VALUES ($1, $1, $2, $3, $4, $5, $6, $7, $8, 'NG', $9, 'pending', $10)
       RETURNING *`,
      [userId, draft.contactId || null, randomBytes(18).toString('base64url'), draft.category, draft.requestedAmount, draft.requestedProduct, draft.phone || null, draft.network || null, draft.message || null, draft.expiresAt || null],
    ))
    return mapSupportRequest(requireRow(result.rows[0], 'Support request'))
  }

  async updateSupportRequest(userId: string, requestId: string, draft: SupportRequestDraft, status: SupportRequestStatus): Promise<SupportRequest | null> {
    const current = await this.getSupportRequest(userId, requestId)
    if (!current) return null
    if (!canTransitionSupportRequest(current.status, status)) {
      throw new SupportRepositoryError(`A ${current.status} request cannot become ${status}.`, 409)
    }
    await this.assertContact(userId, draft.contactId)
    const result = await this.run('update support request', () => this.database.query(
      `UPDATE support_requests
       SET contact_id = $3, category = $4, requested_amount = $5,
           requested_product = $6, phone = $7, network = $8, country = 'NG',
           message = $9, status = $10, expires_at = $11, updated_at = NOW()
       WHERE id = $1 AND owner_user_id = $2
       RETURNING *`,
      [requestId, userId, draft.contactId || null, draft.category, draft.requestedAmount, draft.requestedProduct, draft.phone || null, draft.network || null, draft.message || null, status, draft.expiresAt || null],
    ))
    return result.rows[0] ? mapSupportRequest(result.rows[0]) : null
  }

  async createSupportDraft(userId: string, input: SupportDraftInput): Promise<SupportDraft> {
    await this.assertContact(userId, input.contactId)
    return withTransaction(this.database, (client) => this.insertSupportDraft(client, userId, input))
  }

  async listSupportDrafts(userId: string): Promise<SupportDraft[]> {
    const result = await this.run('list support drafts', () => this.database.query(
      `SELECT * FROM support_drafts WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId],
    ))
    return result.rows.map((row) => mapSupportDraft(row))
  }

  async updateSupportDraft(userId: string, draftId: string, input: SupportDraftInput): Promise<SupportDraft | null> {
    await this.assertContact(userId, input.contactId)
    const result = await this.run('update support draft', () => this.database.query(
      `UPDATE support_drafts
       SET source = $3, contact_id = $4, request_id = $5, category = $6,
           recipient_name = $7, recipient_phone = $8, recipient_network = $9,
           recipient_country = 'NG', amount = $10, unit = $11,
           product_details = $12, updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [draftId, userId, input.source, input.contactId || null, input.requestId || null, input.category, input.recipientName, input.recipientPhone, input.recipientNetwork || null, input.amount, input.unit, input.productDetails],
    ))
    return result.rows[0] ? mapSupportDraft(result.rows[0]) : null
  }

  async getPublicSupportRequest(publicRequestId: string): Promise<PublicSupportRequest | null> {
    const result = await this.run('load public support request', () => this.database.query(
      `SELECT r.*, p.display_name AS requester_label
       FROM support_requests AS r
       LEFT JOIN profiles AS p ON p.user_id = r.owner_user_id
       WHERE r.public_request_id = $1`,
      [publicRequestId],
    ))
    const row = result.rows[0]
    if (!row) return null
    const request = mapSupportRequest(row)
    if (request.status !== 'pending' && request.status !== 'approved') return null
    if (request.expiresAt && Date.parse(request.expiresAt) <= Date.now()) return null
    return {
      publicRequestId: request.publicRequestId,
      requesterLabel: row.requester_label ? String(row.requester_label) : 'A Munus user',
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
    return this.run('convert support request', () => withTransaction(this.database, async (client) => {
      const requestResult = await client.query(
        `SELECT * FROM support_requests
         WHERE id = $1
           AND (owner_user_id = $2 OR requester_user_id = $2 OR recipient_user_id = $2)
         FOR UPDATE`,
        [requestId, userId],
      )
      const requestRow = requestResult.rows[0]
      if (!requestRow) return null
      const request = mapSupportRequest(requestRow)
      if (request.status !== 'approved') throw new SupportRepositoryError('Only approved requests can become drafts.', 409)

      let contact: Contact | null = null
      if (request.contactId) {
        const contactResult = await client.query(
          `SELECT * FROM contacts WHERE id = $1 AND user_id = $2`,
          [request.contactId, userId],
        )
        contact = contactResult.rows[0] ? mapContact(contactResult.rows[0]) : null
      }
      const recipientPhone = request.phone ?? contact?.phone ?? ''
      if (!recipientPhone) throw new SupportRepositoryError('An approved request needs a phone number before it can become a draft.')
      const draft = await this.insertSupportDraft(client, userId, {
        source: 'request',
        contactId: request.contactId ?? '',
        requestId,
        category: request.category,
        recipientName: contact?.displayName ?? 'Requested support',
        recipientPhone,
        recipientNetwork: request.network ?? contact?.network ?? '',
        recipientCountry: request.country,
        amount: request.requestedAmount,
        unit: 'NGN',
        productDetails: request.requestedProduct,
      })
      await client.query(
        `UPDATE support_requests
         SET status = 'prepared', updated_at = NOW()
         WHERE id = $1 AND owner_user_id = $2`,
        [requestId, userId],
      )
      return draft
    }))
  }

  private async insertSupportDraft(client: DatabaseTransaction, userId: string, input: SupportDraftInput): Promise<SupportDraft> {
    const result = await client.query(
      `INSERT INTO support_drafts
        (user_id, source, contact_id, request_id, category, recipient_name,
         recipient_phone, recipient_network, recipient_country, amount, unit,
         product_details, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'NG', $9, $10, $11, 'draft')
       RETURNING *`,
      [userId, input.source, input.contactId || null, input.requestId || null, input.category, input.recipientName, input.recipientPhone, input.recipientNetwork || null, input.amount, input.unit, input.productDetails],
    )
    return mapSupportDraft(requireRow(result.rows[0], 'Support draft'))
  }

  private async assertContact(userId: string, contactId: string): Promise<void> {
    if (contactId && !(await this.getContact(userId, contactId))) {
      throw new SupportRepositoryError('Contact was not found.', 404)
    }
  }

  private async run<T>(label: string, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof SupportRepositoryError) throw error
      throw new Error(`Could not ${label}: ${errorMessage(error)}`, { cause: error })
    }
  }
}

function mapContact(row: Record<string, unknown>): Contact {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    displayName: String(row.display_name),
    relationship: row.relationship ? String(row.relationship) : undefined,
    phone: String(row.phone),
    network: row.network as Contact['network'],
    country: 'NG',
    usualProductType: row.usual_product_type as Contact['usualProductType'],
    usualAmount: row.usual_amount ? String(row.usual_amount) : undefined,
    notes: row.notes ? String(row.notes) : undefined,
    archivedAt: row.archived_at ? timestampString(row.archived_at) : undefined,
    createdAt: timestampString(row.created_at),
    updatedAt: timestampString(row.updated_at),
  }
}

function mapSupportRule(row: Record<string, unknown>): SupportRule {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    contactId: row.contact_id ? String(row.contact_id) : undefined,
    category: row.category as SupportRule['category'],
    period: row.period as SupportRule['period'],
    softLimitAmount: String(row.soft_limit_amount),
    unit: row.unit as SupportRule['unit'],
    warningThreshold: Number(row.warning_threshold),
    enabled: Boolean(row.enabled),
    createdAt: timestampString(row.created_at),
    updatedAt: timestampString(row.updated_at),
  }
}

function mapSupportRequest(row: Record<string, unknown>): SupportRequest {
  return {
    id: String(row.id),
    requesterUserId: row.requester_user_id ? String(row.requester_user_id) : undefined,
    recipientUserId: row.recipient_user_id ? String(row.recipient_user_id) : undefined,
    ownerUserId: String(row.owner_user_id),
    contactId: row.contact_id ? String(row.contact_id) : undefined,
    publicRequestId: String(row.public_request_id),
    category: row.category as SupportRequest['category'],
    requestedAmount: String(row.requested_amount),
    requestedProduct: String(row.requested_product),
    phone: row.phone ? String(row.phone) : undefined,
    network: row.network as SupportRequest['network'],
    country: 'NG',
    message: row.message ? String(row.message) : undefined,
    status: row.status as SupportRequest['status'],
    expiresAt: row.expires_at ? timestampString(row.expires_at) : undefined,
    createdAt: timestampString(row.created_at),
    updatedAt: timestampString(row.updated_at),
  }
}

function mapSupportDraft(row: Record<string, unknown>): SupportDraft {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    source: row.source as SupportDraft['source'],
    contactId: row.contact_id ? String(row.contact_id) : undefined,
    requestId: row.request_id ? String(row.request_id) : undefined,
    category: row.category as SupportDraft['category'],
    recipientName: String(row.recipient_name),
    recipientPhone: String(row.recipient_phone),
    recipientNetwork: row.recipient_network as SupportDraft['recipientNetwork'],
    recipientCountry: 'NG',
    amount: String(row.amount),
    unit: row.unit as SupportDraft['unit'],
    productDetails: String(row.product_details),
    status: row.status as SupportDraft['status'],
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
