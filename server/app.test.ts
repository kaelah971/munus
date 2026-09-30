// @vitest-environment node
import { KeyPair } from '@nimiq/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createMunusServer } from './app'
import { MunusAuthService } from './authService'
import { InMemoryMunusRepository } from './repository'

const openServers: Array<ReturnType<typeof createMunusServer>> = []

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve())
        }),
    ),
  )
})

async function createTestServer() {
  const repository = new InMemoryMunusRepository()
  const auth = new MunusAuthService(repository, {
    challengeTtlMs: 5 * 60 * 1000,
    sessionTtlMs: 24 * 60 * 60 * 1000,
  })
  const server = createMunusServer({
    repository,
    auth,
    config: {
      cookieName: 'munus_test_session',
      cookieSecure: false,
      defaultNetwork: 'mainnet',
    },
  })
  openServers.push(server)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not open a port.')

  return { baseUrl: `http://127.0.0.1:${address.port}`, repository }
}

async function authenticate(baseUrl: string, pair: KeyPair): Promise<string> {
  const walletAddress = pair.toAddress().toUserFriendlyAddress()
  const challengeResponse = await fetch(`${baseUrl}/auth/challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ walletAddress, network: 'mainnet' }),
  })
  const challenge = (await challengeResponse.json()) as { id: string; message: string }
  const signature = pair.sign(new TextEncoder().encode(challenge.message))
  const verifyResponse = await fetch(`${baseUrl}/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      challengeId: challenge.id,
      walletAddress,
      publicKey: pair.publicKey.toHex(),
      signature: signature.toHex(),
    }),
  })
  expect(verifyResponse.ok).toBe(true)
  const cookie = verifyResponse.headers.get('set-cookie')
  if (!cookie) throw new Error('Test server did not set a session cookie.')
  return cookie.split(';', 1)[0]
}

const profileDraft = {
  displayName: 'Amina',
  country: 'NG',
  localCurrency: 'NGN',
  defaultPhone: '+2348012345678',
  defaultNetwork: 'MTN',
  preferredPaymentAsset: 'NIM',
  language: 'en',
}

describe('Munus production API', () => {
  it('restores a cookie session, persists a profile, and revokes logout', async () => {
    const { baseUrl } = await createTestServer()
    const pair = KeyPair.generate()
    const cookie = await authenticate(baseUrl, pair)

    const restored = await fetch(`${baseUrl}/auth/session`, {
      headers: { cookie },
    })
    expect(restored.status).toBe(200)
    expect(await restored.json()).toMatchObject({ session: { trust: 'server-verified' } })

    const defaultPreferences = await fetch(`${baseUrl}/preferences`, { headers: { cookie } })
    expect(await defaultPreferences.json()).toMatchObject({
      notificationsEnabled: true,
      appLockEnabled: false,
    })

    const updatedPreferences = await fetch(`${baseUrl}/preferences`, {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ notificationsEnabled: false }),
    })
    expect(await updatedPreferences.json()).toMatchObject({ notificationsEnabled: false })

    const missingProfile = await fetch(`${baseUrl}/profile`, { headers: { cookie } })
    expect(missingProfile.status).toBe(404)

    const savedProfile = await fetch(`${baseUrl}/profile`, {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(profileDraft),
    })
    expect(savedProfile.status).toBe(200)
    expect(await savedProfile.json()).toMatchObject({ displayName: 'Amina', country: 'NG' })

    const loadedProfile = await fetch(`${baseUrl}/profile`, { headers: { cookie } })
    expect(await loadedProfile.json()).toMatchObject({ displayName: 'Amina' })

    const logout = await fetch(`${baseUrl}/auth/logout`, { method: 'POST', headers: { cookie } })
    expect(logout.status).toBe(204)

    const afterLogout = await fetch(`${baseUrl}/auth/session`, { headers: { cookie } })
    expect(await afterLogout.json()).toEqual({ session: null })
    const unauthenticatedProfile = await fetch(`${baseUrl}/profile`, { headers: { cookie } })
    expect(unauthenticatedProfile.status).toBe(401)
  })

  it('derives profile ownership from the session, not the request body', async () => {
    const { baseUrl, repository } = await createTestServer()
    const firstPair = KeyPair.generate()
    const secondPair = KeyPair.generate()
    const firstCookie = await authenticate(baseUrl, firstPair)
    const secondCookie = await authenticate(baseUrl, secondPair)

    await fetch(`${baseUrl}/profile`, {
      method: 'PUT',
      headers: { cookie: firstCookie, 'content-type': 'application/json' },
      body: JSON.stringify(profileDraft),
    })

    const secondProfile = await fetch(`${baseUrl}/profile`, {
      method: 'PUT',
      headers: { cookie: secondCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ ...profileDraft, displayName: 'Bola', userId: 'first-user' }),
    })
    expect(secondProfile.status).toBe(200)

    const profiles = [...repository.profiles.values()]
    expect(profiles).toHaveLength(2)
    expect(profiles.map((profile) => profile.displayName)).toEqual(['Amina', 'Bola'])
    expect(profiles[0].userId).not.toBe(profiles[1].userId)
  })
})
