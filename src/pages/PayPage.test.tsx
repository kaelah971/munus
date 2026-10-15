import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, type Mock } from 'vitest'
import type { DataPlan, PaymentOrder } from '../domain/orders'
import type { PaymentApi } from '../persistence/paymentApi'
import type { NimiqConnectionState, NimiqWalletState } from '../integration/nimiq'
import { requestNimPayment } from '../integration/nimiq'
import { requestUsdtTransfer } from '../integration/ethereum'
import { PayPage } from './PayPage'

vi.mock('../integration/nimiq', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../integration/nimiq')>()
  return { ...actual, requestNimPayment: vi.fn() }
})

vi.mock('../integration/ethereum', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../integration/ethereum')>()
  return { ...actual, requestUsdtTransfer: vi.fn() }
})

const mockedRequestNimPayment = requestNimPayment as Mock
const mockedRequestUsdtTransfer = requestUsdtTransfer as Mock

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
    listCashoutBanks: Mock
    verifyCashoutAccount: Mock
    previewCashoutRate: Mock
    createCashoutOrder: Mock
    createCashoutQuote: Mock
    createCashoutIntent: Mock
    submitCashoutPayment: Mock
    reconcileCashoutOrder: Mock
    refreshCashoutQuote: Mock
    getReadiness: Mock
    getNimRate: Mock
    getWalletNimBalance: Mock
    listAccountBalances: Mock
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
    reconcileOrder: vi.fn().mockImplementation(async (id: string) => find(id)),
    retryDelivery: vi.fn().mockImplementation(async (id: string) => find(id)),
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
    listCashoutBanks: vi.fn().mockResolvedValue([{ code: 'GTB', name: 'GTBank' }]),
    verifyCashoutAccount: vi.fn().mockResolvedValue({
      bankCode: 'GTB', bankName: 'GTBank', accountNumber: '0123456789', accountName: 'ADA OKAFOR',
    }),
    previewCashoutRate: vi.fn().mockResolvedValue({
      usdtAmount: '100', ngnAmount: '150000', rateNgnPerUsdt: '1500', source: 'paycrest', observedAt: '2026-10-14T00:00:00.000Z',
    }),
    createCashoutOrder: vi.fn().mockImplementation(async (input: unknown) => {
      const draft = input as { usdtAmount: string; bankCode: string; accountNumber: string }
      const created = order({
        id: 'order-cashout-new',
        serviceType: 'CASH_OUT',
        paymentAsset: 'USDT',
        requestedAmount: draft.usdtAmount,
        requestedCurrency: 'USDT',
        bankCode: draft.bankCode,
        bankName: 'GTBank',
        bankAccountNumber: draft.accountNumber,
        bankAccountName: 'ADA OKAFOR',
      })
      orders.unshift(created)
      return created
    }),
    createCashoutQuote: vi.fn().mockImplementation(async (id: string) => {
      const found = find(id)
      const index = orders.findIndex((entry) => entry.id === id)
      const quoted = {
        ...found,
        paymentStatus: 'READY_FOR_PAYMENT' as const,
        provider: 'paycrest',
        providerRef: 'pc-1',
        paycrestReceiveAddress: `0x${'dd'.repeat(20)}`,
        quoteExpiresAt: new Date(Date.now() + 120_000).toISOString(),
        quotedCryptoAmount: '101.5',
        usdtTotalAmount: '101.5',
        payoutNgnAmount: '152250',
        cashoutFeeUsdt: '1.5',
        cashoutRate: '1500',
      }
      orders[index] = quoted
      return quoted
    }),
    createCashoutIntent: vi.fn().mockImplementation(async (id: string) => ({
      order: find(id),
      intent: {
        receiveAddress: `0x${'dd'.repeat(20)}`,
        contractAddress: `0x${'ab'.repeat(20)}`,
        chainIdHex: '0x89',
        totalBaseUnits: '101500000',
        quoteExpiresAt: new Date(Date.now() + 120_000).toISOString(),
      },
    })),
    submitCashoutPayment: vi.fn().mockImplementation(async (id: string, transactionHash: string) => {
      const found = find(id)
      const index = orders.findIndex((entry) => entry.id === id)
      const submitted = { ...found, paymentStatus: 'ONCHAIN_PENDING' as const, walletTxRef: transactionHash.replace(/^0x/, '') }
      orders[index] = submitted
      return submitted
    }),
    reconcileCashoutOrder: vi.fn().mockImplementation(async (id: string) => find(id)),
    refreshCashoutQuote: vi.fn().mockImplementation(async (id: string) => find(id)),
    getReadiness: vi.fn().mockImplementation(async () => verifiedReadiness()),
    getNimRate: vi.fn().mockResolvedValue({
      ngnPerNim: '2000',
      source: 'test:rate',
      asOf: new Date(Date.now() - 1000).toISOString(),
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
    }),
    getWalletNimBalance: vi.fn().mockResolvedValue({
      balanceLuna: '22100000',
      balanceNim: '221',
      network: 'mainnet',
      source: 'rpc',
    }),
    listAccountBalances: vi.fn().mockImplementation(async (addresses: string[]) => ({
      accounts: addresses.map((address) => ({
        suffix: `…${address.replace(/\s+/g, '').slice(-4)}`,
        ok: true,
        balanceLuna: '22100000',
        balanceNim: '221',
      })),
      aggregateLuna: '22100000',
      aggregateNim: '221',
      okCount: addresses.length,
      network: 'mainnet',
    })),
  }
  return api
}

function verifiedReadiness() {
  const verified = (reason: string) => ({ status: 'verified' as const, reason })
  return {
    network: 'mainnet' as const,
    database: 'ready' as const,
    nimReceiver: true,
    nimiqRpc: true,
    clubKonnect: true,
    clubKonnectCallback: true,
    paycrest: true,
    polygonUsdt: true,
    rails: {
      airtime: verified('Live behavior verified by an operator smoke test.'),
      data: verified('Live behavior verified by an operator smoke test.'),
      cashout: verified('Live behavior verified by an operator smoke test.'),
    },
  }
}

function unavailableReadiness() {
  const report = verifiedReadiness()
  return {
    ...report,
    rails: {
      airtime: { status: 'unavailable' as const, reason: 'Airtime provider is not configured.' },
      data: { status: 'configured' as const, reason: 'Connected — live behavior not yet verified by an operator smoke test.' },
      cashout: { status: 'unavailable' as const, reason: 'Cash out is not configured.' },
    },
  }
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

  it('opens Recovery Center from order detail needing attention', async () => {
    const failed = quotedOrder({
      paymentStatus: 'PAID',
      fulfilmentStatus: 'FULFILLMENT_FAILED',
      provider: 'clubkonnect',
      providerRequestId: 'req-9',
      providerStatusCode: '400',
      providerStatus: 'ORDER_FAILED',
    })
    const api = apiStub([failed])
    render(<PayPage api={api} connection={offlineConnection} />)
    fireEvent.click(await screen.findByRole('button', { name: /₦1000 airtime/ }))
    expect(await screen.findByText('Recovery Center')).toBeInTheDocument()
    expect(screen.getByText('Airtime delivery failed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh status' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry delivery' })).toBeInTheDocument()
    expect(screen.queryByText('08012345678')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry delivery' }))
    await waitFor(() => expect(api.retryDelivery).toHaveBeenCalledWith(failed.id))
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

  it('walks the cash-out form with verified account details', async () => {
    const api = apiStub()
    render(<PayPage api={api} connection={offlineConnection} />)
    await waitFor(() => expect(api.list).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: /Cash out/ }))
    expect(await screen.findByRole('option', { name: 'GTBank' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Amount (USDT)'), { target: { value: '100' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check rate' }))
    expect(await screen.findByText('1 USDT ≈ ₦1500')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Bank'), { target: { value: 'GTB' } })
    fireEvent.change(screen.getByLabelText('Account number'), { target: { value: '0123 456 789' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify account' }))
    expect(await screen.findByText(/Verified account: ADA OKAFOR/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Review payout' }))
    expect(await screen.findByText('101.5 USDT cash out')).toBeInTheDocument()
    expect(screen.getByText('GTBank')).toBeInTheDocument()
    expect(screen.getByText('ADA OKAFOR')).toBeInTheDocument()
    expect(screen.getByText('₦152250')).toBeInTheDocument()
    expect(screen.queryByText('0123456789')).not.toBeInTheDocument()
    expect(api.createCashoutOrder).toHaveBeenCalledWith({
      usdtAmount: '100',
      bankCode: 'GTB',
      accountNumber: '0123456789',
    })
  })

  it('approves the exact quoted USDT total only from an explicit tap', async () => {
    const api = apiStub([
      order({
        id: 'order-cashout-ready',
        serviceType: 'CASH_OUT',
        paymentAsset: 'USDT',
        requestedAmount: '100',
        requestedCurrency: 'USDT',
        paymentStatus: 'READY_FOR_PAYMENT',
        bankCode: 'GTB',
        bankName: 'GTBank',
        bankAccountNumber: '0123456789',
        bankAccountName: 'ADA OKAFOR',
        provider: 'paycrest',
        providerRef: 'pc-1',
        paycrestReceiveAddress: `0x${'dd'.repeat(20)}`,
        quoteExpiresAt: new Date(Date.now() + 120_000).toISOString(),
        quotedCryptoAmount: '101.5',
        usdtTotalAmount: '101.5',
        payoutNgnAmount: '152250',
        cashoutFeeUsdt: '1.5',
        cashoutRate: '1500',
      }),
    ])
    mockedRequestUsdtTransfer.mockResolvedValue(`0x${'ef'.repeat(32)}`)
    render(<PayPage api={api} connection={offlineConnection} />)
    await waitFor(() => expect(api.list).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: /101\.5 USDT cash out/ }))
    expect(await screen.findByRole('button', { name: 'Approve 101.5 USDT' })).toBeInTheDocument()
    // No wallet contact before the explicit tap.
    expect(mockedRequestUsdtTransfer).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Approve 101.5 USDT' }))
    await waitFor(() => expect(mockedRequestUsdtTransfer).toHaveBeenCalledTimes(1))
    expect(mockedRequestUsdtTransfer.mock.calls[0]?.[0]).toMatchObject({
      receiveAddress: `0x${'dd'.repeat(20)}`,
      totalBaseUnits: '101500000',
      chainIdHex: '0x89',
    })
    expect(api.submitCashoutPayment).toHaveBeenCalledWith('order-cashout-ready', `0x${'ef'.repeat(32)}`)
    expect(await screen.findByText('Refresh payout status')).toBeInTheDocument()
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

  it('disables unavailable rails before any form can lead to a dead flow', async () => {
    const api = apiStub()
    api.getReadiness.mockResolvedValue(unavailableReadiness())
    render(<PayPage api={api} connection={offlineConnection} />)
    await waitFor(() => expect(api.getReadiness).toHaveBeenCalled())

    // Unavailable entries render disabled with honest reasons.
    expect(screen.getByText('Airtime provider is not configured.')).toBeInTheDocument()
    expect(screen.getByText('Cash out is not configured.')).toBeInTheDocument()
    // Configured-but-unverified data stays usable with an upfront notice.
    expect(screen.getByText(/Data: Connected — live behavior not yet verified/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Data/ }))
    expect(screen.getByLabelText('Network')).toBeInTheDocument()
  })

  it('shows the funding preview from the authoritative quote without mutating balance', async () => {
    const api = apiStub([quotedOrder()])
    const wallet: NimiqWalletState = { status: 'available', address: 'NQ12 3456', lunaBalance: 22100000, nimBalance: '221', network: 'mainnet' }
    const onRefreshWallet = vi.fn().mockResolvedValue(wallet)
    render(<PayPage api={api} connection={readyConnection} wallet={wallet} onRefreshWallet={onRefreshWallet} />)

    fireEvent.click(await screen.findByRole('button', { name: /₦1000 airtime/ }))
    // Canonical balance untouched; deduction preview uses quote amounts.
    expect(await screen.findByText('221 NIM')).toBeInTheDocument()
    expect(screen.getByText(/− 0\.5 NIM/)).toBeInTheDocument()
    expect(screen.getByText('₦1000 Airtime')).toBeInTheDocument()
    expect(screen.getByText(/If paid from this connected wallet/)).toBeInTheDocument()
    expect(screen.getByText(/220\.5 NIM left/)).toBeInTheDocument()
    expect(screen.getByText('≈ ₦442000.00')).toBeInTheDocument()
    // Sender-independence: preview never disables payment.
    expect(screen.getByRole('button', { name: 'Pay 0.5 NIM' })).toBeEnabled()
    expect(api.getNimRate).toHaveBeenCalled()
  })

  it('keeps payment available on shortfall instead of blocking', async () => {
    const api = apiStub([quotedOrder()])
    const wallet: NimiqWalletState = { status: 'available', address: 'NQ12 3456', lunaBalance: 1000, nimBalance: '0.01', network: 'mainnet' }
    render(<PayPage api={api} connection={readyConnection} wallet={wallet} onRefreshWallet={vi.fn().mockResolvedValue(wallet)} />)

    fireEvent.click(await screen.findByRole('button', { name: /₦1000 airtime/ }))
    expect(await screen.findByText(/0\.49 short/)).toBeInTheDocument()
    expect(screen.getByText(/payment stays available/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pay 0.5 NIM' })).toBeEnabled()
  })

  it('shows pending deduction after submission without subtracting', async () => {
    const api = apiStub([quotedOrder()])
    mockedRequestNimPayment.mockReset()
    mockedRequestNimPayment.mockResolvedValue('ab'.repeat(32))
    const wallet: NimiqWalletState = { status: 'available', address: 'NQ12 3456', lunaBalance: 22100000, nimBalance: '221', network: 'mainnet' }
    render(<PayPage api={api} connection={readyConnection} wallet={wallet} onRefreshWallet={vi.fn().mockResolvedValue(wallet)} />)

    fireEvent.click(await screen.findByRole('button', { name: /₦1000 airtime/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Pay 0.5 NIM' }))
    expect(await screen.findByText(/0\.5 NIM pending/)).toBeInTheDocument()
    expect(screen.getByText(/unchanged until on-chain verification/)).toBeInTheDocument()
    expect(screen.getByText('221 NIM')).toBeInTheDocument()
  })

  it('refreshes the real balance after PAID and survives refresh failure', async () => {
    const pending = quotedOrder({ paymentStatus: 'ONCHAIN_PENDING', walletTxRef: 'ab'.repeat(32) })
    const api = apiStub([pending])
    const paid = { ...pending, paymentStatus: 'PAID' as const }
    api.reconcilePayment.mockResolvedValue(paid)
    const wallet: NimiqWalletState = { status: 'available', address: 'NQ12 3456', lunaBalance: 22100000, nimBalance: '221', network: 'mainnet' }
    const fresh: NimiqWalletState = { ...wallet, lunaBalance: 22049500, nimBalance: '220.495' }
    const onRefreshWallet = vi.fn().mockResolvedValue(fresh)
    const { rerender } = render(<PayPage api={api} connection={readyConnection} wallet={wallet} onRefreshWallet={onRefreshWallet} />)

    fireEvent.click(await screen.findByRole('button', { name: /₦1000 airtime/ }))
    await waitFor(() => expect(onRefreshWallet).toHaveBeenCalledOnce())
    rerender(<PayPage api={api} connection={readyConnection} wallet={fresh} onRefreshWallet={onRefreshWallet} />)
    expect(await screen.findByText('220.495 NIM')).toBeInTheDocument()
    expect(screen.getByText('NIM payment confirmed')).toBeInTheDocument()
  })

  it('keeps PAID intact when the post-payment balance refresh fails', async () => {
    const pending = quotedOrder({ paymentStatus: 'ONCHAIN_PENDING', walletTxRef: 'ab'.repeat(32) })
    const api = apiStub([pending])
    api.reconcilePayment.mockResolvedValue({ ...pending, paymentStatus: 'PAID' as const })
    const wallet: NimiqWalletState = { status: 'available', address: 'NQ12 3456', lunaBalance: 22100000, nimBalance: '221', network: 'mainnet' }
    render(<PayPage api={api} connection={readyConnection} wallet={wallet} onRefreshWallet={vi.fn().mockRejectedValue(new Error('rpc down'))} />)

    fireEvent.click(await screen.findByRole('button', { name: /₦1000 airtime/ }))
    expect(await screen.findByText(/Balance refresh unavailable/)).toBeInTheDocument()
    expect(screen.getByText('NIM payment confirmed')).toBeInTheDocument()
    expect(screen.getByText('221 NIM')).toBeInTheDocument()
  })

  it('reuses the shared funding UI on data review', async () => {
    const api = apiStub([quotedOrder({ serviceType: 'DATA', requestedAmount: '350' })])
    const wallet: NimiqWalletState = { status: 'available', address: 'NQ12 3456', lunaBalance: 22100000, nimBalance: '221', network: 'mainnet' }
    render(<PayPage api={api} connection={readyConnection} wallet={wallet} onRefreshWallet={vi.fn().mockResolvedValue(wallet)} />)

    fireEvent.click(await screen.findByRole('button', { name: /₦350 data/ }))
    expect(await screen.findByText('221 NIM')).toBeInTheDocument()
    expect(screen.getByText('₦350 Data')).toBeInTheDocument()
    expect(screen.getByText(/If paid from this connected wallet/)).toBeInTheDocument()
  })

  it('renders unavailable rails as non-actionable rows', async () => {
    const api = apiStub()
    api.getReadiness.mockResolvedValue(unavailableReadiness())
    render(<PayPage api={api} connection={offlineConnection} />)
    await waitFor(() => expect(api.getReadiness).toHaveBeenCalled())

    // Disabled ListRows render as articles, never as buttons: no tap can
    // lead into the airtime or cash-out forms while unconfigured.
    expect(screen.queryByRole('button', { name: /Airtime/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Cash out/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Data/ })).toBeInTheDocument()
  })

  it('labels the session network fallback on review without inventing host truth', async () => {
    const api = apiStub([quotedOrder()])
    const wallet = { status: 'unavailable' as const, network: 'unknown' as const }
    render(<PayPage api={api} connection={readyConnection} wallet={wallet} fallbackNetwork="mainnet" onRefreshWallet={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: /₦1000 airtime/ }))
    expect(await screen.findByText('Mainnet (session)')).toBeInTheDocument()
    expect(screen.getByText('Balance unavailable')).toBeInTheDocument()
  })

  it('reviews against the aggregate funding context with informational wording', async () => {
    const api = apiStub([quotedOrder()])
    render(<PayPage
      api={api}
      connection={readyConnection}
      funding={{ luna: '22100500', nim: '221.005', network: 'mainnet' }}
    />)
    fireEvent.click(await screen.findByRole('button', { name: /₦1000 airtime/ }))
    expect(await screen.findByText('221.005 NIM')).toBeInTheDocument()
    expect(screen.getByText('Available in Nimiq Pay')).toBeInTheDocument()
    expect(screen.getByText('≈ ₦442010.00')).toBeInTheDocument()
    expect(screen.getByText(/Potential remaining/)).toBeInTheDocument()
    expect(screen.getByText(/220\.505 NIM/)).toBeInTheDocument()
    // Sender independence: aggregate context never disables payment.
    expect(screen.getByRole('button', { name: 'Pay 0.5 NIM' })).toBeEnabled()
  })

  it('shows the full conversion breakdown on review before approval', async () => {
    const api = apiStub([quotedOrder()])
    render(<PayPage
      api={api}
      connection={readyConnection}
      funding={{ luna: '22100500', nim: '221.005', network: 'mainnet' }}
    />)
    fireEvent.click(await screen.findByRole('button', { name: /₦1000 airtime/ }))
    // Requested NGN amount, current conversion, and exact NIM to be paid
    // all come from the authoritative server quote — never the browser.
    expect(await screen.findByText('₦1000 airtime')).toBeInTheDocument()
    expect(screen.getByText('1 NIM ≈ ₦2000')).toBeInTheDocument()
    expect(screen.getByText('0.5 NIM')).toBeInTheDocument()
    expect(screen.getByText('221.005 NIM')).toBeInTheDocument()
    expect(screen.getByText(/Quote expires in/)).toBeInTheDocument()
    expect(api.createQuote).not.toHaveBeenCalled()
  })
})
