// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { DataPlan } from '../src/domain/orders'
import { InMemoryPaymentRepository } from './paymentRepository'
import { InMemorySupportRepository } from './supportRepository'
import type { DataBundleCatalogProvider } from './dataCatalog'
import {
  cancelEssentialRequest,
  claimEssentialNeed,
  createEssentialRequest,
  syncEssentialForOrder,
  syncEssentialRequest,
} from './essentialRequests'

const PLAN: DataPlan = {
  providerPlanId: 'MTN-15',
  network: 'MTN',
  displayName: '1.5GB - 7 days',
  dataAllowance: '1.5 GB',
  validity: '7 days',
  localPriceNgn: '350',
  available: true,
  provider: 'clubkonnect',
}

const NOW = Date.parse('2026-06-01T00:00:00.000Z')

function setup(catalogPlans: DataPlan[] | null = [PLAN]) {
  const support = new InMemorySupportRepository()
  const payment = new InMemoryPaymentRepository()
  const catalog: DataBundleCatalogProvider | null = catalogPlans === null
    ? null
    : {
      listNetworks: async () => [{ network: 'MTN' as const, label: 'MTN' }],
      listPlans: async () => catalogPlans,
    }
  const deps = { support, payment, catalog, now: () => NOW }
  return { support, payment, deps }
}

function airtimeDraft() {
  return {
    serviceType: 'AIRTIME' as const,
    network: 'MTN' as const,
    recipientPhone: '08012345678',
    requestedAmount: '1000',
    providerPlanId: '',
    message: 'Need airtime for work',
  }
}

function dataDraft() {
  return {
    serviceType: 'DATA' as const,
    network: 'MTN' as const,
    recipientPhone: '08012345678',
    requestedAmount: '',
    providerPlanId: 'MTN-15',
    message: '',
  }
}

describe('essential request service', () => {
  it('creates airtime and data needs with server-resolved snapshots', async () => {
    const { deps } = setup()
    const airtime = await createEssentialRequest(deps, 'user-a', airtimeDraft())
    expect(airtime).toMatchObject({
      serviceType: 'AIRTIME',
      requestedAmount: '1000',
      essentialStatus: 'OPEN',
    })
    expect(airtime.expiresAt).toBe(new Date(NOW + 7 * 24 * 60 * 60 * 1000).toISOString())
    expect(airtime.publicRequestId).toBeTruthy()

    const data = await createEssentialRequest(deps, 'user-a', dataDraft())
    expect(data).toMatchObject({
      serviceType: 'DATA',
      requestedAmount: '350',
      providerPlanId: 'MTN-15',
      planDisplayLabel: '1.5GB - 7 days',
      planDataAllowance: '1.5 GB',
      planValidity: '7 days',
    })
  })

  it('fails closed without a catalog match', async () => {
    const { deps } = setup([])
    await expect(createEssentialRequest(deps, 'user-a', dataDraft())).rejects.toMatchObject({ statusCode: 404 })
    const { deps: noCatalog } = setup(null)
    await expect(createEssentialRequest(noCatalog, 'user-a', dataDraft())).rejects.toMatchObject({ statusCode: 503 })
    // Airtime needs no catalog and stays available.
    await expect(createEssentialRequest(deps, 'user-a', airtimeDraft())).resolves.toMatchObject({ serviceType: 'AIRTIME' })
  })

  it('claims once: the payer owns the order, the second payer is refused', async () => {
    const { deps, payment } = setup()
    const request = await createEssentialRequest(deps, 'user-a', airtimeDraft())

    const first = await claimEssentialNeed(deps, 'user-b', request.publicRequestId)
    expect(first.request).toMatchObject({ essentialStatus: 'PAYMENT_IN_PROGRESS', paymentOrderId: first.order.id })
    expect(first.order).toMatchObject({
      userId: 'user-b',
      serviceType: 'AIRTIME',
      recipientPhone: '08012345678',
      requestedAmount: '1000',
      essentialRequestId: request.id,
    })
    // Requester cannot read the payer's private order through request rows.
    expect(first.request).not.toHaveProperty('walletTxRef')

    await expect(claimEssentialNeed(deps, 'user-c', request.publicRequestId)).rejects.toMatchObject({ statusCode: 409 })
    // Exactly one order exists for the claim.
    expect(payment.orders.size).toBe(1)
  })

  it('releases abandoned claims and blocks cancellation after verified payment', async () => {
    const { deps, payment } = setup()
    const request = await createEssentialRequest(deps, 'user-a', airtimeDraft())
    const { order } = await claimEssentialNeed(deps, 'user-b', request.publicRequestId)

    // Cancel while unpaid: allowed, claim cleared.
    const cancelled = await cancelEssentialRequest(deps, 'user-a', request.id)
    expect(cancelled.essentialStatus).toBe('CANCELLED')

    const reopened = await createEssentialRequest(deps, 'user-a', airtimeDraft())
    const claim = await claimEssentialNeed(deps, 'user-b', reopened.publicRequestId)
    const stored = payment.orders.get(claim.order.id)
    if (!stored) throw new Error('Fixture order was not stored.')
    stored.paymentStatus = 'PAID'
    await expect(cancelEssentialRequest(deps, 'user-a', reopened.id)).rejects.toMatchObject({ statusCode: 409 })
    void order
  })

  it('syncs paid, delivered, and failed orders forward without duplicating', async () => {
    const { deps, payment } = setup()
    const request = await createEssentialRequest(deps, 'user-a', airtimeDraft())
    const { order } = await claimEssentialNeed(deps, 'user-b', request.publicRequestId)
    const stored = payment.orders.get(order.id)
    if (!stored) throw new Error('Fixture order was not stored.')

    stored.paymentStatus = 'PAID'
    expect((await syncEssentialRequest(deps, 'user-b', request.id)).essentialStatus).toBe('PAID')
    stored.fulfilmentStatus = 'FULFILLING'
    expect((await syncEssentialRequest(deps, 'user-a', request.id)).essentialStatus).toBe('FULFILLING')
    stored.fulfilmentStatus = 'DELIVERED'
    stored.fulfilledAt = new Date(NOW).toISOString()
    const completed = await syncEssentialForOrder(deps, stored)
    expect(completed?.essentialStatus).toBe('COMPLETED')
    expect(completed?.fulfilledAt).toBeDefined()
    // Terminal rows never move again.
    expect((await syncEssentialForOrder(deps, stored))?.essentialStatus).toBe('COMPLETED')

    const failed = await createEssentialRequest(deps, 'user-a', airtimeDraft())
    const failedClaim = await claimEssentialNeed(deps, 'user-b', failed.publicRequestId)
    const failedOrder = payment.orders.get(failedClaim.order.id)
    if (!failedOrder) throw new Error('Fixture order was not stored.')
    failedOrder.paymentStatus = 'PAID'
    failedOrder.fulfilmentStatus = 'RECOVERY_REQUIRED'
    expect((await syncEssentialForOrder(deps, failedOrder))?.essentialStatus).toBe('NEEDS_ATTENTION')
  })

  it('releases claims on payment failure and ignores dangling links', async () => {
    const { deps, payment } = setup()
    const request = await createEssentialRequest(deps, 'user-a', airtimeDraft())
    const { order } = await claimEssentialNeed(deps, 'user-b', request.publicRequestId)
    const stored = payment.orders.get(order.id)
    if (!stored) throw new Error('Fixture order was not stored.')
    stored.paymentStatus = 'PAYMENT_FAILED'

    const released = await syncEssentialRequest(deps, 'user-a', request.id)
    expect(released.essentialStatus).toBe('OPEN')

    // A race-lost draft pointing at someone else's request never moves it.
    const stranger = await payment.createOrder('user-c', {
      serviceType: 'AIRTIME',
      paymentAsset: 'NIM',
      recipientPhone: '08000000000',
      requestedAmount: '100',
      essentialRequestId: request.id,
    })
    expect(await syncEssentialForOrder(deps, stranger)).toBeNull()
  })

  it('restricts sync visibility to requester and linked payer', async () => {
    const { deps } = setup()
    const request = await createEssentialRequest(deps, 'user-a', airtimeDraft())
    await expect(syncEssentialRequest(deps, 'user-stranger', request.id)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('moves a need from NEEDS_ATTENTION to COMPLETED on later delivery', async () => {
    const { deps, payment } = setup()
    const request = await createEssentialRequest(deps, 'user-a', airtimeDraft())
    const { order } = await claimEssentialNeed(deps, 'user-b', request.publicRequestId)
    const stored = payment.orders.get(order.id)
    if (!stored) throw new Error('Fixture order was not stored.')
    stored.paymentStatus = 'PAID'
    stored.fulfilmentStatus = 'RECOVERY_REQUIRED'
    expect((await syncEssentialForOrder(deps, stored))?.essentialStatus).toBe('NEEDS_ATTENTION')
    stored.fulfilmentStatus = 'DELIVERED'
    stored.fulfilledAt = new Date(NOW).toISOString()
    const completed = await syncEssentialForOrder(deps, stored)
    expect(completed?.essentialStatus).toBe('COMPLETED')
    expect(completed?.fulfilledAt).toBeDefined()
  })

  it('never fabricates refunds or resolutions', async () => {
    const { deps, payment } = setup()
    const request = await createEssentialRequest(deps, 'user-a', airtimeDraft())
    const { order } = await claimEssentialNeed(deps, 'user-b', request.publicRequestId)
    const stored = payment.orders.get(order.id)
    if (!stored) throw new Error('Fixture order was not stored.')
    for (const fulfilmentStatus of ['NOT_STARTED', 'FULFILLING', 'DELIVERED', 'FULFILLMENT_FAILED', 'RECOVERY_REQUIRED'] as const) {
      stored.paymentStatus = 'PAID'
      stored.fulfilmentStatus = fulfilmentStatus
      const synced = await syncEssentialForOrder(deps, { ...stored })
      expect(['REFUNDED', 'RESOLVED']).not.toContain(synced?.essentialStatus ?? '')
    }
  })
})