import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RecoveryCenter } from './RecoveryCenter'
import type { PaymentOrder } from '../domain/orders'

function order(overrides: Partial<PaymentOrder> = {}): PaymentOrder {
  return {
    id: 'order-9',
    userId: 'user-a',
    serviceType: 'AIRTIME',
    paymentAsset: 'NIM',
    recipientPhone: '08012345678',
    recipientNetwork: 'MTN',
    recipientCountry: 'NG',
    requestedAmount: '1000',
    requestedCurrency: 'NGN',
    paymentStatus: 'PAID',
    fulfilmentStatus: 'RECOVERY_REQUIRED',
    walletTxRef: 'ab'.repeat(32),
    paymentVerifiedAt: '2026-10-14T12:05:00.000Z',
    quotedCryptoAmount: '0.5',
    createdAt: '2026-10-14T10:00:00.000Z',
    updatedAt: '2026-10-14T12:05:00.000Z',
    ...overrides,
  }
}

describe('RecoveryCenter', () => {
  it('explains the divergence without raw provider internals', async () => {
    render(
      <RecoveryCenter
        order={order()}
        onRefresh={async (id) => order({ id })}
        onRetry={async (id) => order({ id })}
        onBack={() => {}}
      />,
    )
    expect(await screen.findByText('Recovery Center')).toBeInTheDocument()
    expect(screen.getByText('Payment confirmed')).toBeInTheDocument()
    expect(screen.getByText('Airtime delivery needs attention')).toBeInTheDocument()
    expect(screen.getByText('0.5 NIM')).toBeInTheDocument()
    expect(screen.getByText('080•••5678')).toBeInTheDocument()
    expect(screen.queryByText('08012345678')).not.toBeInTheDocument()
    // Provider internals stay out of the UI.
    expect(screen.queryByText('req-1')).not.toBeInTheDocument()
  })

  it('blocks retry while delivery is in progress and surfaces failures', async () => {
    const onRetry = vi.fn()
    const first = render(
      <RecoveryCenter
        order={order({
          fulfilmentStatus: 'FULFILLING',
          fulfilmentStartedAt: new Date(Date.now() - 60_000).toISOString(),
          paymentVerifiedAt: new Date(Date.now() - 60_000).toISOString(),
        })}
        onRefresh={async (id) => order({ id })}
        onRetry={onRetry}
        onBack={() => {}}
      />,
    )
    // Fresh fulfilment is watch-only: no retry affordance at all.
    expect(await screen.findByText('Delivering your airtime')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry delivery' })).not.toBeInTheDocument()
    first.unmount()

    const onRefresh = vi.fn().mockRejectedValue(new Error('Provider timed out.'))
    const { unmount } = render(
      <RecoveryCenter
        order={order()}
        onRefresh={onRefresh}
        onRetry={async (id) => order({ id })}
        onBack={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Provider timed out.')
    unmount()
  })

  it('hands resolved orders back to the receipt', async () => {
    const onResolved = vi.fn()
    render(
      <RecoveryCenter
        order={order()}
        onRefresh={async (id) => order({ id })}
        onRetry={async (id) => order({ id, fulfilmentStatus: 'DELIVERED', fulfilledAt: '2026-10-14T12:09:00.000Z' })}
        onBack={() => {}}
        onResolved={onResolved}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Retry delivery' }))
    await waitFor(() => expect(onResolved).toHaveBeenCalledWith(
      expect.objectContaining({ fulfilmentStatus: 'DELIVERED' }),
    ))
  })
})
