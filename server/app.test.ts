// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { KeyPair } from '@nimiq/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createMunusServer } from './app'
import { MunusAuthService } from './authService'
import { InMemoryMunusRepository } from './repository'
import { createNimiqSignedMessageDigest } from './nimiqSignature'
import { InMemoryPlanningRepository } from './planningRepository'
import { InMemorySupportRepository } from './supportRepository'
import { InMemoryPaymentRepository } from './paymentRepository'
import { AirtimeFulfilmentService } from './airtimeFulfilment'
import { ClubKonnectAirtimeProvider } from './clubKonnect'

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

async function createTestServer(options: { staticDir?: string; airtimeFetch?: (url: string) => Promise<unknown>; airtimeRequests?: string[] } = {}) {
  const repository = new InMemoryMunusRepository()
  const planning = new InMemoryPlanningRepository()
  const support = new InMemorySupportRepository()
  const payment = new InMemoryPaymentRepository()
  const auth = new MunusAuthService(repository, {
    challengeTtlMs: 5 * 60 * 1000,
    sessionTtlMs: 24 * 60 * 60 * 1000,
  })
  const fulfilment = options.airtimeFetch
    ? new AirtimeFulfilmentService(
      payment,
      new ClubKonnectAirtimeProvider({
        credentials: { userId: 'fixture-user', apiKey: 'fixture-key' },
        fetchJson: async (url: string) => {
          options.airtimeRequests?.push(url)
          return options.airtimeFetch!(url)
        },
      }),
      { callbackBaseUrl: 'https://munus.example' },
    )
    : null
  const server = createMunusServer({
    repository,
    planning,
    support,
    payment,
    fulfilment,
    auth,
    staticDir: options.staticDir,
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

  return { baseUrl: `http://127.0.0.1:${address.port}`, repository, payment }
}

async function createPaidAirtimeOrder(baseUrl: string, cookie: string, payment: InMemoryPaymentRepository): Promise<string> {
  const created = await fetch(`${baseUrl}/payment-orders`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ serviceType: 'AIRTIME', paymentAsset: 'NIM', recipientPhone: '08012345678', recipientNetwork: 'MTN', requestedAmount: '1000' }),
  })
  const order = await created.json() as { id: string }
  // Test/admin fixture only: the NIM payment rail lands in P0-2B, so tests
  // promote the stored order to PAID directly instead of paying on-chain.
  const stored = payment.orders.get(order.id)
  if (!stored) throw new Error('Fixture order was not stored.')
  stored.paymentStatus = 'PAID'
  return order.id
}

async function authenticate(baseUrl: string, pair: KeyPair): Promise<string> {
  const walletAddress = pair.toAddress().toUserFriendlyAddress()
  const challengeResponse = await fetch(`${baseUrl}/auth/challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ walletAddress, network: 'mainnet' }),
  })
  const challenge = (await challengeResponse.json()) as { id: string; message: string }
  const signature = pair.sign(createNimiqSignedMessageDigest(challenge.message))
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

  it('returns a safe auth error code for an invalid challenge signature', async () => {
    const { baseUrl } = await createTestServer()
    const pair = KeyPair.generate()
    const walletAddress = pair.toAddress().toUserFriendlyAddress()
    const challengeResponse = await fetch(`${baseUrl}/auth/challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ walletAddress, network: 'mainnet' }),
    })
    const challenge = await challengeResponse.json() as { id: string; message: string }
    const invalidSignature = pair.sign(createNimiqSignedMessageDigest('not the challenge'))
    const verifyResponse = await fetch(`${baseUrl}/auth/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        challengeId: challenge.id,
        walletAddress,
        publicKey: pair.publicKey.toHex(),
        signature: invalidSignature.toHex(),
      }),
    })

    expect(verifyResponse.status).toBe(401)
    await expect(verifyResponse.json()).resolves.toEqual({
      code: 'AUTH_INVALID_SIGNATURE',
      error: 'Munus could not verify the Nimiq Pay signature.',
    })
  })

  it('serves the built app for root, deep links, and static assets', async () => {
    const staticDir = await mkdtemp(join(tmpdir(), 'munus-static-'))
    await writeFile(join(staticDir, 'index.html'), '<!doctype html><div id="root"></div>')
    await writeFile(join(staticDir, 'assets.js'), 'console.log("munus")')

    try {
      const { baseUrl } = await createTestServer({ staticDir })
      const root = await fetch(`${baseUrl}/`, { headers: { accept: 'text/html' } })
      expect(root.status).toBe(200)
      expect(root.headers.get('content-type')).toContain('text/html')
      expect(await root.text()).toContain('<div id="root"></div>')

      const deepLink = await fetch(`${baseUrl}/support`, { headers: { accept: 'text/html' } })
      expect(deepLink.status).toBe(200)
      expect(await deepLink.text()).toContain('<div id="root"></div>')

      const asset = await fetch(`${baseUrl}/assets.js`)
      expect(asset.status).toBe(200)
      expect(asset.headers.get('content-type')).toContain('text/javascript')
      expect(await asset.text()).toContain('munus')
    } finally {
      await rm(staticDir, { recursive: true, force: true })
    }
  })

  it('persists owned pocket, reminder, and spend-guard routes', async () => {
    const { baseUrl } = await createTestServer()
    const cookie = await authenticate(baseUrl, KeyPair.generate())
    const pocketResponse = await fetch(`${baseUrl}/pockets`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ ...profileDraft, name: 'Data plan', type: 'Data', unit: 'NGN', targetAmount: '1000', deadline: '' }),
    })
    expect(pocketResponse.status).toBe(201)
    const pocket = await pocketResponse.json() as { id: string; plannedAmount: string }

    const allocation = await fetch(`${baseUrl}/pockets/${pocket.id}/allocations`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ amount: '100.10', direction: 'allocation', note: 'First plan' }),
    })
    expect(await allocation.json()).toMatchObject({ pocket: { plannedAmount: '100.1' } })

    const reminder = await fetch(`${baseUrl}/reminders`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ linkedObjectType: 'pocket', linkedObjectId: pocket.id, title: 'Review data', dueAt: '2026-02-01T00:00:00.000Z', repeatRule: '' }),
    })
    expect(reminder.status).toBe(201)
    const reminderBody = await reminder.json() as { id: string }
    const markedDone = await fetch(`${baseUrl}/reminders/${reminderBody.id}`, {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    })
    expect(await markedDone.json()).toMatchObject({ status: 'done' })

    const rule = await fetch(`${baseUrl}/spend-rules`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ category: 'Data', limitAmount: '5000', unit: 'NGN', period: 'monthly', warningThreshold: 80, enabled: true }),
    })
    expect(rule.status).toBe(201)
    expect(await (await fetch(`${baseUrl}/pockets` , { headers: { cookie } })).json()).toMatchObject({ pockets: [{ plannedAmount: '100.1' }] })
  })

  it('keeps support contacts and requests reviewable without payment actions', async () => {
    const { baseUrl } = await createTestServer()
    const cookie = await authenticate(baseUrl, KeyPair.generate())
    const contactResponse = await fetch(`${baseUrl}/contacts`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'Mum', relationship: 'Parent', phone: '08012345678', network: 'MTN', usualProductType: 'Airtime', usualAmount: '1000', notes: '' }),
    })
    expect(contactResponse.status).toBe(201)
    const contact = await contactResponse.json() as { id: string }

    const requestResponse = await fetch(`${baseUrl}/support-requests`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ contactId: contact.id, category: 'Airtime', requestedAmount: '100', requestedProduct: 'Airtime for today', phone: '08012345678', network: 'MTN', message: 'Please help.' }),
    })
    expect(requestResponse.status).toBe(201)
    const createdRequest = await requestResponse.json() as { id: string; publicRequestId: string; status: string }
    expect(createdRequest.status).toBe('pending')

    const publicResponse = await fetch(`${baseUrl}/request/${createdRequest.publicRequestId}`)
    expect(publicResponse.status).toBe(200)
    expect(await publicResponse.json()).toEqual(expect.objectContaining({ requestedAmount: '100', phone: '080•••5678' }))
    expect(await (await fetch(`${baseUrl}/request/${createdRequest.publicRequestId}`)).json()).not.toHaveProperty('id')

    const approved = await fetch(`${baseUrl}/support-requests/${createdRequest.id}`, {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ contactId: contact.id, category: 'Airtime', requestedAmount: '100', requestedProduct: 'Airtime for today', phone: '08012345678', network: 'MTN', message: 'Please help.', status: 'approved' }),
    })
    expect(await approved.json()).toMatchObject({ status: 'approved' })

    const converted = await fetch(`${baseUrl}/support-requests/${createdRequest.id}/convert`, { method: 'POST', headers: { cookie } })
    expect(converted.status).toBe(201)
    expect(await converted.json()).toMatchObject({ source: 'request', amount: '100' })
    const requests = await (await fetch(`${baseUrl}/support-requests`, { headers: { cookie } })).json() as { supportRequests: Array<{ status: string }> }
    expect(requests.supportRequests[0].status).toBe('prepared')
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

  it('creates private airtime payment orders without quoting or paying', async () => {
    const { baseUrl } = await createTestServer()
    const firstCookie = await authenticate(baseUrl, KeyPair.generate())
    const secondCookie = await authenticate(baseUrl, KeyPair.generate())

    const created = await fetch(`${baseUrl}/payment-orders`, {
      method: 'POST',
      headers: { cookie: firstCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ serviceType: 'AIRTIME', paymentAsset: 'NIM', recipientPhone: '080 1234 5678', recipientNetwork: 'MTN', requestedAmount: '1000' }),
    })
    expect(created.status).toBe(201)
    const order = await created.json() as { id: string; recipientPhone: string; paymentStatus: string; fulfilmentStatus: string; quotedCryptoAmount?: string; walletTxRef?: string }
    expect(order).toMatchObject({ recipientPhone: '08012345678', paymentStatus: 'DRAFT', fulfilmentStatus: 'NOT_STARTED' })
    expect(order.quotedCryptoAmount).toBeUndefined()
    expect(order.walletTxRef).toBeUndefined()

    const listed = await (await fetch(`${baseUrl}/payment-orders`, { headers: { cookie: firstCookie } })).json() as { paymentOrders: Array<{ id: string }> }
    expect(listed.paymentOrders.map((entry) => entry.id)).toEqual([order.id])
    expect(await (await fetch(`${baseUrl}/payment-orders`, { headers: { cookie: secondCookie } })).json()).toEqual({ paymentOrders: [] })

    const loaded = await fetch(`${baseUrl}/payment-orders/${order.id}`, { headers: { cookie: firstCookie } })
    expect(loaded.status).toBe(200)
    const hidden = await fetch(`${baseUrl}/payment-orders/${order.id}`, { headers: { cookie: secondCookie } })
    expect(hidden.status).toBe(404)

    const invalid = await fetch(`${baseUrl}/payment-orders`, {
      method: 'POST',
      headers: { cookie: firstCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ serviceType: 'AIRTIME', paymentAsset: 'NIM', recipientPhone: '08012345678', requestedAmount: '0' }),
    })
    expect(invalid.status).toBe(400)

    const unauthenticated = await fetch(`${baseUrl}/payment-orders`)
    expect(unauthenticated.status).toBe(401)
  })

  it('refuses fulfilment while the provider is unconfigured', async () => {
    const { baseUrl, payment } = await createTestServer()
    const cookie = await authenticate(baseUrl, KeyPair.generate())
    const orderId = await createPaidAirtimeOrder(baseUrl, cookie, payment)

    const fulfil = await fetch(`${baseUrl}/payment-orders/${orderId}/fulfil`, { method: 'POST', headers: { cookie } })
    expect(fulfil.status).toBe(503)
    const callback = await fetch(`${baseUrl}/provider-callback/clubkonnect?requestid=x`)
    expect(callback.status).toBe(503)
  })

  it('fulfils only PAID airtime orders through the real provider adapter', async () => {
    const requestedUrls: string[] = []
    let queryResponse: unknown = {}
    const { baseUrl, payment } = await createTestServer({
      airtimeRequests: requestedUrls,
      airtimeFetch: async (url) => {
        if (url.includes('/APIQueryV1.asp')) return queryResponse
        return { orderid: 'ord-live', statuscode: '100', status: 'ORDER_RECEIVED' }
      },
    })
    const cookie = await authenticate(baseUrl, KeyPair.generate())
    const otherCookie = await authenticate(baseUrl, KeyPair.generate())

    const draft = await (await fetch(`${baseUrl}/payment-orders`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ serviceType: 'AIRTIME', paymentAsset: 'NIM', recipientPhone: '08012345678', recipientNetwork: 'MTN', requestedAmount: '1000' }),
    })).json() as { id: string }
    const refused = await fetch(`${baseUrl}/payment-orders/${draft.id}/fulfil`, { method: 'POST', headers: { cookie } })
    expect(refused.status).toBe(409)
    expect(requestedUrls).toHaveLength(0)

    const stored = payment.orders.get(draft.id)
    if (!stored) throw new Error('Fixture order was not stored.')
    stored.paymentStatus = 'PAID'

    const fulfilled = await fetch(`${baseUrl}/payment-orders/${draft.id}/fulfil`, { method: 'POST', headers: { cookie } })
    expect(fulfilled.status).toBe(200)
    const order = await fulfilled.json() as { paymentStatus: string; fulfilmentStatus: string; provider: string; providerRequestId: string; providerRef: string }
    expect(order).toMatchObject({ paymentStatus: 'PAID', fulfilmentStatus: 'FULFILLING', provider: 'clubkonnect', providerRef: 'ord-live' })
    expect(order.providerRequestId).toBe(draft.id.replace(/-/g, ''))
    expect(requestedUrls.some((url) => url.includes('/APIAirtimeV1.asp'))).toBe(true)
    const purchaseUrl = requestedUrls.find((url) => url.includes('/APIAirtimeV1.asp')) ?? ''
    expect(purchaseUrl).toContain('MobileNetwork=01')
    expect(purchaseUrl).toContain('Amount=1000')
    expect(purchaseUrl).toContain(`RequestID=${order.providerRequestId}`)

    const stranger = await fetch(`${baseUrl}/payment-orders/${draft.id}/fulfil`, { method: 'POST', headers: { cookie: otherCookie } })
    expect(stranger.status).toBe(404)
    const anonymous = await fetch(`${baseUrl}/payment-orders/${draft.id}/fulfil`, { method: 'POST' })
    expect(anonymous.status).toBe(401)

    queryResponse = {
      orderid: 'ord-live',
      requestid: order.providerRequestId,
      statuscode: '200',
      status: 'ORDER_COMPLETED',
      remark: 'Successful',
      amountcharged: '1000',
      walletbalance: '500000',
    }
    const reconciled = await fetch(`${baseUrl}/payment-orders/${draft.id}/reconcile`, { method: 'POST', headers: { cookie } })
    expect(reconciled.status).toBe(200)
    const delivered = await reconciled.json() as Record<string, unknown>
    expect(delivered).toMatchObject({ fulfilmentStatus: 'DELIVERED', providerStatusCode: '200', providerAmountCharged: '1000' })
    expect(delivered).not.toHaveProperty('walletbalance')
  })

  it('reconciles provider callbacks without trusting them', async () => {
    let queryCalls = 0
    let queryResponse: unknown = { orderid: 'ord-cb', statuscode: '100', status: 'ORDER_RECEIVED' }
    const { baseUrl, payment } = await createTestServer({
      airtimeFetch: async (url) => {
        if (!url.includes('/APIQueryV1.asp')) return { orderid: 'ord-cb', statuscode: '100', status: 'ORDER_RECEIVED' }
        queryCalls += 1
        return queryResponse
      },
    })
    const cookie = await authenticate(baseUrl, KeyPair.generate())
    const created = await (await fetch(`${baseUrl}/payment-orders`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ serviceType: 'AIRTIME', paymentAsset: 'NIM', recipientPhone: '08012345678', recipientNetwork: 'Glo', requestedAmount: '500' }),
    })).json() as { id: string }
    const stored = payment.orders.get(created.id)
    if (!stored) throw new Error('Fixture order was not stored.')
    stored.paymentStatus = 'PAID'
    await fetch(`${baseUrl}/payment-orders/${created.id}/fulfil`, { method: 'POST', headers: { cookie } })
    const requestId = payment.orders.get(created.id)?.providerRequestId ?? ''
    queryResponse = { orderid: 'ord-cb', statuscode: '200', status: 'ORDER_COMPLETED', remark: 'Successful', amountcharged: '500' }
    queryCalls = 0

    // A forged success claim still reconciles through a fresh provider query.
    const callback = await fetch(`${baseUrl}/provider-callback/clubkonnect?requestid=${requestId}&statuscode=200&orderstatus=ORDER_COMPLETED`)
    expect(callback.status).toBe(200)
    expect(await callback.json()).toEqual({ received: true, fulfilmentStatus: 'DELIVERED' })
    expect(queryCalls).toBe(1)

    // A duplicate callback is harmless.
    const duplicate = await fetch(`${baseUrl}/provider-callback/clubkonnect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderid: 'ord-cb', statuscode: '200' }),
    })
    expect(duplicate.status).toBe(200)
    expect(await duplicate.json()).toEqual({ received: true, fulfilmentStatus: 'DELIVERED' })

    // Unknown references mutate nothing and stay hidden behind a safe 404.
    const before = queryCalls
    const forged = await fetch(`${baseUrl}/provider-callback/clubkonnect?requestid=forged-reference`)
    expect(forged.status).toBe(404)
    expect(queryCalls).toBe(before)
    const missing = await fetch(`${baseUrl}/provider-callback/clubkonnect`)
    expect(missing.status).toBe(400)
  })
})
