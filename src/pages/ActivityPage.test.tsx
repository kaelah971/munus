import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, type Mock } from 'vitest'
import type { PaymentOrder } from '../domain/orders'
import type { PaymentApi } from '../persistence/paymentApi'
import { ActivityPage } from './ActivityPage'

const TX_HASH = 'ab'.repeat(32)

function order(overrides: Partial<PaymentOrder> = {}): PaymentOrder {
  return {
    id: '123e4567-e89b-12d3-a456-426614174000',
    userId: 'user-a',
    serviceType: 'AIRTIME',
    paymentAsset: 'NIM',
    recipientPhone: '08012345678',
    recipientNetwork: 'MTN',
    recipientCountry: 'NG',
    requestedAmount: '1000',
    requestedCurrency: 'NGN',
    paymentStatus: 'DRAFT',
    fulfilmentStatus: 'NOT_STARTED',
    createdAt: '2026-10-14T10:00:00.000Z',
    updatedAt: '2026-10-14T10:00:00.000Z',
    ...overrides,
  }
}

function deliveredOrder(): PaymentOrder {
  return order({
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    paymentStatus: 'PAID',
    fulfilmentStatus: 'DELIVERED',
    quotedCryptoAmount: '0.5',
    quoteLunaAmount: '50000',
    quoteRateNgnPerNim: '2000',
    paymentNetwork: 'mainnet',
    paymentReceiver: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000',
    paymentSender: 'NQ19 8DSN PR0S 2PC0 61Q4 U1HT 5FDP RBNK BXBN',
    paymentBlockNumber: '990',
    paymentVerifiedAt: '2026-10-14T12:05:00.000Z',
    walletTxRef: TX_HASH,
    provider: 'clubkonnect',
    providerRef: 'ord-1',
    providerRequestId: 'req-1',
    providerStatusCode: '200',
    providerStatus: 'ORDER_COMPLETED',
    providerAmountCharged: '1000',
    fulfilmentStartedAt: '2026-10-14T12:05:30.000Z',
    fulfilledAt: '2026-10-14T12:06:00.000Z',
    createdAt: '2026-10-14T11:00:00.000Z',
  })
}

function apiStub(initial: PaymentOrder[] = []): PaymentApi & { list: Mock; get: Mock; reconcileOrder: Mock; retryDelivery: Mock } {
  return {
    list: vi.fn().mockResolvedValue(initial),
    get: vi.fn().mockImplementation(async (id: string) => {
      const found = initial.find((entry) => entry.id === id)
      if (!found) throw new Error('Payment order was not found.')
      return found
    }),
    createOrder: vi.fn(),
    createQuote: vi.fn(),
    createPaymentIntent: vi.fn(),
    submitPayment: vi.fn(),
    reconcilePayment: vi.fn(),
    reconcileOrder: vi.fn(async (id: string) => {
      const found = initial.find((entry) => entry.id === id)
      if (!found) throw new Error('Payment order was not found.')
      return found
    }) as Mock,
    retryDelivery: vi.fn(async (id: string) => {
      const found = initial.find((entry) => entry.id === id)
      if (!found) throw new Error('Payment order was not found.')
      return found
    }) as Mock,
  } as unknown as PaymentApi & { list: Mock; get: Mock; reconcileOrder: Mock; retryDelivery: Mock }
}

function renderPage(api: ReturnType<typeof apiStub>) {
  const onNavigate = vi.fn()
  render(<ActivityPage api={api} onNavigate={onNavigate} />)
  return { onNavigate }
}

describe('Activity and Receipt Vault', () => {
  it('lists newest first with masked phones and consistent status', async () => {
    const older = order({ id: 'aaaaaaaa-0000-0000-0000-000000000002', requestedAmount: '500', createdAt: '2026-10-13T10:00:00.000Z' })
    renderPage(apiStub([older, deliveredOrder()]))

    const rows = await screen.findAllByRole('button', { name: /airtime/ })
    expect(rows).toHaveLength(2)
    // Newest (delivered ₦1000) sorts before the older draft.
    expect(rows[0]).toHaveTextContent('₦1000 airtime')
    expect(rows[1]).toHaveTextContent('₦500 airtime')
    expect(screen.getByText('Delivered')).toBeInTheDocument()
    expect(screen.getByText('Draft')).toBeInTheDocument()
    // Owner-only screen, but full private phones still never render.
    expect(screen.queryByText('08012345678')).not.toBeInTheDocument()
    expect(screen.getAllByText(/080•••5678/)).toHaveLength(2)
  })

  it('filters completed, in-progress, and attention views', async () => {
    const recovery = order({
      id: 'bbbbbbbb-0000-0000-0000-000000000003',
      paymentStatus: 'PAID',
      fulfilmentStatus: 'RECOVERY_REQUIRED',
      walletTxRef: TX_HASH,
      paymentVerifiedAt: '2026-10-14T12:05:00.000Z',
    })
    const failed = order({
      id: 'cccccccc-0000-0000-0000-000000000004',
      paymentStatus: 'PAYMENT_FAILED',
      paymentFailureReason: 'wrong-amount',
    })
    renderPage(apiStub([deliveredOrder(), recovery, failed]))
    await screen.findAllByRole('button', { name: /airtime/ })

    fireEvent.click(screen.getByRole('button', { name: 'Completed' }))
    expect(screen.getAllByRole('button', { name: /airtime/ })).toHaveLength(1)
    expect(screen.getByText('Delivered')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Needs attention' }))
    expect(screen.getAllByRole('button', { name: /airtime/ })).toHaveLength(2)
    // One match is the active filter chip, the other the row status pill.
    expect(screen.getAllByText('Needs attention')).toHaveLength(2)
    expect(screen.getByText('Payment failed')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'In progress' }))
    expect(screen.queryByRole('button', { name: /airtime/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(screen.getAllByRole('button', { name: /airtime/ })).toHaveLength(3)
  })

  it('opens Recovery Center from attention rows instead of a receipt', async () => {
    const stuck = order({
      id: 'dddddddd-0000-0000-0000-000000000005',
      paymentStatus: 'PAID',
      fulfilmentStatus: 'FULFILLMENT_FAILED',
      walletTxRef: TX_HASH,
      paymentVerifiedAt: '2026-10-14T12:05:00.000Z',
      quotedCryptoAmount: '0.5',
      provider: 'clubkonnect',
      providerRequestId: 'req-9',
      providerStatusCode: '400',
      providerStatus: 'ORDER_FAILED',
    })
    const api = apiStub([stuck])
    renderPage(api)
    fireEvent.click(await screen.findByRole('button', { name: /₦1000 airtime/ }))

    expect(await screen.findByText('Recovery Center')).toBeInTheDocument()
    expect(screen.getByText('Airtime delivery failed')).toBeInTheDocument()
    expect(screen.queryByText('08012345678')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh status' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry delivery' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }))
    await waitFor(() => expect(api.reconcileOrder).toHaveBeenCalledWith(stuck.id))
    fireEvent.click(screen.getByRole('button', { name: 'Retry delivery' }))
    await waitFor(() => expect(api.retryDelivery).toHaveBeenCalledWith(stuck.id))
  })

  it('routes back to the receipt once recovery resolves delivery', async () => {
    const stuck = order({
      id: 'eeeeeeee-0000-0000-0000-000000000006',
      paymentStatus: 'PAID',
      fulfilmentStatus: 'RECOVERY_REQUIRED',
      walletTxRef: TX_HASH,
      paymentVerifiedAt: '2026-10-14T12:05:00.000Z',
      quotedCryptoAmount: '0.5',
      quoteLunaAmount: '50000',
      provider: 'clubkonnect',
      providerRequestId: 'req-9',
    })
    const api = apiStub([stuck])
    api.retryDelivery.mockImplementation(async () => ({
      ...stuck,
      fulfilmentStatus: 'DELIVERED',
      fulfilledAt: '2026-10-14T12:09:00.000Z',
    }))
    renderPage(api)
    fireEvent.click(await screen.findByRole('button', { name: /₦1000 airtime/ }))
    expect(await screen.findByText('Recovery Center')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry delivery' }))
    expect(await screen.findByText('Receipt · Delivered')).toBeInTheDocument()
    expect(screen.queryByText('Recovery Center')).not.toBeInTheDocument()
  })

  it('re-reads funding when payment recovery lands PAID', async () => {
    const failed = order({
      id: 'f2f2f2f2-0000-0000-0000-000000000009',
      paymentStatus: 'PAYMENT_FAILED',
      paymentFailureReason: 'wrong-network',
      walletTxRef: TX_HASH,
    })
    const api = apiStub([failed])
    const onPaymentSettled = vi.fn()
    render(<ActivityPage api={api} onNavigate={() => {}} onPaymentSettled={onPaymentSettled} />)
    fireEvent.click(await screen.findByRole('button', { name: /₦1000 airtime/ }))
    vi.mocked(api.reconcilePayment).mockResolvedValue({ ...failed, paymentStatus: 'PAID' as const })
    fireEvent.click(await screen.findByRole('button', { name: 'Verify existing payment' }))
    await waitFor(() => expect(onPaymentSettled).toHaveBeenCalled())
  })

  it('exposes Verify existing payment for a bound wrong-network failure', async () => {
    const failed = order({
      id: 'f0f0f0f0-0000-0000-0000-000000000007',
      paymentStatus: 'PAYMENT_FAILED',
      paymentFailureReason: 'wrong-network',
      walletTxRef: TX_HASH,
      requestedAmount: '50.00000000',
    })
    const api = apiStub([failed])
    renderPage(api)
    // Database scale never leaks into the list, and the row asks for
    // attention instead of showing a dead receipt.
    const row = await screen.findByRole('button', { name: /₦50 airtime/ })
    expect(row).toHaveTextContent('Needs attention')
    expect(screen.queryByText(/50\.00000000/)).not.toBeInTheDocument()
    fireEvent.click(row)
    expect(await screen.findByText('Recovery Center')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Verify existing payment' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pay again/i })).not.toBeInTheDocument()
    // Verifying re-checks the SAME hash through payment reconciliation
    // only — no fulfilment reconcile, and no wallet exists on this path.
    const paid: PaymentOrder = {
      ...failed,
      paymentStatus: 'PAID',
      paymentFailureReason: undefined,
      paymentVerifiedAt: '2026-10-16T12:05:00.000Z',
    }
    vi.mocked(api.reconcilePayment).mockResolvedValue(paid)
    fireEvent.click(screen.getByRole('button', { name: 'Verify existing payment' }))
    await waitFor(() => expect(api.reconcilePayment).toHaveBeenCalledWith(failed.id))
    expect(api.reconcilePayment).toHaveBeenCalledTimes(1)
    expect(api.reconcileOrder).not.toHaveBeenCalled()
    // Projection updates to the live receipt; the obsolete failure is gone.
    expect(await screen.findByText('Order detail')).toBeInTheDocument()
    expect(screen.queryByText('Recovery Center')).not.toBeInTheDocument()
    expect(screen.queryByText(/wrong Nimiq network/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Verify existing payment' })).not.toBeInTheDocument()
  })

  it('offers no payment recovery for affirmative mismatches', async () => {
    const failed = order({
      id: 'f1f1f1f1-0000-0000-0000-000000000008',
      paymentStatus: 'PAYMENT_FAILED',
      paymentFailureReason: 'wrong-amount',
      walletTxRef: TX_HASH,
    })
    renderPage(apiStub([failed]))
    fireEvent.click(await screen.findByRole('button', { name: /₦1000 airtime/ }))
    expect(await screen.findByText('Order detail')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Verify existing payment' })).not.toBeInTheDocument()
  })

  it('opens a completed receipt with sections, timeline, and copy action', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderPage(apiStub([deliveredOrder()]))
    fireEvent.click(await screen.findByRole('button', { name: /₦1000 airtime/ }))

    expect(await screen.findByText('Receipt · Delivered')).toBeInTheDocument()
    expect(screen.getByText('What was purchased')).toBeInTheDocument()
    expect(screen.getByText('How it was paid')).toBeInTheDocument()
    expect(screen.getByText('What happened after')).toBeInTheDocument()
    expect(screen.getByText('Proof timeline')).toBeInTheDocument()
    expect(screen.getByText('MNS-AAAAAAAA')).toBeInTheDocument()
    expect(screen.getByText('ord-1')).toBeInTheDocument()
    expect(screen.getByText(/Airtime delivered/)).toBeInTheDocument()
    expect(screen.queryByText('08012345678')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Copy transaction reference' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(TX_HASH))
    expect(await screen.findByText('Copied ✓')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Back to activity' }))
    expect(await screen.findByRole('heading', { name: 'Activity' })).toBeInTheDocument()
  })

  it('labels incomplete evidence as order detail, never a receipt', async () => {
    const paid = order({
      paymentStatus: 'PAID',
      fulfilmentStatus: 'FULFILLING',
      walletTxRef: TX_HASH,
      paymentVerifiedAt: new Date(Date.now() - 60_000).toISOString(),
      fulfilmentStartedAt: new Date(Date.now() - 60_000).toISOString(),
      provider: 'clubkonnect',
      providerRequestId: 'req-1',
    })
    renderPage(apiStub([paid]))
    fireEvent.click(await screen.findByRole('button', { name: /₦1000 airtime/ }))

    expect(await screen.findByText('Order detail')).toBeInTheDocument()
    expect(screen.queryByText(/Receipt ·/)).not.toBeInTheDocument()
    // Status pill plus in-progress timeline stage share the wording.
    expect(screen.getAllByText('Delivering airtime').length).toBeGreaterThanOrEqual(1)
  })

  it('shows data orders with bundle context and masked phones', async () => {
    const data = order({
      id: 'dddddddd-0000-0000-0000-000000000005',
      serviceType: 'DATA',
      requestedAmount: '350',
      providerPlanId: 'MTN-15',
      planDisplayLabel: '1.5GB - 7 days',
      planDataAllowance: '1.5 GB',
      planValidity: '7 days',
      paymentStatus: 'PAID',
      fulfilmentStatus: 'DELIVERED',
      quotedCryptoAmount: '0.175',
      quoteLunaAmount: '17500',
      paymentVerifiedAt: '2026-10-14T12:05:00.000Z',
      walletTxRef: TX_HASH,
      provider: 'clubkonnect',
      providerRef: 'ord-data-1',
      fulfilledAt: '2026-10-14T12:06:00.000Z',
    })
    renderPage(apiStub([data]))

    const row = await screen.findByRole('button', { name: /₦350 data/ })
    expect(row).toHaveTextContent('1.5 GB · MTN')
    expect(screen.queryByText('08012345678')).not.toBeInTheDocument()

    fireEvent.click(row)
    expect(await screen.findByText('Receipt · Delivered')).toBeInTheDocument()
    expect(screen.getByText('1.5GB - 7 days')).toBeInTheDocument()
    expect(screen.getByText('Data allowance')).toBeInTheDocument()
    expect(screen.getByText('Validity')).toBeInTheDocument()
    expect(screen.getByText(/Data delivered/)).toBeInTheDocument()
  })

  it('lists cash-out orders with masked bank details and full receipt evidence', async () => {
    const cashout = order({
      id: 'aaaaaaaa-0000-0000-0000-000000000009',
      serviceType: 'CASH_OUT',
      paymentAsset: 'USDT',
      recipientPhone: undefined,
      recipientNetwork: undefined,
      requestedAmount: '100',
      requestedCurrency: 'USDT',
      paymentStatus: 'PAID',
      fulfilmentStatus: 'DELIVERED',
      bankCode: 'GTB',
      bankName: 'GTBank',
      bankAccountNumber: '0123456789',
      bankAccountName: 'ADA OKAFOR',
      provider: 'paycrest',
      providerRef: 'pc-1',
      providerStatus: 'settled',
      providerStatusCode: 'settled',
      quotedCryptoAmount: '101.5',
      usdtTotalAmount: '101.5',
      payoutNgnAmount: '152250',
      cashoutFeeUsdt: '1.5',
      cashoutRate: '1500',
      walletTxRef: TX_HASH,
      paymentVerifiedAt: '2026-10-14T12:05:00.000Z',
      fulfilmentStartedAt: '2026-10-14T12:05:30.000Z',
      fulfilledAt: '2026-10-14T12:06:00.000Z',
      createdAt: '2026-10-14T11:00:00.000Z',
    })
    renderPage(apiStub([cashout]))

    const row = await screen.findByRole('button', { name: /101\.5 USDT cash out/ })
    expect(row).toHaveTextContent('GTBank · •••• 6789')
    expect(screen.queryByText('0123456789')).not.toBeInTheDocument()

    fireEvent.click(row)
    expect(await screen.findByText('Receipt · Delivered')).toBeInTheDocument()
    expect(screen.getByText('GTBank')).toBeInTheDocument()
    expect(screen.getByText('ADA OKAFOR')).toBeInTheDocument()
    expect(screen.getByText('101.5 USDT')).toBeInTheDocument()
    expect(screen.getByText('1.5 USDT')).toBeInTheDocument()
    expect(screen.getByText('1 USDT ≈ ₦1500')).toBeInTheDocument()
    expect(screen.getByText('Paycrest')).toBeInTheDocument()
    expect(screen.getByText('pc-1')).toBeInTheDocument()
    expect(screen.getByText(/Payout settled/)).toBeInTheDocument()
    expect(screen.queryByText('0123456789')).not.toBeInTheDocument()
  })

  it('shows a truthful empty state with a pay CTA and handles load failure', async () => {
    const { onNavigate } = renderPage(apiStub([]))
    expect(await screen.findByText('No activity yet')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /airtime/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Pay an essential' }))
    expect(onNavigate).toHaveBeenCalledWith('pay')

    const failingApi = apiStub([])
    failingApi.list.mockRejectedValue(new Error('Offline'))
    renderPage(failingApi)
    expect(await screen.findByRole('alert')).toHaveTextContent('Offline')
  })
})
