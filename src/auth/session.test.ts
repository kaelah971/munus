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

  it('restores a server session without reading a browser token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        session: {
          id: 'session-1',
          userId: 'user-1',
          walletAddress: 'NQ01',
          network: 'mainnet',
          issuedAt: Date.now(),
          expiresAt: Date.now() + 60_000,
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(createRemoteAuthGateway('https://api.example.test').restoreSession()).resolves.toMatchObject({
      id: 'session-1',
      trust: 'server-verified',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/auth/session',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    )
  })

  it('surfaces the safe backend auth reason instead of a generic 401', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'challenge-1',
          walletAddress: 'NQ01',
          network: 'mainnet',
          message: 'Sign this exact challenge',
          expiresAt: Date.now() + 60_000,
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({
          code: 'AUTH_INVALID_SIGNATURE',
          error: 'Munus could not verify the Nimiq Pay signature.',
        }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const sign = vi.fn().mockResolvedValue({ publicKey: 'public-key', signature: 'signature' })
    try {
      await createRemoteAuthGateway('https://api.example.test').signIn('NQ01', sign)
      throw new Error('Expected remote sign-in to fail.')
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe('Munus could not verify the Nimiq Pay signature.')
      expect((error as Error).message).not.toContain('request failed (401)')
    }
  })

  it('surfaces the challenge-address mismatch without mislabeling it as a signer mismatch', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'challenge-1',
          walletAddress: 'NQ01',
          network: 'mainnet',
          message: 'Sign this exact challenge',
          expiresAt: Date.now() + 60_000,
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({
          code: 'AUTH_CHALLENGE_ADDRESS_MISMATCH',
          error: 'Authentication request does not match its challenge.',
        }),
      })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      createRemoteAuthGateway('https://api.example.test').signIn(
        'NQ01',
        vi.fn().mockResolvedValue({ publicKey: 'public-key', signature: 'signature' }),
      ),
    ).rejects.toThrow('Authentication request does not match its challenge.')
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
          network: 'mainnet',
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
          walletAddress: 'NQ01',
          network: 'mainnet',
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
