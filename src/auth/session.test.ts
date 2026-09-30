import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createLocalDevelopmentAuthGateway,
  createRemoteAuthGateway,
} from './session'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Munus wallet authentication boundary', () => {
  it('uses a one-time signed challenge in the local development adapter', async () => {
    const sign = vi.fn().mockResolvedValue({ publicKey: 'public-key', signature: 'signature' })
    const session = await createLocalDevelopmentAuthGateway().signIn('NQ01', sign)

    expect(sign).toHaveBeenCalledOnce()
    expect(sign.mock.calls[0][0]).toContain('Wallet: NQ01')
    expect(sign.mock.calls[0][0]).toContain('Nonce:')
    expect(session).toMatchObject({
      walletAddress: 'NQ01',
      trust: 'development-only-unverified',
    })
  })

  it('sends challenge signatures to the remote session boundary', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'challenge-1',
          walletAddress: 'NQ01',
          message: 'Sign this exact challenge',
          expiresAt: Date.now() + 60_000,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'session-1',
          userId: 'user-1',
          issuedAt: Date.now(),
          expiresAt: Date.now() + 60_000,
        }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const sign = vi.fn().mockResolvedValue({ publicKey: 'public-key', signature: 'signature' })
    const session = await createRemoteAuthGateway('https://api.example.test').signIn('NQ01', sign)

    expect(sign).toHaveBeenCalledWith('Sign this exact challenge')
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.example.test/auth/verify',
      expect.objectContaining({
        credentials: 'include',
        body: JSON.stringify({
          challengeId: 'challenge-1',
          walletAddress: 'NQ01',
          publicKey: 'public-key',
          signature: 'signature',
        }),
      }),
    )
    expect(session).toMatchObject({ userId: 'user-1', trust: 'server-verified' })
  })
})
