import type { DataNetwork, DataPlan } from '../src/domain/orders'
import { SUPPORT_NETWORKS, type SupportNetwork } from '../src/domain/support'
import {
  CLUBKONNECT_BASE_URL,
  clubKonnectNetworkCode,
  ClubKonnectError,
  type ClubKonnectFetchJson,
} from './clubKonnect'

/**
 * Live provider endpoints below are ASSUMPTIONS drawn from publicly
 * surfaced Nellobyte/ClubKonnect-compatible documentation concepts
 * (APIDatabundleNetworkV2 / APIDatabundlePlansV2 / APIDatabundleV1 with
 * UserID + APIKey GET params). They are isolated behind this module's
 * injectable fetch boundary and must be confirmed against the
 * authenticated ClubKonnect docs before any live purchase. Fixtures define
 * behavior until then; no live funds move in tests.
 */
export const CLUBKONNECT_DATA_NETWORKS_PATH = '/APIDatabundleNetworkV2.asp'
export const CLUBKONNECT_DATA_PLANS_PATH = '/APIDatabundlePlansV2.asp'
export const CLUBKONNECT_DATA_PURCHASE_PATH = '/APIDatabundleV1.asp'

/** Short server-side catalog cache: plans/prices are provider-controlled. */
export const DATA_CATALOG_TTL_MS = 3 * 60 * 1000

export interface DataBundleCatalogProvider {
  listNetworks(): Promise<DataNetwork[]>
  listPlans(network: SupportNetwork, options?: { refresh?: boolean }): Promise<DataPlan[]>
}

export interface DataCatalogOptions {
  credentials: { userId: string; apiKey: string }
  baseUrl?: string
  fetchJson?: ClubKonnectFetchJson
  now?: () => number
}

interface CacheEntry<T> {
  at: number
  value: T
}

export class ClubKonnectDataCatalog implements DataBundleCatalogProvider {
  private readonly userId: string
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly fetchJson: ClubKonnectFetchJson
  private readonly now: () => number
  private networksCache: CacheEntry<DataNetwork[]> | null = null
  private readonly plansCache = new Map<string, CacheEntry<DataPlan[]>>()

  constructor(options: DataCatalogOptions) {
    if (!options.credentials.userId || !options.credentials.apiKey) {
      throw new ClubKonnectError('Data catalog credentials are not configured.', 503)
    }
    this.userId = options.credentials.userId
    this.apiKey = options.credentials.apiKey
    this.baseUrl = (options.baseUrl ?? CLUBKONNECT_BASE_URL).replace(/\/$/, '')
    this.fetchJson = options.fetchJson ?? defaultFetchJson
    this.now = options.now ?? Date.now
  }

  async listNetworks(): Promise<DataNetwork[]> {
    const cached = this.networksCache
    if (cached && this.now() - cached.at < DATA_CATALOG_TTL_MS) return cached.value
    const body = await this.requestJson(
      `${this.baseUrl}${CLUBKONNECT_DATA_NETWORKS_PATH}`,
      { UserID: this.userId, APIKey: this.apiKey },
    )
    const networks = normalizeNetworks(extractArray(body, ['networks', 'data', 'result']))
    this.networksCache = { at: this.now(), value: networks }
    return networks
  }

  async listPlans(network: SupportNetwork, options?: { refresh?: boolean }): Promise<DataPlan[]> {
    if (!options?.refresh) {
      const cached = this.plansCache.get(network)
      if (cached && this.now() - cached.at < DATA_CATALOG_TTL_MS) return cached.value
    }
    const body = await this.requestJson(
      `${this.baseUrl}${CLUBKONNECT_DATA_PLANS_PATH}`,
      { UserID: this.userId, APIKey: this.apiKey, MobileNetwork: clubKonnectNetworkCode(network) },
    )
    const plans = normalizePlans(network, extractArray(body, ['plans', 'data', 'result', 'bundles', 'items']))
    this.plansCache.set(network, { at: this.now(), value: plans })
    return plans
  }

  private async requestJson(url: string, params: Record<string, string>): Promise<unknown> {
    const target = new URL(url)
    for (const [key, value] of Object.entries(params)) target.searchParams.append(key, value)
    try {
      return await this.fetchJson(target.toString())
    } catch {
      // Never surface raw URLs (they carry credentials as GET params).
      throw new ClubKonnectError('Data bundles are temporarily unavailable. No order was created.')
    }
  }
}

/**
 * Resolves the exact bundle for an order, refreshing once if the cached
 * catalog no longer carries it. A plan that stays missing fails closed so
 * the user refreshes and chooses again — never a silent substitution.
 */
export async function resolveDataPlanForOrder(
  catalog: DataBundleCatalogProvider,
  network: SupportNetwork,
  providerPlanId: string,
): Promise<DataPlan> {
  const match = (await catalog.listPlans(network)).find(
    (plan) => plan.available && plan.providerPlanId === providerPlanId,
  )
  if (match) return match
  const refreshed = (await catalog.listPlans(network, { refresh: true })).find(
    (plan) => plan.available && plan.providerPlanId === providerPlanId,
  )
  if (!refreshed) {
    throw new ClubKonnectError('That data bundle is no longer available. Refresh the catalog and choose again.', 404)
  }
  return refreshed
}

export function normalizeNetworks(entries: unknown[]): DataNetwork[] {
  const networks: DataNetwork[] = []
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    const network = toSupportNetwork(
      fieldString(record, ['network', 'networkname', 'name']),
      fieldString(record, ['code', 'networkcode', 'id']),
    )
    if (!network) continue
    if (networks.some((item) => item.network === network)) continue
    networks.push({
      network,
      label: fieldString(record, ['label', 'displayname', 'network', 'networkname', 'name']) ?? network,
    })
  }
  return networks
}

export function normalizePlans(network: SupportNetwork, entries: unknown[]): DataPlan[] {
  const plans: DataPlan[] = []
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    const providerPlanId = fieldString(record, ['planid', 'planID', 'id', 'dataplan', 'plan'])
    const displayName = fieldString(record, ['name', 'label', 'planname', 'description'])
    const price = fieldPrice(record, ['price', 'amount', 'planprice', 'pricengn'])
    // Fail closed per plan: without an exact id, an original label, and a
    // parseable price there is nothing truthful to sell.
    if (!providerPlanId || !displayName || !price) continue
    const available = fieldAvailability(record)
    if (!available) continue
    plans.push({
      providerPlanId,
      network,
      displayName,
      dataAllowance: fieldString(record, ['allowance', 'size', 'dataallowance', 'volume', 'data'])
        ?? allowanceFromLabel(displayName),
      validity: fieldString(record, ['validity', 'duration', 'validityperiod'])
        ?? validityFromLabel(displayName),
      planType: fieldString(record, ['type', 'plantype', 'category']),
      localPriceNgn: price,
      available: true,
      provider: 'clubkonnect',
    })
  }
  return plans
}

function toSupportNetwork(name: string | undefined, code: string | undefined): SupportNetwork | null {
  const normalizedCode = (code ?? '').replace(/\D/g, '')
  if (normalizedCode === '01') return 'MTN'
  if (normalizedCode === '02') return 'Glo'
  if (normalizedCode === '03') return '9mobile'
  if (normalizedCode === '04') return 'Airtel'
  const normalizedName = (name ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (normalizedName === 'MTN') return 'MTN'
  if (normalizedName === 'GLO') return 'Glo'
  if (normalizedName === 'AIRTEL') return 'Airtel'
  // 9mobile now trades as T2; accept both names for the same Munus network.
  if (normalizedName === '9MOBILE' || normalizedName === 'T2' || normalizedName === 'T2MOBILE' || normalizedName === 'ETISALAT') {
    return '9mobile'
  }
  return null
}

function allowanceFromLabel(label: string): string | undefined {
  const match = /(\d+(?:\.\d+)?)\s?(GB|MB|TB|G|M)\b/i.exec(label)
  if (!match) return undefined
  const unit = match[2].toUpperCase()
  const normalizedUnit = unit === 'G' ? 'GB' : unit === 'M' ? 'MB' : unit
  return `${match[1]} ${normalizedUnit}`
}

function validityFromLabel(label: string): string | undefined {
  const match = /(\d+)\s?(hours?|hrs?|days?|weeks?|months?)\b/i.exec(label)
  if (!match) return undefined
  const amount = Number(match[1])
  let unit = match[2].toLowerCase()
  if (unit.startsWith('hr')) unit = 'hour'
  else unit = unit.replace(/s$/, '')
  return `${amount} ${unit}${amount === 1 ? '' : 's'}`
}

function fieldString(record: Record<string, unknown>, names: string[]): string | undefined {
  const lower = new Map(Object.entries(record).map(([key, value]) => [key.toLowerCase(), value]))
  for (const name of names) {
    const value = lower.get(name.toLowerCase())
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return undefined
}

function fieldPrice(record: Record<string, unknown>, names: string[]): string | undefined {
  const lower = new Map(Object.entries(record).map(([key, value]) => [key.toLowerCase(), value]))
  for (const name of names) {
    const value = lower.get(name.toLowerCase())
    if (typeof value === 'number') {
      if (Number.isFinite(value) && value > 0) return String(value)
      return undefined
    }
    if (typeof value === 'string') {
      const text = value.replace(/[₦,\s]/g, '')
      if (/^\d+(\.\d{1,2})?$/.test(text) && Number(text) > 0) return text.replace(/^0+(?=\d)/, '')
    }
  }
  return undefined
}

function fieldAvailability(record: Record<string, unknown>): boolean {
  const lower = new Map(Object.entries(record).map(([key, value]) => [key.toLowerCase(), value]))
  for (const name of ['available', 'active', 'enabled', 'status']) {
    const value = lower.get(name)
    if (value === undefined) continue
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return value !== 0
    if (typeof value === 'string') {
      const text = value.trim().toLowerCase()
      if (['active', 'available', 'enabled', 'true', '1', 'yes'].includes(text)) return true
      if (['inactive', 'unavailable', 'disabled', 'false', '0', 'no', 'soldout', 'sold out'].includes(text)) return false
    }
  }
  return true
}

function extractArray(body: unknown, keys: string[]): unknown[] {
  if (Array.isArray(body)) return body
  if (!body || typeof body !== 'object') {
    throw new ClubKonnectError('Data bundles are temporarily unavailable. No order was created.')
  }
  const lower = new Map(Object.entries(body).map(([key, value]) => [key.toLowerCase(), value]))
  for (const key of keys) {
    const value = lower.get(key.toLowerCase())
    if (Array.isArray(value)) return value
  }
  throw new ClubKonnectError('Data bundles are temporarily unavailable. No order was created.')
}

export function assertSupportedNetwork(value: unknown): SupportNetwork {
  if (typeof value === 'string' && (SUPPORT_NETWORKS as readonly string[]).includes(value)) {
    return value as SupportNetwork
  }
  throw new ClubKonnectError('Mobile network is not supported for data bundles.', 400)
}

async function defaultFetchJson(url: string): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url)
  } catch {
    throw new ClubKonnectError('Data bundles are temporarily unavailable. No order was created.')
  }
  if (!response.ok) throw new ClubKonnectError('Data bundles are temporarily unavailable. No order was created.')
  try {
    return (await response.json()) as unknown
  } catch {
    throw new ClubKonnectError('Data bundles are temporarily unavailable. No order was created.')
  }
}
