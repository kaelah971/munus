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

    expect(challenge.message).not.toContain('Wallet:')
    expect(challenge.message).toContain('Network: mainnet')
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

  it('authenticates signer B when connection.accounts[0] is wallet A', async () => {
    const fixture = createFixture()
    const connectionAccounts = [fixture.walletAddress]
    const signer = KeyPair.generate()
    const signerAddress = signer.toAddress().toUserFriendlyAddress()
    const challenge = await fixture.auth.createChallenge({
      walletAddress: connectionAccounts[0],
      network: 'mainnet',
    })

    const verified = await fixture.auth.verifyChallenge({
      challengeId: challenge.id,
      walletAddress: connectionAccounts[0],
      ...fixture.sign(challenge.message, signer),
    })
    expect(verified.session).toMatchObject({
      walletAddress: signerAddress,
      trust: 'server-verified',
    })
    expect([...fixture.repository.users.values()]).toEqual([
      expect.objectContaining({ walletAddress: signerAddress }),
    ])
    expect([...fixture.repository.sessions.values()]).toEqual([
      expect.objectContaining({ walletAddress: signerAddress }),
    ])
    expect(verified.token).toBe('opaque-session-token')

    await expect(
      fixture.auth.verifyChallenge({
        challengeId: challenge.id,
        walletAddress: fixture.walletAddress,
        ...fixture.sign(challenge.message, signer),
      }),
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it('rejects a verify request whose supplied account no longer matches the challenge', async () => {
    const fixture = createFixture()
    const otherAccount = KeyPair.generate().toAddress().toUserFriendlyAddress()
    const challenge = await fixture.auth.createChallenge({
      walletAddress: fixture.walletAddress,
      network: 'mainnet',
    })

    await expect(
      fixture.auth.verifyChallenge({
        challengeId: challenge.id,
        walletAddress: otherAccount,
        ...fixture.sign(challenge.message),
      }),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: 'AUTH_CHALLENGE_ADDRESS_MISMATCH',
      message: 'Authentication request does not match its challenge.'
    })
  })

  it('returns a safe invalid-signature error for a signed preimage mismatch', async () => {
    const fixture = createFixture()
    const challenge = await fixture.auth.createChallenge({
      walletAddress: fixture.walletAddress,
      network: 'mainnet',
    })

    await expect(
      fixture.auth.verifyChallenge({
        challengeId: challenge.id,
        walletAddress: fixture.walletAddress,
        ...fixture.sign('altered challenge'),
      }),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: 'AUTH_INVALID_SIGNATURE',
      message: 'Munus could not verify the Nimiq Pay signature.',
    })
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
