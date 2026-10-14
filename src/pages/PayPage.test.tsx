import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PaymentOrder } from '../domain/orders'
import type { PaymentApi } from '../persistence/paymentApi'
import { PayPage } from './PayPage'

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

function apiStub(orders: PaymentOrder[] = []): PaymentApi & { createOrder: ReturnType<typeof vi.fn> } {
  return {
    list: vi.fn().mockResolvedValue(orders),
    get: vi.fn().mockImplementation(async (id: string) => {
      const found = orders.find((entry) => entry.id === id)
      if (!found) throw new Error('Payment order was not found.')
      return found
    }),
    createOrder: vi.fn().mockImplementation(async (draft: unknown) => {
      const created = order({ ...(draft as Partial<PaymentOrder>), id: 'order-new' })
      orders.unshift(created)
      return created
    }),
  }
}

describe('Pay essentials order flow', () => {
  it('opens the airtime form, saves a persisted order, and shows a truthful review', async () => {
    const api = apiStub()
    render(<PayPage api={api} defaultPhone="08099999999" />)

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

  it('lists saved orders and keeps other categories unselectable', async () => {
    render(<PayPage api={apiStub([order()])} />)

    expect(await screen.findByRole('button', { name: /₦1000 airtime/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Data/ })).not.toBeInTheDocument()
    expect(screen.getByText(/Orders saved here cannot send NIM yet/)).toBeInTheDocument()
  })

  it('retains the form when saving fails', async () => {
    const api = apiStub()
    api.createOrder.mockRejectedValueOnce(new Error('Munus could not save this airtime order.'))
    render(<PayPage api={api} />)

    await waitFor(() => expect(api.list).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /Airtime/ }))
    fireEvent.change(screen.getByLabelText('Recipient phone'), { target: { value: '08012345678' } })
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review airtime order' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Munus could not save this airtime order.')
    expect(screen.getByLabelText('Recipient phone')).toHaveValue('08012345678')
  })

  it('shows truthful fulfilment state when real provider data exists', async () => {
    render(<PayPage api={apiStub([order({
      paymentStatus: 'PAID',
      fulfilmentStatus: 'FULFILLING',
      provider: 'clubkonnect',
      providerStatus: 'ORDER_RECEIVED',
      providerStatusCode: '100',
    })])} />)

    fireEvent.click(await screen.findByRole('button', { name: /₦1000 airtime/ }))
    expect(await screen.findByText('Paid · fulfilment in progress.')).toBeInTheDocument()
    expect(screen.getByText('ClubKonnect')).toBeInTheDocument()
    expect(screen.getByText('ORDER_RECEIVED (100)')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pay now/i })).not.toBeInTheDocument()
  })
})
