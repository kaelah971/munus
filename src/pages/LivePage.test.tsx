import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LivePage } from './LivePage'
import type { LiveStatsSnapshot } from '../persistence/liveApi'

function snapshotBody(overrides: Partial<LiveStatsSnapshot> = {}): LiveStatsSnapshot {
  return {
    metrics: {
      verifiedWallets: 0,
      activeUsers7d: 0,
      deliveredEssentials: 0,
      nimUsed: '0',
      nimPayments: 0,
      cashoutOrders: 0,
      usdtCashedOut: '0',
      requestsCompleted: 0,
    },
    recentActivity: [],
    updatedAt: '2026-10-14T12:00:00.000Z',
    ...overrides,
  }
}

function mockFetch(handler: () => { status: number; body: unknown }) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    const { status, body } = handler()
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
  })
}

describe('Munus Live public page', () => {
  it('shows honest zeros and an empty feed without authentication', async () => {
    const fetchMock = mockFetch(() => ({ status: 200, body: snapshotBody() }))
    try {
      render(<LivePage apiBaseUrl="https://munus.example" />)
      expect(await screen.findByText('Real people. Real wallets. Real everyday use.')).toBeInTheDocument()
      expect(screen.getAllByText('0')).toHaveLength(4)
      expect(screen.getByText('0 NIM')).toBeInTheDocument()
      expect(screen.getByText('0 USDT')).toBeInTheDocument()
      expect(await screen.findByText('No recent verified activity yet')).toBeInTheDocument()
      expect(fetchMock).toHaveBeenCalledWith('https://munus.example/public/live')
    } finally {
      fetchMock.mockRestore()
    }
  })

  it('renders metrics and privacy-safe activity rows', async () => {
    const fetchMock = mockFetch(() => ({
      status: 200,
      body: snapshotBody({
        metrics: {
          verifiedWallets: 12,
          activeUsers7d: 5,
          deliveredEssentials: 3,
          nimUsed: '13',
          nimPayments: 3,
          cashoutOrders: 1,
          usdtCashedOut: '101.5',
          requestsCompleted: 2,
        },
        recentActivity: [
          { kind: 'airtime-delivered', network: 'MTN', amountNgn: '1000', walletMasked: 'NQ32…8KPM', at: '2026-10-14T11:00:00.000Z' },
          { kind: 'cashout-settled', usdtAmount: '101.5', walletMasked: 'NQ47…BCKQ', at: '2026-10-14T10:00:00.000Z' },
          { kind: 'request-completed', serviceLabel: 'Data', detail: '5 GB · Airtel', at: '2026-10-13T12:00:00.000Z' },
          { kind: 'wallet-joined', walletMasked: 'NQ47…BCKQ', at: '2026-10-13T10:00:00.000Z' },
        ],
      }),
    }))
    try {
      render(<LivePage apiBaseUrl="https://munus.example" />)
      expect(await screen.findByText('12')).toBeInTheDocument()
      expect(screen.getByText('13 NIM')).toBeInTheDocument()
      expect(screen.getByText('101.5 USDT')).toBeInTheDocument()
      expect(screen.getByText('Airtime delivered')).toBeInTheDocument()
      expect(screen.getByText(/MTN · ₦1000 · NQ32…8KPM/)).toBeInTheDocument()
      expect(screen.getByText(/101\.5 USDT → NGN · NQ47…BCKQ/)).toBeInTheDocument()
      expect(screen.getByText('How is this verified?')).toBeInTheDocument()
      expect(screen.queryByText('08012345678')).not.toBeInTheDocument()
    } finally {
      fetchMock.mockRestore()
    }
  })

  it('explains outages truthfully with a retry action', async () => {
    const fetchMock = mockFetch(() => ({ status: 500, body: { error: 'boom' } }))
    try {
      render(<LivePage apiBaseUrl="https://munus.example" />)
      expect(await screen.findByRole('alert')).toHaveTextContent('Munus Live is unavailable right now.')
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      fetchMock.mockRestore()
    }
  })
})
