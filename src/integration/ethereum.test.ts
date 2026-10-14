import { describe, expect, it, vi } from 'vitest'
import {
  requestUsdtTransfer,
  type Eip1193Provider,
  type UsdtTransferIntent,
} from './ethereum'

const INTENT: UsdtTransferIntent = {
  contractAddress: `0x${'ab'.repeat(20)}`,
  receiveAddress: `0x${'dd'.repeat(20)}`,
  totalBaseUnits: '101500000',
  chainIdHex: '0x89',
  quoteExpiresAt: new Date(Date.now() + 600_000).toISOString(),
}

function stubProvider(overrides: Partial<Record<string, unknown | ((...args: never[]) => unknown)>> = {}) {
  const requests: Array<{ method: string; params?: unknown }> = []
  const provider: Eip1193Provider = {
    request: async (args) => {
      requests.push(args)
      if (args.method === 'eth_chainId') {
        if ('chainId' in overrides) return overrides.chainId as unknown
        return '0x89'
      }
      if (args.method === 'eth_sendTransaction') {
        const send = overrides.send as ((params: unknown) => unknown) | undefined
        if (send) return send(args.params)
        return `0x${'ef'.repeat(32)}`
      }
      throw new Error(`Unexpected method ${args.method}`)
    },
  }
  return { provider, requests }
}

describe('USDT wallet transfer', () => {
  it('sends the exact quoted total to the pinned contract', async () => {
    const { provider, requests } = stubProvider()
    Object.defineProperty(window, 'ethereum', { value: provider, configurable: true, writable: true })
    try {
      const hash = await requestUsdtTransfer(INTENT)
      expect(hash).toBe(`0x${'ef'.repeat(32)}`)
      const send = requests.find((entry) => entry.method === 'eth_sendTransaction')
      const params = send?.params as Array<{ to: string; data: string; value: string }>
      expect(params[0].to).toBe(INTENT.contractAddress)
      expect(params[0].value).toBe('0x0')
      expect(params[0].data.startsWith('0xa9059cbb')).toBe(true)
    } finally {
      Object.defineProperty(window, 'ethereum', { value: undefined, configurable: true, writable: true })
    }
  })

  it('fails closed without a provider, on the wrong network, or on bad data', async () => {
    Object.defineProperty(window, 'ethereum', { value: undefined, configurable: true, writable: true })
    await expect(requestUsdtTransfer(INTENT)).rejects.toThrow(/No Ethereum wallet/)
    const { provider } = stubProvider({ chainId: '0x1' })
    Object.defineProperty(window, 'ethereum', { value: provider, configurable: true, writable: true })
    try {
      await expect(requestUsdtTransfer(INTENT)).rejects.toThrow(/Polygon/)
      await expect(requestUsdtTransfer({ ...INTENT, chainIdHex: '0x1' })).rejects.toThrow(/Polygon only/)
      await expect(requestUsdtTransfer(null)).rejects.toThrow(/missing or invalid/)
    } finally {
      Object.defineProperty(window, 'ethereum', { value: undefined, configurable: true, writable: true })
    }
  })

  it('passes wallet rejections through and rejects unusable references', async () => {
    const rejected = stubProvider({ send: () => { throw new Error('User denied transaction') } })
    const unusable = stubProvider({ send: () => '0x123' })
    const onRejected = vi.spyOn(rejected.provider, 'request')
    void onRejected
    Object.defineProperty(window, 'ethereum', { value: rejected.provider, configurable: true, writable: true })
    await expect(requestUsdtTransfer(INTENT)).rejects.toThrow(/User denied/)
    Object.defineProperty(window, 'ethereum', { value: unusable.provider, configurable: true, writable: true })
    try {
      await expect(requestUsdtTransfer(INTENT)).rejects.toThrow(/usable transaction reference/)
    } finally {
      Object.defineProperty(window, 'ethereum', { value: undefined, configurable: true, writable: true })
    }
  })
})
