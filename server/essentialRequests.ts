import { normalizeMoney } from '../src/domain/planning'
import {
  canTransitionEssential,
  ESSENTIAL_CLAIM_TTL_MS,
  isClaimLive,
  ESSENTIAL_REQUEST_TTL_MS,
  isClaimableEssential,
  isEssentialExpired,
  isEssentialTerminal,
  type EssentialRequest,
  type EssentialRequestDraft,
  type EssentialStatus,
} from '../src/domain/essentialRequests'
import type { PaymentOrder } from '../src/domain/orders'
import type { PaymentRepository } from './paymentRepository'
import type { DataBundleCatalogProvider } from './dataCatalog'
import { resolveDataPlanForOrder } from './dataCatalog'
import { toProviderAmount } from './clubKonnect'
import {
  SupportRepositoryError,
  type SupportRepository,
} from './supportRepository'

export interface EssentialStoreDeps {
  support: SupportRepository
  payment: PaymentRepository
  now?: () => number
}

export interface EssentialServiceDeps extends EssentialStoreDeps {
  catalog: DataBundleCatalogProvider | null
}

export async function createEssentialRequest(
  deps: EssentialServiceDeps,
  userId: string,
  draft: EssentialRequestDraft,
): Promise<EssentialRequest> {
  const now = deps.now?.() ?? Date.now()
  const expiresAt = new Date(now + ESSENTIAL_REQUEST_TTL_MS).toISOString()
  if (!draft.network) {
    throw new SupportRepositoryError('Recipient network is required.', 400)
  }
  if (draft.serviceType === 'AIRTIME') {
    // Reuse provider bounds so only fulfilable amounts become requests.
    toProviderAmount(draft.requestedAmount)
    return deps.support.createEssentialRequest(userId, {
      serviceType: 'AIRTIME',
      network: draft.network,
      recipientPhone: draft.recipientPhone,
      requestedAmount: draft.requestedAmount,
      message: draft.message || undefined,
      expiresAt,
    })
  }
  if (!deps.catalog) {
    throw new SupportRepositoryError('Data bundles are not configured yet.', 503)
  }
  const plan = await resolveDataPlanForOrder(deps.catalog, draft.network, draft.providerPlanId)
  let requestedAmount: string
  try {
    requestedAmount = normalizeMoney(plan.localPriceNgn, false)
  } catch {
    throw new SupportRepositoryError('Bundle price is unreadable. No request was created.', 502)
  }
  return deps.support.createEssentialRequest(userId, {
    serviceType: 'DATA',
    network: draft.network,
    recipientPhone: draft.recipientPhone,
    requestedAmount,
    providerPlanId: plan.providerPlanId,
    planDisplayLabel: plan.displayName,
    planDataAllowance: plan.dataAllowance,
    planValidity: plan.validity,
    message: draft.message || undefined,
    expiresAt,
  })
}

export interface EssentialClaim {
  order: PaymentOrder
  request: EssentialRequest
}

/**
 * Claim a need and mint the payer's canonical order from the pinned
 * snapshot in one step. The payer never sees the full recipient phone:
 * the server copies it into their order. Exactly one claim wins thanks
 * to the conditional update; losers keep an ordinary unlinked draft.
 */
export async function claimEssentialNeed(
  deps: EssentialStoreDeps,
  payerUserId: string,
  publicRequestId: string,
): Promise<EssentialClaim> {
  const now = deps.now?.() ?? Date.now()
  const request = await deps.support.findEssentialRequestByPublicId(publicRequestId)
  if (!request) {
    throw new SupportRepositoryError('This request is unavailable.', 404)
  }
  if (isEssentialTerminal(request.essentialStatus) || isEssentialExpired(request, now)) {
    throw new SupportRepositoryError('This request is no longer open.', 409)
  }
  if (!isClaimableEssential(request, now)) {
    throw new SupportRepositoryError('This need is already being paid.', 409)
  }
  const order = await deps.payment.createOrder(payerUserId, {
    serviceType: request.serviceType,
    paymentAsset: 'NIM',
    recipientPhone: request.recipientPhone,
    recipientNetwork: request.network,
    requestedAmount: request.requestedAmount,
    providerPlanId: request.providerPlanId,
    planDisplayLabel: request.planDisplayLabel,
    planDataAllowance: request.planDataAllowance,
    planValidity: request.planValidity,
    essentialRequestId: request.id,
  })
  const claimed = await deps.support.claimEssentialRequest(
    payerUserId,
    request.id,
    order.id,
    new Date(now).toISOString(),
    new Date(now + ESSENTIAL_CLAIM_TTL_MS).toISOString(),
  )
  if (!claimed) {
    // Lost a race (or the request closed concurrently). The fresh draft
    // stays the payer's own unlinked order; the bidirectional sync guard
    // below will never mistake it for the canonical payment.
    throw new SupportRepositoryError('This need is already being paid.', 409)
  }
  return { order, request: claimed }
}

export async function cancelEssentialRequest(
  deps: EssentialStoreDeps,
  userId: string,
  requestId: string,
): Promise<EssentialRequest> {
  const now = deps.now?.() ?? Date.now()
  let request = await deps.support.getEssentialRequest(userId, requestId)
  if (!request) throw new SupportRepositoryError('Essential request was not found.', 404)
  // Settle first: a just-verified payment blocks cancellation.
  request = await syncEssentialRow(deps, request, now)
  if (request.essentialStatus !== 'OPEN' && request.essentialStatus !== 'PAYMENT_IN_PROGRESS') {
    throw new SupportRepositoryError('This request can no longer be cancelled.', 409)
  }
  if (request.paymentOrderId) {
    const order = await deps.payment.findOrderById(request.paymentOrderId)
    if (order && order.paymentStatus === 'PAID') {
      throw new SupportRepositoryError('This request can no longer be cancelled.', 409)
    }
  }
  const cancelled = await deps.support.cancelEssentialRequest(userId, requestId)
  if (!cancelled) throw new SupportRepositoryError('This request can no longer be cancelled.', 409)
  return cancelled
}

/**
 * Recompute request state from the linked order. Callable by the request
 * owner, the linked-order owner, or settlement hooks. Forward-only,
 * idempotent, and safe to repeat.
 */
export async function syncEssentialRequest(
  deps: EssentialStoreDeps,
  callerUserId: string,
  requestId: string,
): Promise<EssentialRequest> {
  const now = deps.now?.() ?? Date.now()
  const owned = await deps.support.getEssentialRequest(callerUserId, requestId)
  if (owned) return syncEssentialRow(deps, owned, now)
  const payerOrders = await deps.payment.listOrders(callerUserId)
  const linked = payerOrders.find((order) => order.essentialRequestId === requestId)
  if (!linked) throw new SupportRepositoryError('Essential request was not found.', 404)
  const request = await deps.support.findEssentialRequestByOrder(linked.id)
  if (!request) throw new SupportRepositoryError('Essential request was not found.', 404)
  return syncEssentialRow(deps, request, now)
}

/** Settlement-hook entry: sync whatever request an order satisfies. */
export async function syncEssentialForOrder(
  deps: EssentialStoreDeps,
  order: Pick<PaymentOrder, 'id' | 'essentialRequestId'>,
): Promise<EssentialRequest | null> {
  if (!order.essentialRequestId) return null
  const request = await deps.support.findEssentialRequestByOrder(order.id)
  // Bidirectional match only: a race-lost draft pointing at someone else's
  // request must never move it.
  if (!request || request.paymentOrderId !== order.id) return null
  return syncEssentialRow(deps, request, deps.now?.() ?? Date.now())
}

async function syncEssentialRow(
  deps: EssentialStoreDeps,
  request: EssentialRequest,
  now: number,
): Promise<EssentialRequest> {
  if (isEssentialTerminal(request.essentialStatus)) return request
  const order = request.paymentOrderId ? await deps.payment.findOrderById(request.paymentOrderId) : null
  if (!order || order.essentialRequestId !== request.id) return request
  const nowIso = new Date(now).toISOString()
  const target = deriveSyncTarget(request, order, now)
  if (!target) return request
  return advanceEssential(deps, request, target, {
    paidAt: request.paidAt ?? nowIso,
    fulfilledAt: order.fulfilledAt ?? nowIso,
  })
}

function deriveSyncTarget(
  request: EssentialRequest,
  order: PaymentOrder,
  now: number,
): EssentialStatus | null {
  if (order.paymentStatus === 'PAID') {
    if (order.fulfilmentStatus === 'DELIVERED') return 'COMPLETED'
    if (order.fulfilmentStatus === 'FULFILLMENT_FAILED' || order.fulfilmentStatus === 'RECOVERY_REQUIRED') {
      return 'NEEDS_ATTENTION'
    }
    if (order.fulfilmentStatus === 'FULFILLING') return 'FULFILLING'
    return 'PAID'
  }
  // A terminally failed payment frees the need; live or verifying claims
  // keep waiting for the payer.
  if (order.paymentStatus === 'PAYMENT_FAILED') return 'OPEN'
  if (!isClaimLive(request, now) && order.paymentStatus !== 'ONCHAIN_PENDING') return 'OPEN'
  return null
}

/**
 * Walks the transition table one legal step at a time toward the evidenced
 * target, so a first sync that observes a late-stage order still converges
 * without ever jumping illegally. Lost races re-read and retry.
 */
async function advanceEssential(
  deps: EssentialStoreDeps,
  request: EssentialRequest,
  target: EssentialStatus,
  stamps: { paidAt: string; fulfilledAt: string },
): Promise<EssentialRequest> {
  let current = request
  for (let step = 0; step < 6 && current.essentialStatus !== target; step++) {
    const next = nextEssentialStep(current.essentialStatus, target)
    if (!next) return current
    const updated = await deps.support.applyEssentialSync(current.id, {
      expectedStatus: current.essentialStatus,
      essentialStatus: next,
      paidAt: stamps.paidAt,
      fulfilledAt: stamps.fulfilledAt,
      clearClaim: true,
    })
    if (!updated) {
      const reread = await deps.support.findEssentialRequestByPublicId(current.publicRequestId)
      if (!reread) return current
      current = reread
      continue
    }
    current = updated
  }
  return current
}

function nextEssentialStep(current: EssentialStatus, target: EssentialStatus): EssentialStatus | null {
  if (current === target) return null
  if (canTransitionEssential(current, target)) return target
  const chain: EssentialStatus[] = ['OPEN', 'PAYMENT_IN_PROGRESS', 'PAID', 'FULFILLING', 'COMPLETED']
  const from = chain.indexOf(current)
  if (from >= 0 && from < chain.indexOf('PAID')) return chain[from + 1]
  if (current === 'PAID' && target === 'COMPLETED') return 'FULFILLING'
  return null
}