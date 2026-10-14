import { normalizeMoney } from '../src/domain/planning'
import type { DataOrderDraft, PaymentOrder } from '../src/domain/orders'
import type { PaymentRepository } from './paymentRepository'
import { ClubKonnectError } from './clubKonnect'
import { resolveDataPlanForOrder, type DataBundleCatalogProvider } from './dataCatalog'

export interface DataOrderService {
  payment: PaymentRepository
  catalog: DataBundleCatalogProvider
}

/**
 * DATA order creation pins the server-resolved catalog bundle onto the
 * order. The client never prices the order: requestedAmount always equals
 * the snapshotted catalog price, so later catalog changes cannot mutate
 * what the user agreed to.
 */
export async function createDataOrder(
  service: DataOrderService,
  userId: string,
  draft: DataOrderDraft,
): Promise<PaymentOrder> {
  const plan = await resolveDataPlanForOrder(service.catalog, draft.recipientNetwork, draft.providerPlanId)
  let requestedAmount: string
  try {
    requestedAmount = normalizeMoney(plan.localPriceNgn, false)
  } catch {
    throw new ClubKonnectError('Bundle price is unreadable. No order was created.', 502)
  }
  return service.payment.createOrder(userId, {
    serviceType: 'DATA',
    paymentAsset: 'NIM',
    recipientPhone: draft.recipientPhone,
    recipientNetwork: draft.recipientNetwork,
    requestedAmount,
    providerPlanId: plan.providerPlanId,
    planDisplayLabel: plan.displayName,
    planDataAllowance: plan.dataAllowance,
    planValidity: plan.validity,
  })
}
