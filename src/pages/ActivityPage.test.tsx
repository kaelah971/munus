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

function apiStub(initial: PaymentOrder[] = []): PaymentApi & { list: Mock; get: Mock } {
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
  } as unknown as PaymentApi & { list: Mock; get: Mock }
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
      paymentVerifiedAt: '2026-10-14T12:05:00.000Z',
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
