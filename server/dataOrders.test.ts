// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { DataPlan } from '../src/domain/orders'
import { InMemoryPaymentRepository } from './paymentRepository'
import { parseDataOrderDraft, PaymentValidationError } from './paymentValidation'
import { ClubKonnectError } from './clubKonnect'
import type { DataBundleCatalogProvider } from './dataCatalog'
import { createDataOrder } from './dataOrders'

const plan: DataPlan = {
  providerPlanId: 'MTN-15',
  network: 'MTN',
  displayName: '1.5GB - 7 days',
  dataAllowance: '1.5 GB',
  validity: '7 days',
  localPriceNgn: '350',
  available: true,
  provider: 'clubkonnect',
}

function catalog(plans: DataPlan[] = [plan]): DataBundleCatalogProvider {
  return {
    listNetworks: async () => [{ network: 'MTN', label: 'MTN' }],
    listPlans: async () => plans,
  }
}

describe('data order creation', () => {
  it('parses data drafts without any user-supplied amount', () => {
    expect(parseDataOrderDraft({
      providerPlanId: 'MTN-15',
      recipientPhone: '080 1234 5678',
      recipientNetwork: 'MTN',
    })).toEqual({
      providerPlanId: 'MTN-15',
      recipientPhone: '08012345678',
      recipientNetwork: 'MTN',
      paymentAsset: 'NIM',
    })
    expect(() => parseDataOrderDraft({ recipientPhone: '08012345678', recipientNetwork: 'MTN' }))
      .toThrow(PaymentValidationError)
    expect(() => parseDataOrderDraft({ providerPlanId: 'MTN-15', recipientPhone: '08012345678', recipientNetwork: '' }))
      .toThrow(PaymentValidationError)
    expect(() => parseDataOrderDraft({ providerPlanId: 'MTN-15', recipientPhone: '08012345678', recipientNetwork: 'MTN', paymentAsset: 'USDT' }))
      .toThrow(PaymentValidationError)
  })

  it('snapshots the catalog price so later changes cannot mutate the order', async () => {
    const repository = new InMemoryPaymentRepository()
    const order = await createDataOrder(
      { payment: repository, catalog: catalog() },
      'user-a',
      parseDataOrderDraft({ providerPlanId: 'MTN-15', recipientPhone: '08012345678', recipientNetwork: 'MTN' }),
    )

    expect(order).toMatchObject({
      serviceType: 'DATA',
      paymentAsset: 'NIM',
      requestedAmount: '350',
      providerPlanId: 'MTN-15',
      planDisplayLabel: '1.5GB - 7 days',
      planDataAllowance: '1.5 GB',
      planValidity: '7 days',
      paymentStatus: 'DRAFT',
    })

    const repriced = await createDataOrder(
      { payment: repository, catalog: catalog([{ ...plan, localPriceNgn: '999' }]) },
      'user-a',
      parseDataOrderDraft({ providerPlanId: 'MTN-15', recipientPhone: '08012345678', recipientNetwork: 'MTN' }),
    )
    expect(repriced.requestedAmount).toBe('999')
    expect((await repository.getOrder('user-a', order.id))?.requestedAmount).toBe('350')
  })

  it('fails closed when the plan disappears or the catalog is wrong', async () => {
    const repository = new InMemoryPaymentRepository()
    const service = { payment: repository, catalog: catalog([]) }
    await expect(createDataOrder(
      service,
      'user-a',
      parseDataOrderDraft({ providerPlanId: 'GONE', recipientPhone: '08012345678', recipientNetwork: 'MTN' }),
    )).rejects.toMatchObject({ statusCode: 404 })
    expect(await repository.listOrders('user-a')).toEqual([])

    const failing = {
      payment: repository,
      catalog: {
        listNetworks: async () => [],
        listPlans: async () => { throw new ClubKonnectError('Data bundles are temporarily unavailable. No order was created.', 502) },
      } satisfies DataBundleCatalogProvider,
    }
    await expect(createDataOrder(
      failing,
      'user-a',
      parseDataOrderDraft({ providerPlanId: 'MTN-15', recipientPhone: '08012345678', recipientNetwork: 'MTN' }),
    )).rejects.toMatchObject({ statusCode: 502 })
    expect(await repository.listOrders('user-a')).toEqual([])
  })
})
