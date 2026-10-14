import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, type Mock } from 'vitest'
import type { DataPlan, PaymentOrder } from '../domain/orders'
import type { PaymentApi } from '../persistence/paymentApi'
import type { NimiqConnectionState } from '../integration/nimiq'
import { requestNimPayment } from '../integration/nimiq'
import { PayPage } from './PayPage'

vi.mock('../integration/nimiq', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../integration/nimiq')>()
  return { ...actual, requestNimPayment: vi.fn() }
})

const mockedRequestNimPayment = requestNimPayment as Mock

function order(overrides: Partial<PaymentOrder> = {}): PaymentOrder {
  return {
    id: 'order-1',
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
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function quotedOrder(overrides: Partial<PaymentOrder> = {}): PaymentOrder {
  return order({
    paymentStatus: 'READY_FOR_PAYMENT',
    quotedCryptoAmount: '0.5',
    quoteLunaAmount: '50000',
    quoteExpiresAt: '2099-01-01T00:00:00.000Z',
    quoteRateNgnPerNim: '2000',
    paymentNetwork: 'mainnet',
    paymentReceiver: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000',
    paymentMemo: 'MNS:abc123def456',
    ...overrides,
  })
}

function apiStub(initial: PaymentOrder[] = []) {
  const orders = [...initial]
  const find = (id: string) => {
    const found = orders.find((entry) => entry.id === id)
    if (!found) throw new Error('Payment order was not found.')
    return found
  }
  const replace = (next: PaymentOrder) => {
    const index = orders.findIndex((entry) => entry.id === next.id)
    if (index >= 0) orders[index] = next
    return next
  }
  const api: PaymentApi & {
    createOrder: Mock
    createQuote: Mock
    createPaymentIntent: Mock
    submitPayment: Mock
    reconcilePayment: Mock
    listDataNetworks: Mock
    listDataPlans: Mock
    createDataOrder: Mock
  } = {
    list: vi.fn().mockImplementation(async () => orders),
    get: vi.fn().mockImplementation(async (id: string) => find(id)),
    createOrder: vi.fn().mockImplementation(async (draft: unknown) => {
      const created = order({ ...(draft as Partial<PaymentOrder>), id: 'order-new' })
      orders.unshift(created)
      return created
    }),
    createQuote: vi.fn().mockImplementation(async (id: string) => replace({ ...find(id), ...quotedFields() })),
    createPaymentIntent: vi.fn().mockImplementation(async (id: string) => {
      const next = replace({ ...find(id), paymentStatus: 'AWAITING_WALLET_APPROVAL' as const })
      return {
        order: next,
        intent: {
          receiver: next.paymentReceiver ?? '',
          lunaAmount: next.quoteLunaAmount ?? '',
          memo: next.paymentMemo ?? '',
          network: 'mainnet' as const,
          quoteExpiresAt: next.quoteExpiresAt ?? '',
        },
      }
    }),
    submitPayment: vi.fn().mockImplementation(async (id: string, transactionHash: string) => replace({
      ...find(id),
      walletTxRef: transactionHash,
      paymentStatus: 'ONCHAIN_PENDING' as const,
    })),
    reconcilePayment: vi.fn().mockImplementation(async (id: string) => find(id)),
    listDataNetworks: vi.fn().mockResolvedValue([{ network: 'MTN', label: 'MTN' }]),
    listDataPlans: vi.fn().mockImplementation(async () => [dataPlan()]),
    createDataOrder: vi.fn().mockImplementation(async (input: unknown) => {
      const created = order({
        ...(input as Partial<PaymentOrder>),
        id: 'order-data-new',
        serviceType: 'DATA',
        requestedAmount: '350',
        providerPlanId: 'MTN-15',
        planDisplayLabel: '1.5GB - 7 days',
        planDataAllowance: '1.5 GB',
        planValidity: '7 days',
      })
      orders.unshift(created)
      return created
    }),
  }
  return api
}

function dataPlan(): DataPlan {
  return {
    providerPlanId: 'MTN-15',
    network: 'MTN',
    displayName: '1.5GB - 7 days',
    dataAllowance: '1.5 GB',
    validity: '7 days',
    localPriceNgn: '350',
    available: true,
    provider: 'clubkonnect',
  }
}

function quotedFields(): Partial<PaymentOrder> {
  return {
    paymentStatus: 'READY_FOR_PAYMENT',
    quotedCryptoAmount: '0.5',
    quoteLunaAmount: '50000',
    quoteExpiresAt: '2099-01-01T00:00:00.000Z',
    quoteRateNgnPerNim: '2000',
    paymentNetwork: 'mainnet',
    paymentReceiver: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000',
    paymentMemo: 'MNS:abc123def456',
  }
}

const offlineConnection: NimiqConnectionState = { accounts: [], status: 'unavailable' }
const readyConnection: NimiqConnectionState = { accounts: [], status: 'ready', provider: {} as never }

describe('Pay essentials order flow', () => {
  it('opens the airtime form, saves a persisted order, and shows a truthful review', async () => {
    const api = apiStub()
    render(<PayPage api={api} connection={offlineConnection} defaultPhone="08099999999" />)

    await waitFor(() => expect(api.list).toHaveBeenCalled())
    expect(screen.getByRole('heading', { name: 'Pay Essentials' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Airtime/ }))
    expect(screen.getByLabelText('Recipient phone')).toHaveValue('08099999999')

    fireEvent.change(screen.getByLabelText('Recipient phone'), { target: { value: '08012345678' } })
    fireEvent.change(screen.getByLabelText('Network'), { target: { value: 'MTN' } })
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '1000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review airtime order' }))

    await waitFor(() => expect(api.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ serviceType: 'AIRTIME', paymentAsset: 'NIM', recipientPhone: '08012345678', requestedAmount: '1000' }),
    ))
    expect(await screen.findByRole('heading', { name: '₦1000 airtime' })).toBeInTheDocument()
    expect(screen.getByText('Order saved · payment quote not created yet.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pay now/i })).not.toBeInTheDocument()
  })

  it('lists saved orders with masked phones and keeps other categories unselectable', async () => {
    render(<PayPage api={apiStub([order()])} connection={offlineConnection} />)

    expect(await screen.findByRole('button', { name: /₦1000 airtime/ })).toBeInTheDocument()
    expect(screen.queryByText('08012345678')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Data/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Electricity/ })).not.toBeInTheDocument()
    expect(screen.getByText(/NIM never goes to the provider/)).toBeInTheDocument()
  })

  it('gets a live quote without ever opening the wallet', async () => {
    const api = apiStub([order()])
    mockedRequestNimPayment.mockReset()
    render(<PayPage api={api} connection={readyConnection} />)

    fireEvent.click(await screen.findByRole('button', { name: /₦1000 airtime/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Get NIM quote' }))

    await waitFor(() => expect(api.createQuote).toHaveBeenCalledWith('order-1'))
    expect(await screen.findByText('0.5 NIM')).toBeInTheDocument()
    expect(screen.getByText('1 NIM ≈ ₦2000')).toBeInTheDocument()
    expect(screen.getByText(/Quote expires in/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pay 0.5 NIM' })).toBeInTheDocument()
    expect(mockedRequestNimPayment).not.toHaveBeenCalled()
  })

  it('pays only from the explicit tap with the exact quoted intent', async () => {
    const api = apiStub([quotedOrder()])
    mockedRequestNimPayment.mockReset()
    mockedRequestNimPayment.mockResolvedValue('ab'.repeat(32))
    render(<PayPage api={api} connection={readyConnection} />)

    fireEvent.click(await screen.findByRole('button', { name: /₦1000 airtime/ }))
    expect(mockedRequestNimPayment).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Pay 0.5 NIM' }))
    await waitFor(() => expect(api.createPaymentIntent).toHaveBeenCalledWith('order-1'))
    expect(mockedRequestNimPayment).toHaveBeenCalledOnce()
    expect(mockedRequestNimPayment).toHaveBeenCalledWith(expect.anything(), {
      receiver: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000',
      lunaAmount: '50000',
      memo: 'MNS:abc123def456',
    })
    await waitFor(() => expect(api.submitPayment).toHaveBeenCalledWith('order-1', 'ab'.repeat(32)))
    expect(await screen.findByText('Submitted · confirming on-chain')).toBeInTheDocument()
  })

  it('pays quoted data orders through the same explicit wallet tap', async () => {
    const api = apiStub([quotedOrder({
      serviceType: 'DATA',
      requestedAmount: '350',
      quotedCryptoAmount: '0.175',
      quoteLunaAmount: '17500',
      providerPlanId: 'MTN-15',
      planDisplayLabel: '1.5GB - 7 days',
    })])
    mockedRequestNimPayment.mockReset()
    mockedRequestNimPayment.mockResolvedValue('ab'.repeat(32))
    render(<PayPage api={api} connection={readyConnection} />)

    fireEvent.click(await screen.findByRole('button', { name: /₦350 data/ }))
    expect(await screen.findByRole('heading', { name: '₦350 data' })).toBeInTheDocument()
    expect(mockedRequestNimPayment).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Pay 0.175 NIM' }))
    await waitFor(() => expect(api.createPaymentIntent).toHaveBeenCalledWith('order-1'))
    expect(mockedRequestNimPayment).toHaveBeenCalledOnce()
    expect(mockedRequestNimPayment).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ lunaAmount: '17500' }))
    await waitFor(() => expect(api.submitPayment).toHaveBeenCalledWith('order-1', 'ab'.repeat(32)))
  })

  it('leaves rejection payable with no submission recorded', async () => {
    const api = apiStub([quotedOrder()])
    mockedRequestNimPayment.mockReset()
    mockedRequestNimPayment.mockRejectedValue(new Error('User cancelled the Nimiq Pay request.'))
    render(<PayPage api={api} connection={readyConnection} />)

    fireEvent.click(await screen.findByRole('button', { name: /₦1000 airtime/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Pay 0.5 NIM' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('User cancelled the Nimiq Pay request.')
    expect(api.submitPayment).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Pay 0.5 NIM' })).toBeInTheDocument()
  })

  it('blocks payment on an expired quote until a fresh one arrives', async () => {
    const api = apiStub([quotedOrder({ quoteExpiresAt: '2020-01-01T00:00:00.000Z' })])
    mockedRequestNimPayment.mockReset()
    render(<PayPage api={api} connection={readyConnection} />)

    fireEvent.click(await screen.findByRole('button', { name: /₦1000 airtime/ }))
    expect(await screen.findByText(/This quote has expired/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Pay .* NIM/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Get fresh quote' })).toBeInTheDocument()
    expect(mockedRequestNimPayment).not.toHaveBeenCalled()
  })

  it('polls a confirming payment once on open without touching the wallet', async () => {
    const api = apiStub([quotedOrder({ paymentStatus: 'ONCHAIN_PENDING', walletTxRef: 'ab'.repeat(32) })])
    mockedRequestNimPayment.mockReset()
    render(<PayPage api={api} connection={readyConnection} />)

    fireEvent.click(await screen.findByRole('button', { name: /₦1000 airtime/ }))
    await waitFor(() => expect(api.reconcilePayment).toHaveBeenCalledWith('order-1'))
    expect(mockedRequestNimPayment).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Refresh payment status' })).toBeInTheDocument()
  })

  it('shows delivery progress and payment-attention states distinctly', async () => {
    const delivered = apiStub([quotedOrder({
      paymentStatus: 'PAID',
      fulfilmentStatus: 'DELIVERED',
      provider: 'clubkonnect',
      providerStatus: 'ORDER_COMPLETED',
      providerStatusCode: '200',
      paymentSender: 'NQ19 8DSN PR0S 2PC0 61Q4 U1HT 5FDP RBNK BXBN',
      paymentBlockNumber: '990',
    })])
    const { unmount } = render(<PayPage api={delivered} connection={offlineConnection} />)
    fireEvent.click(await screen.findByRole('button', { name: /₦1000 airtime/ }))
    expect(await screen.findByText('Paid and delivered.')).toBeInTheDocument()
    expect(screen.getByText('Airtime delivered')).toBeInTheDocument()
    expect(screen.getByText('ClubKonnect')).toBeInTheDocument()
    unmount()

    render(<PayPage api={apiStub([quotedOrder({ paymentStatus: 'PAID', fulfilmentStatus: 'RECOVERY_REQUIRED' })])} connection={offlineConnection} />)
    fireEvent.click(await screen.findByRole('button', { name: /₦1000 airtime/ }))
    expect(await screen.findByText(/delivery needs attention/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Pay .* NIM/ })).not.toBeInTheDocument()
  })

  it('explains a failed payment without collapsing it into delivery', async () => {
    render(<PayPage api={apiStub([quotedOrder({ paymentStatus: 'PAYMENT_FAILED', paymentFailureReason: 'wrong-amount' })])} connection={offlineConnection} />)
    fireEvent.click(await screen.findByRole('button', { name: /₦1000 airtime/ }))
    expect(await screen.findByText(/did not match the quoted amount/)).toBeInTheDocument()
  })

  it('offers data as a real category with live bundles', async () => {
    const api = apiStub()
    render(<PayPage api={api} connection={offlineConnection} />)
    await waitFor(() => expect(api.list).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: /Data/ }))
    expect(await screen.findByRole('heading', { name: 'Buy data' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Network'), { target: { value: 'MTN' } })
    await waitFor(() => expect(api.listDataPlans).toHaveBeenCalledWith('MTN'))
    expect(await screen.findByText('1.5GB - 7 days')).toBeInTheDocument()
    expect(screen.getByText('1.5 GB · 7 days · ₦350')).toBeInTheDocument()
  })

  it('creates a data order from the selected bundle price', async () => {
    const api = apiStub()
    render(<PayPage api={api} connection={offlineConnection} defaultPhone="08099999999" />)
    await waitFor(() => expect(api.list).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: /Data/ }))
    fireEvent.change(screen.getByLabelText('Network'), { target: { value: 'MTN' } })
    fireEvent.click(await screen.findByRole('button', { name: /1\.5GB - 7 days/ }))
    fireEvent.change(screen.getByLabelText('Recipient phone'), { target: { value: '08012345678' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review data order' }))

    await waitFor(() => expect(api.createDataOrder).toHaveBeenCalledWith(
      expect.objectContaining({ providerPlanId: 'MTN-15', recipientPhone: '08012345678', recipientNetwork: 'MTN' }),
    ))
    expect(await screen.findByRole('heading', { name: '₦350 data' })).toBeInTheDocument()
    expect(screen.getByText('1.5GB - 7 days')).toBeInTheDocument()
    expect(screen.getByText('Data allowance')).toBeInTheDocument()
    expect(screen.getByText('Validity')).toBeInTheDocument()
    expect(screen.queryByText('08012345678')).not.toBeInTheDocument()
  })

  it('shows bundle unavailability truthfully without inventing plans', async () => {
    const api = apiStub()
    api.listDataPlans.mockRejectedValue(new Error('Data bundles are temporarily unavailable. No order was created.'))
    render(<PayPage api={api} connection={offlineConnection} />)
    await waitFor(() => expect(api.list).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: /Data/ }))
    fireEvent.change(screen.getByLabelText('Network'), { target: { value: 'MTN' } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Data bundles are temporarily unavailable.')
    expect(screen.queryByRole('button', { name: 'Review data order' })).toBeDisabled()
  })
})
