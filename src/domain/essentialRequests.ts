import { maskPhone, type SupportNetwork } from './support'

export type EssentialServiceType = 'AIRTIME' | 'DATA'

export type EssentialStatus =
  | 'OPEN'
  | 'PAYMENT_IN_PROGRESS'
  | 'PAID'
  | 'FULFILLING'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'NEEDS_ATTENTION'

/** Short-lived payer claim so an abandoned checkout frees the request. */
export const ESSENTIAL_CLAIM_TTL_MS = 15 * 60 * 1000
/** Requests stay payable for a week, then close without deleting history. */
export const ESSENTIAL_REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface EssentialRequest {
  id: string
  ownerUserId: string
  publicRequestId: string
  serviceType: EssentialServiceType
  network?: SupportNetwork
  requestedAmount: string
  providerPlanId?: string
  planDisplayLabel?: string
  planDataAllowance?: string
  planValidity?: string
  recipientPhone: string
  message?: string
  essentialStatus: EssentialStatus
  paymentOrderId?: string
  claimedByUserId?: string
  claimExpiresAt?: string
  paidAt?: string
  fulfilledAt?: string
  expiresAt: string
  createdAt: string
  updatedAt: string
}

export interface EssentialRequestDraft {
  serviceType: EssentialServiceType
  network: SupportNetwork | ''
  recipientPhone: string
  requestedAmount: string
  providerPlanId: string
  message: string
}

export interface PublicEssentialRequest {
  publicRequestId: string
  requesterLabel: string
  serviceType: EssentialServiceType
  network?: SupportNetwork
  requestedAmount: string
  planDisplayLabel?: string
  planDataAllowance?: string
  planValidity?: string
  recipientMasked: string
  message?: string
  essentialStatus: EssentialStatus
  paidAt?: string
  fulfilledAt?: string
  expiresAt: string
  createdAt: string
}

export function canTransitionEssential(
  current: EssentialStatus,
  next: EssentialStatus,
): boolean {
  if (current === next) return true
  // OPEN adopts an already-paid linked order (release raced verification).
  // The link stays single-writer: only the linked order can advance it.
  if (current === 'OPEN') return next === 'PAYMENT_IN_PROGRESS' || next === 'PAID' || next === 'CANCELLED' || next === 'EXPIRED'
  if (current === 'PAYMENT_IN_PROGRESS') {
    return next === 'PAID' || next === 'OPEN' || next === 'CANCELLED' || next === 'EXPIRED'
  }
  if (current === 'PAID') return next === 'FULFILLING' || next === 'NEEDS_ATTENTION'
  if (current === 'FULFILLING') return next === 'COMPLETED' || next === 'NEEDS_ATTENTION'
  if (current === 'NEEDS_ATTENTION') return next === 'FULFILLING' || next === 'COMPLETED'
  return false
}

export function isEssentialTerminal(status: EssentialStatus): boolean {
  return status === 'COMPLETED' || status === 'CANCELLED' || status === 'EXPIRED'
}

/**
 * Whether a payer may claim right now: OPEN and unexpired, or a stale
 * claim that lapsed without payment. A live claim blocks second payers.
 */
export function isClaimableEssential(
  request: Pick<EssentialRequest, 'essentialStatus' | 'expiresAt' | 'paymentOrderId' | 'claimExpiresAt'>,
  nowMs = Date.now(),
): boolean {
  if (!Number.isFinite(nowMs)) return false
  if (isEssentialExpired(request, nowMs)) return false
  if (request.essentialStatus === 'OPEN') return true
  return request.essentialStatus === 'PAYMENT_IN_PROGRESS' && !isClaimLive(request, nowMs)
}

export function isClaimLive(
  request: Pick<EssentialRequest, 'paymentOrderId' | 'claimExpiresAt'>,
  nowMs = Date.now(),
): boolean {
  return Boolean(request.paymentOrderId && request.claimExpiresAt && Date.parse(request.claimExpiresAt) > nowMs)
}

export function isEssentialExpired(
  request: Pick<EssentialRequest, 'expiresAt'>,
  nowMs = Date.now(),
): boolean {
  return Date.parse(request.expiresAt) <= nowMs
}

/**
 * Display status never mutates the row: an OPEN request past its expiry
 * reads as EXPIRED everywhere without a sweep or write.
 */
export function displayEssentialStatus(
  request: Pick<EssentialRequest, 'essentialStatus' | 'expiresAt' | 'paymentOrderId' | 'claimExpiresAt'>,
  nowMs = Date.now(),
): EssentialStatus {
  if (request.essentialStatus === 'OPEN' && isEssentialExpired(request, nowMs)) return 'EXPIRED'
  if (
    request.essentialStatus === 'PAYMENT_IN_PROGRESS' &&
    !isClaimLive(request, nowMs) &&
    isEssentialExpired(request, nowMs)
  ) {
    return 'EXPIRED'
  }
  return request.essentialStatus
}

const ESSENTIAL_STATUS_COPY: Record<EssentialStatus, { label: string; tone: 'quiet' | 'ready' | 'attention' }> = {
  OPEN: { label: 'Open', tone: 'ready' },
  PAYMENT_IN_PROGRESS: { label: 'Being paid', tone: 'attention' },
  PAID: { label: 'Paid', tone: 'ready' },
  FULFILLING: { label: 'Delivering', tone: 'attention' },
  COMPLETED: { label: 'Completed', tone: 'ready' },
  CANCELLED: { label: 'Cancelled', tone: 'quiet' },
  EXPIRED: { label: 'Expired', tone: 'quiet' },
  NEEDS_ATTENTION: { label: 'Needs attention', tone: 'attention' },
}

export function describeEssentialStatusCopy(status: EssentialStatus): { label: string; tone: 'quiet' | 'ready' | 'attention' } {
  return ESSENTIAL_STATUS_COPY[status]
}

/** Human need summary reused in rows, receipts, and share text. */
export function describeEssentialNeed(request: Pick<PublicEssentialRequest,
  | 'serviceType'
  | 'network'
  | 'requestedAmount'
  | 'planDisplayLabel'
  | 'planDataAllowance'
  | 'planValidity'
>): string {
  if (request.serviceType === 'DATA') {
    const bundle = request.planDataAllowance ?? request.planDisplayLabel ?? 'Data bundle'
    const validity = request.planValidity ? ` · ${request.planValidity}` : ''
    const network = request.network ? ` ${request.network}` : ''
    return `${bundle}${network} data (₦${request.requestedAmount}${validity})`
  }
  const network = request.network ? ` ${request.network}` : ''
  return `₦${request.requestedAmount}${network} airtime`
}

/**
 * Share copy carries the need and the link only — never the full phone,
 * wallet, requester identity, or internal ids.
 */
export function buildEssentialShareText(input: {
  needSummary: string
  linkUrl: string
}): string {
  return `I need ${input.needSummary}.\n\nYou can pay the need directly with NIM through Munus.\n${input.linkUrl}`
}

export function toPublicEssentialRequest(
  request: EssentialRequest,
  requesterLabel: string,
  nowMs = Date.now(),
): PublicEssentialRequest {
  return {
    publicRequestId: request.publicRequestId,
    requesterLabel,
    serviceType: request.serviceType,
    network: request.network,
    requestedAmount: request.requestedAmount,
    planDisplayLabel: request.planDisplayLabel,
    planDataAllowance: request.planDataAllowance,
    planValidity: request.planValidity,
    recipientMasked: maskPhone(request.recipientPhone),
    message: request.message,
    essentialStatus: displayEssentialStatus(request, nowMs),
    paidAt: request.paidAt,
    fulfilledAt: request.fulfilledAt,
    expiresAt: request.expiresAt,
    createdAt: request.createdAt,
  }
}
