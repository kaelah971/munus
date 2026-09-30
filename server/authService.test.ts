// @vitest-environment node
import { KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import { MunusAuthService } from './authService'
import { InMemoryMunusRepository } from './repository'

const challengeTtlMs = 5 * 60 * 1000
const sessionTtlMs = 24 * 60 * 60 * 1000

function createFixture() {
  let now = 1_700_000_000_000
  const repository = new InMemoryMunusRepository()
  const auth = new MunusAuthService(repository, {
    challengeTtlMs,
    sessionTtlMs,
    now: () => now,
    randomToken: () => 'opaque-session-token',
  })
  const keyPair = KeyPair.generate()
  const walletAddress = keyPair.toAddress().toUserFriendlyAddress()

  return {
    auth,
    repository,
    keyPair,
    walletAddress,
    advance(ms: number) {
      now += ms
    },
    sign(message: string, pair = keyPair) {
      const signature = pair.sign(new TextEncoder().encode(message))
      return {
        publicKey: pair.publicKey.toHex(),
        signature: signature.toHex(),
      }
    },
  }
}

describe('Munus production wallet authentication', () => {
  it('creates an expiring challenge and rejects an altered message', async () => {
    const fixture = createFixture()
    const challenge = await fixture.auth.createChallenge({
      walletAddress: fixture.walletAddress,
      network: 'mainnet',
    })

    expect(challenge.message).toContain(`Wallet: ${fixture.walletAddress}`)
    expect(challenge.message).toContain('Nonce:')
    expect(challenge.expiresAt).toBe(1_700_000_000_000 + challengeTtlMs)

    const alteredSignature = fixture.sign('altered challenge')
    await expect(
      fixture.auth.verifyChallenge({
        challengeId: challenge.id,
        walletAddress: fixture.walletAddress,
        ...alteredSignature,
      }),
    ).rejects.toMatchObject({ statusCode: 401 })

    fixture.advance(challengeTtlMs + 1)
    await expect(
      fixture.auth.verifyChallenge({
        challengeId: challenge.id,
        walletAddress: fixture.walletAddress,
        ...fixture.sign(challenge.message),
      }),
    ).rejects.toMatchObject({ statusCode: 410 })
  })

  it('rejects a wrong signer and accepts the correct signature once', async () => {
    const fixture = createFixture()
    const wrongSigner = KeyPair.generate()
    const challenge = await fixture.auth.createChallenge({
      walletAddress: fixture.walletAddress,
      network: 'mainnet',
    })

    await expect(
      fixture.auth.verifyChallenge({
        challengeId: challenge.id,
        walletAddress: fixture.walletAddress,
        ...fixture.sign(challenge.message, wrongSigner),
      }),
    ).rejects.toMatchObject({ statusCode: 401 })

    const verified = await fixture.auth.verifyChallenge({
      challengeId: challenge.id,
      walletAddress: fixture.walletAddress,
      ...fixture.sign(challenge.message),
    })
    expect(verified.session).toMatchObject({
      walletAddress: fixture.walletAddress,
      trust: 'server-verified',
    })
    expect(verified.token).toBe('opaque-session-token')

    await expect(
      fixture.auth.verifyChallenge({
        challengeId: challenge.id,
        walletAddress: fixture.walletAddress,
        ...fixture.sign(challenge.message),
      }),
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it('rejects an expired server session', async () => {
    const fixture = createFixture()
    const challenge = await fixture.auth.createChallenge({
      walletAddress: fixture.walletAddress,
      network: 'mainnet',
    })
    const verified = await fixture.auth.verifyChallenge({
      challengeId: challenge.id,
      walletAddress: fixture.walletAddress,
      ...fixture.sign(challenge.message),
    })

    fixture.advance(sessionTtlMs + 1)
    await expect(fixture.auth.restoreSession(verified.token)).resolves.toBeNull()
  })

  it('restores and revokes an opaque server session', async () => {
    const fixture = createFixture()
    const challenge = await fixture.auth.createChallenge({
      walletAddress: fixture.walletAddress,
      network: 'testnet',
    })
    const verified = await fixture.auth.verifyChallenge({
      challengeId: challenge.id,
      walletAddress: fixture.walletAddress,
      ...fixture.sign(challenge.message),
    })

    await expect(fixture.auth.restoreSession(verified.token)).resolves.toMatchObject({
      id: verified.session.id,
      network: 'testnet',
    })

    await fixture.auth.revokeSession(verified.token)
    await expect(fixture.auth.restoreSession(verified.token)).resolves.toBeNull()
    expect([...fixture.repository.sessions.values()][0].tokenHash).not.toBe(verified.token)
  })
})
