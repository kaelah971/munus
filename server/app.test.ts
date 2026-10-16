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
import { ClubKonnectAirtimeProvider, ClubKonnectDataProvider } from './clubKonnect'
import type { DataBundleCatalogProvider } from './dataCatalog'
import { NimPaymentService } from './nimPayments'
import { CoinGeckoNimRateProvider } from './nimRates'
import type { NimiqChainReader } from './nimiqChain'
import { CashoutService } from './cashout'
import { PaycrestClient } from './paycrest'
import { InMemoryLiveStatsSource, LiveStatsService } from './liveStats'
import { InformativeRateService, InMemoryMarketRateStore } from './marketRates'

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

const TEST_NIM_RECEIVER = KeyPair.generate().toAddress().toUserFriendlyAddress()

function fixtureCatalog(): DataBundleCatalogProvider {
  const plans = [
    {
      providerPlanId: 'MTN-15',
      network: 'MTN' as const,
      displayName: '1.5GB - 7 days',
      dataAllowance: '1.5 GB',
      validity: '7 days',
      localPriceNgn: '350',
      available: true,
      provider: 'clubkonnect',
    },
  ]
  return {
    listNetworks: async () => [{ network: 'MTN' as const, label: 'MTN' }],
    listPlans: async () => plans,
  }
}

async function createTestServer(options: {
  staticDir?: string
  airtimeFetch?: (url: string) => Promise<unknown>
  airtimeRequests?: string[]
  dataFetch?: (url: string) => Promise<unknown>
  dataRequests?: string[]
  dataCatalog?: DataBundleCatalogProvider | null
  nimRateFetch?: (url: string) => Promise<unknown>
  nimChain?: NimiqChainReader | null
  nimReceiver?: string
  nimNetwork?: 'mainnet' | 'testnet'
  disableNimPayments?: boolean
  paycrestFetch?: (url: string, init: { method: string; body?: string }) => Promise<unknown>
  paycrestRequests?: Array<{ url: string; init: { method: string; body?: string } }>
  paycrestSecret?: string | null
  disableCashout?: boolean
  liveFlags?: { airtime?: boolean; data?: boolean; cashout?: boolean }
} = {}) {
  const repository = new InMemoryMunusRepository()
  const planning = new InMemoryPlanningRepository()
  const support = new InMemorySupportRepository()
  const payment = new InMemoryPaymentRepository()
  const auth = new MunusAuthService(repository, {
    challengeTtlMs: 5 * 60 * 1000,
    sessionTtlMs: 24 * 60 * 60 * 1000,
  })
  const fulfilment = options.airtimeFetch || options.dataFetch
    ? new AirtimeFulfilmentService(
      payment,
      {
        airtime: new ClubKonnectAirtimeProvider({
          credentials: { userId: 'fixture-user', apiKey: 'fixture-key' },
          fetchJson: async (url: string) => {
            options.airtimeRequests?.push(url)
            if (!options.airtimeFetch) throw new Error('No airtime fixture configured.')
            return options.airtimeFetch(url)
          },
        }),
        data: new ClubKonnectDataProvider({
          credentials: { userId: 'fixture-user', apiKey: 'fixture-key' },
          fetchJson: async (url: string) => {
            options.dataRequests?.push(url)
            if (!options.dataFetch) throw new Error('No data fixture configured.')
            return options.dataFetch(url)
          },
        }),
      },
      { callbackBaseUrl: 'https://munus.example' },
    )
    : null
  const rates = new CoinGeckoNimRateProvider(
    options.nimRateFetch ?? (async () => ({ 'nimiq-2': { ngn: 2000 } })),
  )
  const chain: NimiqChainReader | null = options.nimChain === undefined
    ? { getTransaction: async () => null, getHeadBlockNumber: async () => 1000, getAccountBalance: async () => { throw new Error('no account balance in fixture') } }
    : options.nimChain
  const nimPayments = options.disableNimPayments
    ? null
    : new NimPaymentService(payment, rates, chain, fulfilment, {
      receiverAddress: options.nimReceiver ?? TEST_NIM_RECEIVER,
      network: options.nimNetwork ?? 'mainnet',
      quoteTtlMs: 120_000,
    })
  const cashout = options.disableCashout
    ? null
    : new CashoutService(
      payment,
      new PaycrestClient({
        credentials: { apiKey: 'fixture-key', apiSecret: 'fixture-secret' },
        fetchJson: async (url, init) => {
          options.paycrestRequests?.push({ url, init })
          if (!options.paycrestFetch) throw new Error('No Paycrest fixture configured.')
          return options.paycrestFetch(url, init)
        },
      }),
      {
        network: 'mainnet',
        quoteTtlMs: 120_000,
        usdtContractAddress: `0x${'ab'.repeat(20)}`,
        refundAddress: `0x${'cd'.repeat(20)}`,
      },
    )
  const live = new LiveStatsService(new InMemoryLiveStatsSource({
    users: () => repository.users.values(),
    sessions: () => repository.sessions.values(),
    orders: () => payment.orders.values(),
    essentialRequests: () => support.essentialRequests.values(),
    supportRequests: () => support.supportRequests.values(),
  }))
  const informativeRatesStore = new InMemoryMarketRateStore()
  const informativeRates = new InformativeRateService({
    rates,
    store: informativeRatesStore,
    quoteTtlMs: 120_000,
  })
  const server = createMunusServer({
    repository,
    planning,
    support,
    payment,
    fulfilment,
    nimPayments,
    dataCatalog: options.dataCatalog ?? null,
    cashout,
    paycrestApiSecret: options.paycrestSecret === undefined
      ? 'fixture-secret'
      : options.paycrestSecret ?? undefined,
    live,
    informativeRates,
    auth,
    staticDir: options.staticDir,
    config: {
      cookieName: 'munus_test_session',
      cookieSecure: false,
      defaultNetwork: 'mainnet',
      nimPayments: nimPayments
        ? { receiverAddress: options.nimReceiver ?? TEST_NIM_RECEIVER, quoteTtlMs: 120_000 }
        : { quoteTtlMs: 120_000 },
      clubKonnect: options.airtimeFetch || options.dataFetch
        ? { userId: 'fixture-user', apiKey: 'fixture-key', callbackBaseUrl: 'https://munus.example' }
        : undefined,
      paycrest: options.disableCashout
        ? undefined
        : {
          apiKey: 'fixture-key',
          apiSecret: 'fixture-secret',
          refundAddress: `0x${'cd'.repeat(20)}`,
          usdtContractAddress: `0x${'ab'.repeat(20)}`,
        },
      live: {
        airtime: options.liveFlags?.airtime ?? false,
        data: options.liveFlags?.data ?? false,
        cashout: options.liveFlags?.cashout ?? false,
      },
    },
  })
  openServers.push(server)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not open a port.')

  return { baseUrl: `http://127.0.0.1:${address.port}`, repository, payment, support, marketRates: informativeRatesStore }
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

  it('resolves re-authentication to the existing user and returns the saved profile', async () => {
    const { baseUrl, repository } = await createTestServer()
    const pair = KeyPair.generate()
    const firstCookie = await authenticate(baseUrl, pair)
    const firstSession = (await (await fetch(`${baseUrl}/auth/session`, { headers: { cookie: firstCookie } })).json()) as { session: { userId: string } }
    await fetch(`${baseUrl}/profile`, {
      method: 'PUT',
      headers: { cookie: firstCookie, 'content-type': 'application/json' },
      body: JSON.stringify(profileDraft),
    })
    // Same signer authenticates again (new session, same canonical wallet).
    const secondCookie = await authenticate(baseUrl, pair)
    const secondSession = (await (await fetch(`${baseUrl}/auth/session`, { headers: { cookie: secondCookie } })).json()) as { session: { userId: string } }
    expect(secondSession.session.userId).toBe(firstSession.session.userId)
    const loaded = await fetch(`${baseUrl}/profile`, { headers: { cookie: secondCookie } })
    expect(loaded.status).toBe(200)
    await expect(loaded.json()).resolves.toMatchObject({ displayName: 'Amina' })
    expect([...repository.users.values()]).toHaveLength(1)
    expect([...repository.profiles.values()]).toHaveLength(1)
  })

  it('keeps profile saves idempotent and isolated per session user', async () => {
    const { baseUrl } = await createTestServer()
    const cookie = await authenticate(baseUrl, KeyPair.generate())
    const stranger = await authenticate(baseUrl, KeyPair.generate())
    for (const displayName of ['Amina', 'Amina', 'Amina J']) {
      const saved = await fetch(`${baseUrl}/profile`, {
        method: 'PUT',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ ...profileDraft, displayName }),
      })
      expect(saved.status).toBe(200)
    }
    const loaded = (await (await fetch(`${baseUrl}/profile`, { headers: { cookie } })).json()) as { displayName: string }
    expect(loaded.displayName).toBe('Amina J')
    // An unrelated session sees no profile of its own and cannot read another's.
    expect((await fetch(`${baseUrl}/profile`, { headers: { cookie: stranger } })).status).toBe(404)
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

  it('quotes airtime from a live rate and binds the wallet intent', async () => {
    const { baseUrl } = await createTestServer()
    const pair = KeyPair.generate()
    const cookie = await authenticate(baseUrl, pair)
    const otherCookie = await authenticate(baseUrl, KeyPair.generate())

    const draft = await (await fetch(`${baseUrl}/payment-orders`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ serviceType: 'AIRTIME', paymentAsset: 'NIM', recipientPhone: '08012345678', recipientNetwork: 'MTN', requestedAmount: '1000' }),
    })).json() as { id: string }

    const quoted = await fetch(`${baseUrl}/payment-orders/${draft.id}/quote`, { method: 'POST', headers: { cookie } })
    expect(quoted.status).toBe(200)
    const order = await quoted.json() as Record<string, unknown>
    expect(order).toMatchObject({
      paymentStatus: 'READY_FOR_PAYMENT',
      quotedCryptoAmount: '0.5',
      quoteLunaAmount: '50000',
      quoteRateNgnPerNim: '2000',
      paymentNetwork: 'mainnet',
      paymentReceiver: TEST_NIM_RECEIVER,
    })
    expect(order.paymentMemo).toMatch(/^MNS:[0-9a-f]{12}$/)

    const intent = await fetch(`${baseUrl}/payment-orders/${draft.id}/payment-intent`, { method: 'POST', headers: { cookie } })
    expect(intent.status).toBe(200)
    const body = await intent.json() as { order: { paymentStatus: string }; intent: Record<string, string> }
    expect(body.order.paymentStatus).toBe('AWAITING_WALLET_APPROVAL')
    expect(body.intent).toMatchObject({ receiver: TEST_NIM_RECEIVER, lunaAmount: '50000', network: 'mainnet' })
    expect(body.intent.memo).toBe(order.paymentMemo)

    const stranger = await fetch(`${baseUrl}/payment-orders/${draft.id}/quote`, { method: 'POST', headers: { cookie: otherCookie } })
    expect(stranger.status).toBe(404)
    const anonymous = await fetch(`${baseUrl}/payment-orders/${draft.id}/quote`, { method: 'POST' })
    expect(anonymous.status).toBe(401)
  })

  it('fails closed when pricing is unavailable or payments unconfigured', async () => {
    const failing = await createTestServer({ nimRateFetch: async () => { throw new Error('rate down') } })
    const cookie = await authenticate(failing.baseUrl, KeyPair.generate())
    const draft = await (await fetch(`${failing.baseUrl}/payment-orders`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ serviceType: 'AIRTIME', paymentAsset: 'NIM', recipientPhone: '08012345678', recipientNetwork: 'MTN', requestedAmount: '1000' }),
    })).json() as { id: string }
    const quote = await fetch(`${failing.baseUrl}/payment-orders/${draft.id}/quote`, { method: 'POST', headers: { cookie } })
    expect(quote.status).toBe(502)
    const untouched = await (await fetch(`${failing.baseUrl}/payment-orders/${draft.id}`, { headers: { cookie } })).json() as { paymentStatus: string }
    expect(untouched.paymentStatus).toBe('DRAFT')

    const off = await createTestServer({ disableNimPayments: true })
    const offCookie = await authenticate(off.baseUrl, KeyPair.generate())
    const offDraft = await (await fetch(`${off.baseUrl}/payment-orders`, {
      method: 'POST',
      headers: { cookie: offCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ serviceType: 'AIRTIME', paymentAsset: 'NIM', recipientPhone: '08012345678', recipientNetwork: 'MTN', requestedAmount: '1000' }),
    })).json() as { id: string }
    expect(await (await fetch(`${off.baseUrl}/payment-orders/${offDraft.id}/quote`, { method: 'POST', headers: { cookie: offCookie } })).status).toBe(503)
  })

  it('serves the session wallet balance from confirmed RPC with no address parameter', async () => {
    const queried: string[] = []
    const pair = KeyPair.generate()
    const walletAddress = pair.toAddress().toUserFriendlyAddress()
    const { baseUrl } = await createTestServer({
      nimChain: {
        getTransaction: async () => null,
        getHeadBlockNumber: async () => 1000,
        getAccountBalance: async (address: string) => {
          queried.push(address)
          return '22100000'
        },
      },
    })
    expect((await fetch(`${baseUrl}/wallet/nim-balance`)).status).toBe(401)
    const cookie = await authenticate(baseUrl, pair)
    // A client-supplied address is ignored: only the session wallet is read.
    const response = await fetch(`${baseUrl}/wallet/nim-balance?address=NQ00OTHER`, { headers: { cookie } })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      balanceLuna: '22100000',
      balanceNim: '221',
      network: 'mainnet',
      source: 'rpc',
    })
    expect(queried).toEqual([walletAddress])

    const failing = await createTestServer({
      nimChain: {
        getTransaction: async () => null,
        getHeadBlockNumber: async () => 1000,
        getAccountBalance: async () => { throw new Error('rpc down') },
      },
    })
    const failingCookie = await authenticate(failing.baseUrl, KeyPair.generate())
    expect((await fetch(`${failing.baseUrl}/wallet/nim-balance`, { headers: { cookie: failingCookie } })).status).toBe(503)

    const off = await createTestServer({ disableNimPayments: true })
    const offCookie = await authenticate(off.baseUrl, KeyPair.generate())
    expect((await fetch(`${off.baseUrl}/wallet/nim-balance`, { headers: { cookie: offCookie } })).status).toBe(503)
  })

  it('balances host-exposed addresses without echoing full addresses', async () => {
    const addrA = KeyPair.generate().toAddress().toUserFriendlyAddress()
    const addrB = KeyPair.generate().toAddress().toUserFriendlyAddress()
    const { baseUrl } = await createTestServer({
      nimChain: {
        getTransaction: async () => null,
        getHeadBlockNumber: async () => 1000,
        getAccountBalance: async (address: string) => (address === addrA ? '22100000' : '500'),
      },
    })
    expect((await fetch(`${baseUrl}/wallet/account-balances`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ addresses: [addrA] }),
    })).status).toBe(401)
    const cookie = await authenticate(baseUrl, KeyPair.generate())
    const post = (body: unknown) => fetch(`${baseUrl}/wallet/account-balances`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const response = await post({ addresses: [addrA, addrB] })
    expect(response.status).toBe(200)
    const report = (await response.json()) as {
      accounts: Array<{ suffix: string; ok: boolean; balanceLuna?: string; balanceNim?: string }>
      aggregateLuna: string
      aggregateNim: string
      okCount: number
    }
    expect(report.accounts).toHaveLength(2)
    expect(report).toMatchObject({ aggregateLuna: '22100500', aggregateNim: '221.005', okCount: 2 })
    expect(JSON.stringify(report)).not.toContain(addrA)
    expect(JSON.stringify(report)).not.toContain(addrB)
    expect((await post({ addresses: [] })).status).toBe(400)
    expect((await post({ addresses: 'nope' })).status).toBe(400)
  })

  it('serves an indicative NIM rate for balance display without quoting', async () => {
    const { baseUrl } = await createTestServer()
    expect((await fetch(`${baseUrl}/nim/rate`)).status).toBe(401)
    const cookie = await authenticate(baseUrl, KeyPair.generate())
    const response = await fetch(`${baseUrl}/nim/rate`, { headers: { cookie } })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { ngnPerNim: string; source: string; asOf: string; expiresAt: string; freshness: string }
    expect(body.ngnPerNim).toBe('2000')
    expect(body.source).toContain('coingecko')
    expect(body.freshness).toBe('fresh')
    expect(Date.parse(body.asOf)).toBeGreaterThan(0)
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.parse(body.asOf))
    expect(JSON.stringify(body)).not.toMatch(/receiver|memo|luna|private/i)

    const failing = await createTestServer({ nimRateFetch: async () => { throw new Error('rate down') } })
    const failingCookie = await authenticate(failing.baseUrl, KeyPair.generate())
    expect((await fetch(`${failing.baseUrl}/nim/rate`, { headers: { cookie: failingCookie } })).status).toBe(502)

    const off = await createTestServer({ disableNimPayments: true })
    const offCookie = await authenticate(off.baseUrl, KeyPair.generate())
    expect((await fetch(`${off.baseUrl}/nim/rate`, { headers: { cookie: offCookie } })).status).toBe(503)
  })

  it('serves the global informational rate publicly without any session', async () => {
    const { baseUrl } = await createTestServer()
    // No cookie at all: global market data must not depend on auth.
    const response = await fetch(`${baseUrl}/public/rates/nim-ngn`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('public')
    expect(response.headers.get('cache-control')).toContain('max-age=30')
    const body = (await response.json()) as { ngnPerNim: string; source: string; asOf: string; expiresAt: string; freshness: string }
    expect(body.ngnPerNim).toBe('2000')
    expect(body.source).toContain('coingecko')
    expect(body.freshness).toBe('fresh')
    expect(Date.parse(body.asOf)).toBeGreaterThan(0)
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.parse(body.asOf))
    expect(JSON.stringify(body)).not.toMatch(/receiver|memo|luna|private|session|wallet/i)
    // The authenticated endpoint keeps its session gate; payment quote
    // endpoints are untouched by the public informational route.
    expect((await fetch(`${baseUrl}/nim/rate`)).status).toBe(401)
  })

  it('serves the same public durable rate to every session without quoting', async () => {
    const observedAt = new Date(Date.now() - 10 * 60_000).toISOString()
    const { baseUrl, marketRates } = await createTestServer({ nimRateFetch: async () => { throw new Error('rate down') } })
    await marketRates.writeRate({
      asset: 'NIM',
      quoteCurrency: 'NGN',
      rate: '0.410829',
      source: 'coingecko:nimiq-2/ngn',
      observedAt,
    })
    // Two different users, no shared state: identical global rate.
    const cookieA = await authenticate(baseUrl, KeyPair.generate())
    const cookieB = await authenticate(baseUrl, KeyPair.generate())
    const [anon, authedA, authedB] = await Promise.all([
      fetch(`${baseUrl}/public/rates/nim-ngn`).then((r) => r.json()),
      fetch(`${baseUrl}/public/rates/nim-ngn`, { headers: { cookie: cookieA } }).then((r) => r.json()),
      fetch(`${baseUrl}/nim/rate`, { headers: { cookie: cookieB } }).then((r) => r.json()),
    ])
    expect(anon).toMatchObject({ ngnPerNim: '0.410829', asOf: observedAt, freshness: 'recent' })
    expect(authedA).toMatchObject({ ngnPerNim: '0.410829', asOf: observedAt, freshness: 'recent' })
    expect(authedB).toMatchObject({ ngnPerNim: '0.410829', asOf: observedAt, freshness: 'recent' })
  })

  it('serves a recent durable rate when upstream fails, preserving its age', async () => {
    const observedAt = new Date(Date.now() - 10 * 60_000).toISOString()
    const { baseUrl, marketRates } = await createTestServer({ nimRateFetch: async () => { throw new Error('rate down') } })
    const cookie = await authenticate(baseUrl, KeyPair.generate())
    // Nothing durable yet: honest 502, never fabricated.
    expect((await fetch(`${baseUrl}/nim/rate`, { headers: { cookie } })).status).toBe(502)
    await marketRates.writeRate({
      asset: 'NIM',
      quoteCurrency: 'NGN',
      rate: '0.410829',
      source: 'coingecko:nimiq-2/ngn',
      observedAt,
    })
    const response = await fetch(`${baseUrl}/nim/rate`, { headers: { cookie } })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { ngnPerNim: string; asOf: string; freshness: string }
    expect(body).toMatchObject({ ngnPerNim: '0.410829', asOf: observedAt, freshness: 'recent' })
    expect(JSON.stringify(body)).not.toMatch(/receiver|memo|luna|NQ|fixture|secret|http/i)
  })

  it('settles verified wallet payments to PAID and hands off fulfilment once', async () => {
    const chainSender = KeyPair.generate().toAddress().toUserFriendlyAddress()
    const txHash = 'ab'.repeat(32)
    let chainTx: Record<string, unknown> | null = null
    const requestedUrls: string[] = []
    const queryResponse: unknown = {}
    const { baseUrl, payment } = await createTestServer({
      airtimeRequests: requestedUrls,
      airtimeFetch: async (url) => {
        if (url.includes('/APIQueryV1.asp')) return queryResponse
        return { orderid: 'ord-nim', statuscode: '100', status: 'ORDER_RECEIVED' }
      },
      nimChain: {
        getTransaction: async () => chainTx as never,
        getHeadBlockNumber: async () => 1000,
        getAccountBalance: async () => { throw new Error('no account balance in fixture') },      },
    })
    const pair = KeyPair.generate()
    const cookie = await authenticate(baseUrl, pair)
    const draft = await (await fetch(`${baseUrl}/payment-orders`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ serviceType: 'AIRTIME', paymentAsset: 'NIM', recipientPhone: '08012345678', recipientNetwork: 'MTN', requestedAmount: '1000' }),
    })).json() as { id: string }
    const quoted = await (await fetch(`${baseUrl}/payment-orders/${draft.id}/quote`, { method: 'POST', headers: { cookie } })).json() as { paymentMemo: string }

    // Unknown chain state stays pending without fulfilment.
    const submitted = await fetch(`${baseUrl}/payment-orders/${draft.id}/payment-submission`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ transactionHash: txHash }),
    })
    expect(submitted.status).toBe(200)
    expect(await submitted.json()).toMatchObject({ paymentStatus: 'ONCHAIN_PENDING', walletTxRef: txHash })
    expect(requestedUrls.some((url) => url.includes('/APIAirtimeV1.asp'))).toBe(false)

    // Chain evidence settles the same submission exactly once.
    chainTx = {
      hash: txHash,
      from: chainSender,
      to: TEST_NIM_RECEIVER,
      valueLuna: '50000',
      networkId: 42,
      blockNumber: 990,
      confirmations: 10,
      dataFields: [quoted.paymentMemo],
    }
    const reconciled = await fetch(`${baseUrl}/payment-orders/${draft.id}/reconcile-payment`, { method: 'POST', headers: { cookie } })
    expect(reconciled.status).toBe(200)
    const paid = await reconciled.json() as Record<string, unknown>
    expect(paid).toMatchObject({
      paymentStatus: 'PAID',
      paymentSender: chainSender,
      paymentBlockNumber: '990',
      fulfilmentStatus: 'FULFILLING',
    })
    expect(paid.paymentSender).not.toBe(pair.toAddress().toUserFriendlyAddress())
    const purchases = requestedUrls.filter((url) => url.includes('/APIAirtimeV1.asp'))
    expect(purchases).toHaveLength(1)

    // Repeating the same hash is harmless and never re-spends.
    const repeated = await fetch(`${baseUrl}/payment-orders/${draft.id}/payment-submission`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ transactionHash: txHash }),
    })
    expect(repeated.status).toBe(200)
    expect(await repeated.json()).toMatchObject({ paymentStatus: 'PAID' })
    expect(requestedUrls.filter((url) => url.includes('/APIAirtimeV1.asp'))).toHaveLength(1)
    void payment
  })

  it('fails mismatched chain payments and keeps testnet away from providers', async () => {
    const txHash = 'cd'.repeat(32)
    const chainTx: Record<string, unknown> = {
      hash: txHash,
      from: KeyPair.generate().toAddress().toUserFriendlyAddress(),
      to: TEST_NIM_RECEIVER,
      valueLuna: '49999',
      networkId: 42,
      blockNumber: 990,
      confirmations: 5,
      dataFields: ['MNS:whatevermemo'],
    }
    const requestedUrls: string[] = []
    const { baseUrl } = await createTestServer({
      airtimeRequests: requestedUrls,
      airtimeFetch: async () => ({ orderid: 'x', statuscode: '100', status: 'ORDER_RECEIVED' }),
      nimChain: {
        getTransaction: async () => chainTx as never,
        getHeadBlockNumber: async () => 1000,
        getAccountBalance: async () => { throw new Error('no account balance in fixture') },      },
    })
    const cookie = await authenticate(baseUrl, KeyPair.generate())
    const draft = await (await fetch(`${baseUrl}/payment-orders`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ serviceType: 'AIRTIME', paymentAsset: 'NIM', recipientPhone: '08012345678', recipientNetwork: 'MTN', requestedAmount: '1000' }),
    })).json() as { id: string }
    await fetch(`${baseUrl}/payment-orders/${draft.id}/quote`, { method: 'POST', headers: { cookie } })
    const settled = await fetch(`${baseUrl}/payment-orders/${draft.id}/payment-submission`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ transactionHash: txHash }),
    })
    expect(await settled.json()).toMatchObject({ paymentStatus: 'PAYMENT_FAILED', paymentFailureReason: 'wrong-amount' })
    expect(requestedUrls).toHaveLength(0)

    const badHash = await fetch(`${baseUrl}/payment-orders/${draft.id}/payment-submission`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ transactionHash: 'nope' }),
    })
    expect(badHash.status).toBe(400)

    // A testnet payment verifies to PAID yet never touches provider funds.
    let testTx: Record<string, unknown> | null = null
    const testnetUrls: string[] = []
    const testnet = await createTestServer({
      nimNetwork: 'testnet',
      airtimeRequests: testnetUrls,
      airtimeFetch: async () => ({ orderid: 'ord-test', statuscode: '100', status: 'ORDER_RECEIVED' }),
      nimChain: {
        getTransaction: async () => testTx as never,
        getHeadBlockNumber: async () => 100,
        getAccountBalance: async () => { throw new Error('no account balance in fixture') },      },
    })
    const testCookie = await authenticate(testnet.baseUrl, KeyPair.generate())
    const testDraft = await (await fetch(`${testnet.baseUrl}/payment-orders`, {
      method: 'POST',
      headers: { cookie: testCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ serviceType: 'AIRTIME', paymentAsset: 'NIM', recipientPhone: '08012345678', recipientNetwork: 'MTN', requestedAmount: '1000' }),
    })).json() as { id: string }
    const testQuoted = await (await fetch(`${testnet.baseUrl}/payment-orders/${testDraft.id}/quote`, { method: 'POST', headers: { cookie: testCookie } })).json() as { paymentMemo: string; paymentNetwork: string }
    expect(testQuoted.paymentNetwork).toBe('testnet')
    const testHash = 'ef'.repeat(32)
    testTx = {
      hash: testHash,
      from: KeyPair.generate().toAddress().toUserFriendlyAddress(),
      to: TEST_NIM_RECEIVER,
      valueLuna: '50000',
      blockNumber: 50,
      confirmations: 2,
      dataFields: [testQuoted.paymentMemo],
    }
    const testPaid = await fetch(`${testnet.baseUrl}/payment-orders/${testDraft.id}/payment-submission`, {
      method: 'POST',
      headers: { cookie: testCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ transactionHash: testHash }),
    })
    expect(testPaid.status).toBe(200)
    expect(await testPaid.json()).toMatchObject({ paymentStatus: 'PAID', fulfilmentStatus: 'NOT_STARTED' })
    expect(testnetUrls).toHaveLength(0)
  })

  it('serves a normalized data catalog and fails closed without one', async () => {
    const { baseUrl } = await createTestServer({ dataCatalog: fixtureCatalog() })
    const cookie = await authenticate(baseUrl, KeyPair.generate())

    const networks = await fetch(`${baseUrl}/data-networks`, { headers: { cookie } })
    expect(networks.status).toBe(200)
    expect(await networks.json()).toEqual({
      networks: [{ network: 'MTN', label: 'MTN' }],
    })

    const plans = await fetch(`${baseUrl}/data-plans?network=MTN`, { headers: { cookie } })
    expect(plans.status).toBe(200)
    const catalogBody = await plans.json() as { network: string; plans: Array<Record<string, unknown>> }
    expect(catalogBody.network).toBe('MTN')
    expect(catalogBody.plans).toHaveLength(1)
    expect(catalogBody.plans[0]).toMatchObject({
      providerPlanId: 'MTN-15',
      displayName: '1.5GB - 7 days',
      localPriceNgn: '350',
    })
    expect(JSON.stringify(catalogBody)).not.toContain('fixture-key')

    expect((await fetch(`${baseUrl}/data-plans?network=Starlink`, { headers: { cookie } })).status).toBe(400)
    expect((await fetch(`${baseUrl}/data-networks`)).status).toBe(401)

    const bare = await createTestServer()
    const bareCookie = await authenticate(bare.baseUrl, KeyPair.generate())
    expect((await fetch(`${bare.baseUrl}/data-networks`, { headers: { cookie: bareCookie } })).status).toBe(503)
    expect((await fetch(`${bare.baseUrl}/data-plans?network=MTN`, { headers: { cookie: bareCookie } })).status).toBe(503)
  })

  it('creates data orders pinned to the catalog price', async () => {
    const { baseUrl, payment } = await createTestServer({ dataCatalog: fixtureCatalog() })
    const cookie = await authenticate(baseUrl, KeyPair.generate())
    const otherCookie = await authenticate(baseUrl, KeyPair.generate())

    const created = await fetch(`${baseUrl}/payment-orders`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ serviceType: 'DATA', providerPlanId: 'MTN-15', recipientPhone: '08012345678', recipientNetwork: 'MTN', requestedAmount: '1' }),
    })
    expect(created.status).toBe(201)
    const order = await created.json() as Record<string, unknown>
    // The client-supplied ₦1 is ignored: the catalog price wins.
    expect(order).toMatchObject({
      serviceType: 'DATA',
      requestedAmount: '350',
      providerPlanId: 'MTN-15',
      planDisplayLabel: '1.5GB - 7 days',
      planDataAllowance: '1.5 GB',
      planValidity: '7 days',
      paymentStatus: 'DRAFT',
    })
    void payment

    const hidden = await fetch(`${baseUrl}/payment-orders/${order.id}`, { headers: { cookie: otherCookie } })
    expect(hidden.status).toBe(404)

    const gone = await fetch(`${baseUrl}/payment-orders`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ serviceType: 'DATA', providerPlanId: 'MTN-GONE', recipientPhone: '08012345678', recipientNetwork: 'MTN' }),
    })
    expect(gone.status).toBe(404)

    const missing = await fetch(`${baseUrl}/payment-orders`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ serviceType: 'DATA', recipientPhone: '08012345678', recipientNetwork: 'MTN' }),
    })
    expect(missing.status).toBe(400)
  })

  it('runs a data order end to end without repurchasing', async () => {
    const dataRequests: string[] = []
    let queryResponse: unknown = {}
    let chainTx: Record<string, unknown> | null = null
    const txHash = 'ab'.repeat(32)
    const chainSender = KeyPair.generate().toAddress().toUserFriendlyAddress()
    const { baseUrl } = await createTestServer({
      dataCatalog: fixtureCatalog(),
      dataRequests,
      dataFetch: async (url) => {
        if (url.includes('/APIQueryV1.asp')) return queryResponse
        return { orderid: 'ord-data-9', statuscode: '100', status: 'ORDER_RECEIVED' }
      },
      nimChain: {
        getTransaction: async () => chainTx as never,
        getHeadBlockNumber: async () => 1000,
        getAccountBalance: async () => { throw new Error('no account balance in fixture') },      },
    })
    const cookie = await authenticate(baseUrl, KeyPair.generate())
    const draft = await (await fetch(`${baseUrl}/payment-orders`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ serviceType: 'DATA', providerPlanId: 'MTN-15', recipientPhone: '08012345678', recipientNetwork: 'MTN' }),
    })).json() as { id: string }

    const quoted = await (await fetch(`${baseUrl}/payment-orders/${draft.id}/quote`, { method: 'POST', headers: { cookie } })).json() as {
      quoteLunaAmount: string
      paymentMemo: string
      quotedCryptoAmount: string
    }
    expect(quoted.quoteLunaAmount).toBe('17500')
    expect(quoted.quotedCryptoAmount).toBe('0.175')

    await fetch(`${baseUrl}/payment-orders/${draft.id}/payment-intent`, { method: 'POST', headers: { cookie } })
    chainTx = {
      hash: txHash,
      from: chainSender,
      to: TEST_NIM_RECEIVER,
      valueLuna: '17500',
      networkId: 42,
      blockNumber: 990,
      confirmations: 10,
      dataFields: [quoted.paymentMemo],
    }
    const settled = await fetch(`${baseUrl}/payment-orders/${draft.id}/payment-submission`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ transactionHash: txHash }),
    })
    expect(settled.status).toBe(200)
    const paid = await settled.json() as Record<string, unknown>
    expect(paid).toMatchObject({ paymentStatus: 'PAID', fulfilmentStatus: 'FULFILLING', providerRef: 'ord-data-9' })
    const purchaseUrl = dataRequests.find((url) => url.includes('/APIDatabundleV1.asp')) ?? ''
    expect(purchaseUrl).toContain('DataPlan=MTN-15')
    expect(purchaseUrl).toContain('MobileNetwork=01')
    expect(purchaseUrl).not.toContain('Amount=')

    queryResponse = {
      orderid: 'ord-data-9',
      statuscode: '200',
      status: 'ORDER_COMPLETED',
      amountcharged: '320',
    }
    const reconciled = await fetch(`${baseUrl}/payment-orders/${draft.id}/reconcile`, { method: 'POST', headers: { cookie } })
    expect(await reconciled.json()).toMatchObject({ fulfilmentStatus: 'DELIVERED', providerAmountCharged: '320' })
    expect(dataRequests.filter((url) => url.includes('/APIDatabundleV1.asp'))).toHaveLength(1)

    // The shared callback reconciles data orders without trusting payloads.
    const callback = await fetch(`${baseUrl}/provider-callback/clubkonnect?orderid=ord-data-9&statuscode=200`)
    expect(callback.status).toBe(200)
    expect(await callback.json()).toEqual({ received: true, fulfilmentStatus: 'DELIVERED' })
    expect(dataRequests.filter((url) => url.includes('/APIDatabundleV1.asp'))).toHaveLength(1)
  })

  it('keeps testnet data payments away from provider funds', async () => {
    const dataRequests: string[] = []
    let chainTx: Record<string, unknown> | null = null
    const txHash = 'ef'.repeat(32)
    const { baseUrl } = await createTestServer({
      nimNetwork: 'testnet',
      dataCatalog: fixtureCatalog(),
      dataRequests,
      dataFetch: async () => ({ orderid: 'ord-test', statuscode: '100', status: 'ORDER_RECEIVED' }),
      nimChain: {
        getTransaction: async () => chainTx as never,
        getHeadBlockNumber: async () => 100,
        getAccountBalance: async () => { throw new Error('no account balance in fixture') },      },
    })
    const cookie = await authenticate(baseUrl, KeyPair.generate())
    const draft = await (await fetch(`${baseUrl}/payment-orders`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ serviceType: 'DATA', providerPlanId: 'MTN-15', recipientPhone: '08012345678', recipientNetwork: 'MTN' }),
    })).json() as { id: string }
    const quoted = await (await fetch(`${baseUrl}/payment-orders/${draft.id}/quote`, { method: 'POST', headers: { cookie } })).json() as { paymentMemo: string }
    chainTx = {
      hash: txHash,
      from: KeyPair.generate().toAddress().toUserFriendlyAddress(),
      to: TEST_NIM_RECEIVER,
      valueLuna: '17500',
      blockNumber: 50,
      confirmations: 2,
      dataFields: [quoted.paymentMemo],
    }
    const submitted = await fetch(`${baseUrl}/payment-orders/${draft.id}/payment-submission`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ transactionHash: txHash }),
    })
    expect(await submitted.json()).toMatchObject({ paymentStatus: 'PAID', fulfilmentStatus: 'NOT_STARTED' })
    expect(dataRequests).toHaveLength(0)
  })

  it('creates essential airtime and data needs with server snapshots', async () => {
    const { baseUrl } = await createTestServer({ dataCatalog: fixtureCatalog() })
    const cookie = await authenticate(baseUrl, KeyPair.generate())

    const airtime = await fetch(`${baseUrl}/essential-requests`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ serviceType: 'AIRTIME', network: 'MTN', recipientPhone: '08012345678', requestedAmount: '1000', message: 'Need airtime for work' }),
    })
    expect(airtime.status).toBe(201)
    const airtimeBody = await airtime.json() as Record<string, unknown>
    expect(airtimeBody).toMatchObject({ serviceType: 'AIRTIME', requestedAmount: '1000', essentialStatus: 'OPEN' })
    expect(typeof airtimeBody.publicRequestId).toBe('string')

    const data = await fetch(`${baseUrl}/essential-requests`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ serviceType: 'DATA', network: 'MTN', recipientPhone: '08012345678', providerPlanId: 'MTN-15', requestedAmount: '1' }),
    })
    expect(data.status).toBe(201)
    const dataBody = await data.json() as Record<string, unknown>
    expect(dataBody).toMatchObject({
      serviceType: 'DATA',
      requestedAmount: '350',
      providerPlanId: 'MTN-15',
      planDisplayLabel: '1.5GB - 7 days',
    })

    const gone = await fetch(`${baseUrl}/essential-requests`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ serviceType: 'DATA', network: 'MTN', recipientPhone: '08012345678', providerPlanId: 'MTN-GONE' }),
    })
    expect(gone.status).toBe(404)

    const listed = await (await fetch(`${baseUrl}/essential-requests`, { headers: { cookie } })).json() as { essentialRequests: unknown[] }
    expect(listed.essentialRequests).toHaveLength(2)

    const stranger = await authenticate(baseUrl, KeyPair.generate())
    const hidden = await fetch(`${baseUrl}/essential-requests/${airtimeBody.id}`, { headers: { cookie: stranger } })
    expect(hidden.status).toBe(404)
    const anonymous = await fetch(`${baseUrl}/essential-requests`)
    expect(anonymous.status).toBe(401)
  })

  it('exposes only a privacy-safe public projection', async () => {
    const { baseUrl } = await createTestServer({ dataCatalog: fixtureCatalog() })
    const cookie = await authenticate(baseUrl, KeyPair.generate())
    const created = await (await fetch(`${baseUrl}/essential-requests`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ serviceType: 'AIRTIME', network: 'MTN', recipientPhone: '08012345678', requestedAmount: '1000', message: 'Need airtime for work' }),
    })).json() as { publicRequestId: string }

    const response = await fetch(`${baseUrl}/request/${created.publicRequestId}`, { headers: { accept: 'application/json' } })
    expect(response.status).toBe(200)
    const body = await response.json() as Record<string, unknown>
    expect(body).toMatchObject({
      requesterLabel: expect.any(String),
      serviceType: 'AIRTIME',
      requestedAmount: '1000',
      recipientMasked: '080•••5678',
      essentialStatus: 'OPEN',
    })
    const serialized = JSON.stringify(body)
    for (const secret of ['08012345678', 'userId', 'walletAddress', 'payment_order_id', 'provider_ref', 'APIKey']) {
      expect(serialized).not.toContain(secret)
    }
    expect(await (await fetch(`${baseUrl}/request/does-not-exist`, { headers: { accept: 'application/json' } })).status).toBe(404)
  })

  it('claims once: payer owns the order, requester cannot read it', async () => {
    const { baseUrl, payment } = await createTestServer({ dataCatalog: fixtureCatalog() })
    const requester = await authenticate(baseUrl, KeyPair.generate())
    const payer = await authenticate(baseUrl, KeyPair.generate())
    const created = await (await fetch(`${baseUrl}/essential-requests`, {
      method: 'POST',
      headers: { cookie: requester, 'content-type': 'application/json' },
      body: JSON.stringify({ serviceType: 'AIRTIME', network: 'MTN', recipientPhone: '08012345678', requestedAmount: '1000' }),
    })).json() as { id: string; publicRequestId: string }

    const claim = await fetch(`${baseUrl}/request/${created.publicRequestId}/claim`, { method: 'POST', headers: { cookie: payer } })
    expect(claim.status).toBe(201)
    const claimed = await claim.json() as { order: Record<string, unknown>; request: Record<string, unknown> }
    expect(claimed.order).toMatchObject({ serviceType: 'AIRTIME', requestedAmount: '1000', essentialRequestId: created.id })
    expect(claimed.request).toMatchObject({ essentialStatus: 'PAYMENT_IN_PROGRESS' })
    expect(JSON.stringify(claimed.request)).not.toContain('08012345678')

    const stored = payment.orders.get(String(claimed.order.id))
    expect(stored?.userId).not.toBe(undefined)
    const requesterRead = await fetch(`${baseUrl}/payment-orders/${claimed.order.id}`, { headers: { cookie: requester } })
    expect(requesterRead.status).toBe(404)

    const rival = await authenticate(baseUrl, KeyPair.generate())
    const second = await fetch(`${baseUrl}/request/${created.publicRequestId}/claim`, { method: 'POST', headers: { cookie: rival } })
    expect(second.status).toBe(409)
    expect(await second.json()).toMatchObject({ error: expect.stringContaining('already being paid') })

    const anonymous = await fetch(`${baseUrl}/request/${created.publicRequestId}/claim`, { method: 'POST' })
    expect(anonymous.status).toBe(401)

    const dataNeed = await (await fetch(`${baseUrl}/essential-requests`, {
      method: 'POST',
      headers: { cookie: requester, 'content-type': 'application/json' },
      body: JSON.stringify({ serviceType: 'DATA', network: 'MTN', recipientPhone: '08012345678', providerPlanId: 'MTN-15' }),
    })).json() as { publicRequestId: string }
    const dataClaim = await fetch(`${baseUrl}/request/${dataNeed.publicRequestId}/claim`, { method: 'POST', headers: { cookie: payer } })
    expect(dataClaim.status).toBe(201)
    const dataClaimed = await dataClaim.json() as { order: Record<string, unknown> }
    expect(dataClaimed.order).toMatchObject({
      serviceType: 'DATA',
      requestedAmount: '350',
      providerPlanId: 'MTN-15',
      planDisplayLabel: '1.5GB - 7 days',
    })
  })

  it('syncs paid and delivered orders into request completion', async () => {
    const requestedUrls: string[] = []
    let queryResponse: unknown = {}
    const { baseUrl, payment } = await createTestServer({
      dataCatalog: fixtureCatalog(),
      airtimeRequests: requestedUrls,
      airtimeFetch: async (url) => {
        if (url.includes('/APIQueryV1.asp')) return queryResponse
        return { orderid: 'ord-need', statuscode: '100', status: 'ORDER_RECEIVED' }
      },
    })
    const requester = await authenticate(baseUrl, KeyPair.generate())
    const payer = await authenticate(baseUrl, KeyPair.generate())
    const created = await (await fetch(`${baseUrl}/essential-requests`, {
      method: 'POST',
      headers: { cookie: requester, 'content-type': 'application/json' },
      body: JSON.stringify({ serviceType: 'AIRTIME', network: 'MTN', recipientPhone: '08012345678', requestedAmount: '1000' }),
    })).json() as { id: string; publicRequestId: string }
    const claimed = await (await fetch(`${baseUrl}/request/${created.publicRequestId}/claim`, { method: 'POST', headers: { cookie: payer } })).json() as { order: { id: string } }

    const stored = payment.orders.get(claimed.order.id)
    if (!stored) throw new Error('Fixture order was not stored.')
    stored.paymentStatus = 'PAID'
    const syncedPaid = await (await fetch(`${baseUrl}/essential-requests/${created.id}/sync`, { method: 'POST', headers: { cookie: requester } })).json() as Record<string, unknown>
    expect(syncedPaid).toMatchObject({ essentialStatus: 'PAID' })
    expect(JSON.stringify(syncedPaid)).not.toContain('08012345678')

    const fulfilled = await fetch(`${baseUrl}/payment-orders/${claimed.order.id}/fulfil`, { method: 'POST', headers: { cookie: payer } })
    expect(fulfilled.status).toBe(200)
    queryResponse = { orderid: 'ord-need', statuscode: '200', status: 'ORDER_COMPLETED' }
    await fetch(`${baseUrl}/payment-orders/${claimed.order.id}/reconcile`, { method: 'POST', headers: { cookie: payer } })
    const syncedDone = await (await fetch(`${baseUrl}/essential-requests/${created.id}/sync`, { method: 'POST', headers: { cookie: requester } })).json() as Record<string, unknown>
    expect(syncedDone).toMatchObject({ essentialStatus: 'COMPLETED' })
    expect(typeof syncedDone.fulfilledAt).toBe('string')
    expect(requestedUrls.filter((url) => url.includes('/APIAirtimeV1.asp'))).toHaveLength(1)

    // Completed requests cannot be paid or cancelled again.
    const again = await fetch(`${baseUrl}/request/${created.publicRequestId}/claim`, { method: 'POST', headers: { cookie: payer } })
    expect(again.status).toBe(409)
    const cancelled = await fetch(`${baseUrl}/essential-requests/${created.id}/cancel`, { method: 'POST', headers: { cookie: requester } })
    expect(cancelled.status).toBe(409)

    // The shared URL stays useful and privacy-safe after completion.
    const completed = await (await fetch(`${baseUrl}/request/${created.publicRequestId}`, { headers: { accept: 'application/json' } })).json() as Record<string, unknown>
    expect(completed).toMatchObject({ essentialStatus: 'COMPLETED' })
    expect(JSON.stringify(completed)).not.toContain('08012345678')
  })

  it('cancels open needs but never verified payments, and flags failed delivery', async () => {
    const { baseUrl, payment } = await createTestServer({ dataCatalog: fixtureCatalog() })
    const requester = await authenticate(baseUrl, KeyPair.generate())
    const payer = await authenticate(baseUrl, KeyPair.generate())
    const created = await (await fetch(`${baseUrl}/essential-requests`, {
      method: 'POST',
      headers: { cookie: requester, 'content-type': 'application/json' },
      body: JSON.stringify({ serviceType: 'AIRTIME', network: 'MTN', recipientPhone: '08012345678', requestedAmount: '1000' }),
    })).json() as { id: string; publicRequestId: string }

    const cancelled = await fetch(`${baseUrl}/essential-requests/${created.id}/cancel`, { method: 'POST', headers: { cookie: requester } })
    expect(cancelled.status).toBe(200)
    expect(await cancelled.json()).toMatchObject({ essentialStatus: 'CANCELLED' })
    const dead = await fetch(`${baseUrl}/request/${created.publicRequestId}/claim`, { method: 'POST', headers: { cookie: payer } })
    expect(dead.status).toBe(409)

    const second = await (await fetch(`${baseUrl}/essential-requests`, {
      method: 'POST',
      headers: { cookie: requester, 'content-type': 'application/json' },
      body: JSON.stringify({ serviceType: 'AIRTIME', network: 'MTN', recipientPhone: '08012345678', requestedAmount: '1000' }),
    })).json() as { id: string; publicRequestId: string }
    const claimed = await (await fetch(`${baseUrl}/request/${second.publicRequestId}/claim`, { method: 'POST', headers: { cookie: payer } })).json() as { order: { id: string } }
    const stored = payment.orders.get(claimed.order.id)
    if (!stored) throw new Error('Fixture order was not stored.')
    stored.paymentStatus = 'PAID'
    stored.fulfilmentStatus = 'RECOVERY_REQUIRED'
    const synced = await (await fetch(`${baseUrl}/essential-requests/${second.id}/sync`, { method: 'POST', headers: { cookie: requester } })).json() as Record<string, unknown>
    expect(synced).toMatchObject({ essentialStatus: 'NEEDS_ATTENTION' })
    const blocked = await fetch(`${baseUrl}/essential-requests/${second.id}/cancel`, { method: 'POST', headers: { cookie: requester } })
    expect(blocked.status).toBe(409)
  })

  it('pays a need end to end with a distinct chain sender', async () => {
    const requestedUrls: string[] = []
    let queryResponse: unknown = {}
    let chainTx: Record<string, unknown> | null = null
    const txHash = 'ab'.repeat(32)
    const chainSender = KeyPair.generate().toAddress().toUserFriendlyAddress()
    const { baseUrl } = await createTestServer({
      dataCatalog: fixtureCatalog(),
      airtimeRequests: requestedUrls,
      airtimeFetch: async (url) => {
        if (url.includes('/APIQueryV1.asp')) return queryResponse
        return { orderid: 'ord-need', statuscode: '100', status: 'ORDER_RECEIVED' }
      },
      nimChain: {
        getTransaction: async () => chainTx as never,
        getHeadBlockNumber: async () => 1000,
        getAccountBalance: async () => { throw new Error('no account balance in fixture') },      },
    })
    const requesterPair = KeyPair.generate()
    const payerPair = KeyPair.generate()
    const requester = await authenticate(baseUrl, requesterPair)
    const payer = await authenticate(baseUrl, payerPair)
    const created = await (await fetch(`${baseUrl}/essential-requests`, {
      method: 'POST',
      headers: { cookie: requester, 'content-type': 'application/json' },
      body: JSON.stringify({ serviceType: 'AIRTIME', network: 'MTN', recipientPhone: '08012345678', requestedAmount: '1000' }),
    })).json() as { id: string; publicRequestId: string }

    // Payer claims, quotes, and approves through the existing rail.
    const claimed = await (await fetch(`${baseUrl}/request/${created.publicRequestId}/claim`, { method: 'POST', headers: { cookie: payer } })).json() as { order: { id: string } }
    const quoted = await (await fetch(`${baseUrl}/payment-orders/${claimed.order.id}/quote`, { method: 'POST', headers: { cookie: payer } })).json() as { paymentMemo: string; quoteLunaAmount: string }
    expect(quoted.quoteLunaAmount).toBe('50000')
    await fetch(`${baseUrl}/payment-orders/${claimed.order.id}/payment-intent`, { method: 'POST', headers: { cookie: payer } })
    chainTx = {
      hash: txHash,
      from: chainSender,
      to: TEST_NIM_RECEIVER,
      valueLuna: '50000',
      networkId: 42,
      blockNumber: 990,
      confirmations: 10,
      dataFields: [quoted.paymentMemo],
    }
    const submitted = await fetch(`${baseUrl}/payment-orders/${claimed.order.id}/payment-submission`, {
      method: 'POST',
      headers: { cookie: payer, 'content-type': 'application/json' },
      body: JSON.stringify({ transactionHash: txHash }),
    })
    expect(submitted.status).toBe(200)
    // Chain sender is canonical payer evidence: neither requester nor payer wallet.
    const verified = await submitted.json() as Record<string, unknown>
    expect(verified).toMatchObject({ paymentStatus: 'PAID', paymentSender: chainSender })
    expect(chainSender).not.toBe(requesterPair.toAddress().toUserFriendlyAddress())
    expect(chainSender).not.toBe(payerPair.toAddress().toUserFriendlyAddress())

    // The payment rail auto-handed off to fulfilment; sync observes it.
    const synced = await (await fetch(`${baseUrl}/essential-requests/${created.id}/sync`, { method: 'POST', headers: { cookie: requester } })).json() as Record<string, unknown>
    expect(synced).toMatchObject({ essentialStatus: 'FULFILLING' })

    await fetch(`${baseUrl}/payment-orders/${claimed.order.id}/fulfil`, { method: 'POST', headers: { cookie: payer } })
    queryResponse = { orderid: 'ord-need', statuscode: '200', status: 'ORDER_COMPLETED' }
    await fetch(`${baseUrl}/payment-orders/${claimed.order.id}/reconcile`, { method: 'POST', headers: { cookie: payer } })
    const done = await (await fetch(`${baseUrl}/essential-requests/${created.id}/sync`, { method: 'POST', headers: { cookie: payer } })).json() as Record<string, unknown>
    expect(done).toMatchObject({ essentialStatus: 'COMPLETED' })
    expect(requestedUrls.filter((url) => url.includes('/APIAirtimeV1.asp'))).toHaveLength(1)
  })

  it('keeps essential rows out of legacy support-request flows', async () => {
    const { baseUrl } = await createTestServer({ dataCatalog: fixtureCatalog() })
    const cookie = await authenticate(baseUrl, KeyPair.generate())
    await fetch(`${baseUrl}/essential-requests`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ serviceType: 'AIRTIME', network: 'MTN', recipientPhone: '08012345678', requestedAmount: '1000' }),
    })
    const listed = await (await fetch(`${baseUrl}/support-requests`, { headers: { cookie } })).json() as { supportRequests: unknown[] }
    expect(listed.supportRequests).toEqual([])
  })

  it('retries failed delivery with the same provider reference, never a new purchase', async () => {
    const requestedUrls: string[] = []
    let queryResponse: unknown = { statuscode: '400', status: 'ORDER_FAILED' }
    const { baseUrl, payment } = await createTestServer({
      airtimeRequests: requestedUrls,
      airtimeFetch: async (url: string) => {
        if (url.includes('/APIQueryV1.asp')) return queryResponse
        return { orderid: 'ord-retry', statuscode: '100', status: 'ORDER_RECEIVED' }
      },
    })
    const cookie = await authenticate(baseUrl, KeyPair.generate())
    const stranger = await authenticate(baseUrl, KeyPair.generate())
    const orderId = await createPaidAirtimeOrder(baseUrl, cookie, payment)
    await fetch(`${baseUrl}/payment-orders/${orderId}/fulfil`, { method: 'POST', headers: { cookie } })
    await fetch(`${baseUrl}/payment-orders/${orderId}/reconcile`, { method: 'POST', headers: { cookie } })
    const failed = await payment.orders.get(orderId)
    expect(failed?.fulfilmentStatus).toBe('FULFILLMENT_FAILED')
    const requestId = failed?.providerRequestId
    expect(requestId).toBeTruthy()

    // Still failing upstream: evidence refreshes, nothing is repurchased.
    const purchasesBefore = requestedUrls.filter((url) => url.includes('/APIAirtimeV1.asp')).length
    const retried = await fetch(`${baseUrl}/payment-orders/${orderId}/recovery/retry`, { method: 'POST', headers: { cookie } })
    expect(retried.status).toBe(200)
    expect(await retried.json()).toMatchObject({ fulfilmentStatus: 'FULFILLMENT_FAILED' })
    expect(requestedUrls.filter((url) => url.includes('/APIAirtimeV1.asp'))).toHaveLength(purchasesBefore)

    // Provider never saw it: one purchase with the identical RequestID.
    queryResponse = {}
    const repurchased = await fetch(`${baseUrl}/payment-orders/${orderId}/recovery/retry`, { method: 'POST', headers: { cookie } })
    expect(repurchased.status).toBe(200)
    const repurchasedBody = await repurchased.json() as Record<string, unknown>
    expect(repurchasedBody).toMatchObject({ fulfilmentStatus: 'FULFILLING', providerRequestId: requestId })
    const purchaseUrls = requestedUrls.filter((url) => url.includes('/APIAirtimeV1.asp'))
    expect(purchaseUrls).toHaveLength(purchasesBefore + 1)
    expect(purchaseUrls[purchaseUrls.length - 1]).toContain(`RequestID=${requestId}`)

    // Ownership and state guards hold.
    expect((await fetch(`${baseUrl}/payment-orders/${orderId}/recovery/retry`, { method: 'POST', headers: { cookie: stranger } })).status).toBe(404)
    expect((await fetch(`${baseUrl}/payment-orders/${orderId}/recovery/retry`, { method: 'POST' })).status).toBe(401)
    expect((await fetch(`${baseUrl}/payment-orders/does-not-exist/recovery/retry`, { method: 'POST', headers: { cookie } })).status).toBe(404)
  })

  it('refuses retry while delivery is in progress', async () => {
    const { baseUrl, payment } = await createTestServer({
      airtimeFetch: async (url: string) => {
        if (url.includes('/APIQueryV1.asp')) return {}
        return { orderid: 'ord-live', statuscode: '100', status: 'ORDER_RECEIVED' }
      },
    })
    const cookie = await authenticate(baseUrl, KeyPair.generate())
    const orderId = await createPaidAirtimeOrder(baseUrl, cookie, payment)
    await fetch(`${baseUrl}/payment-orders/${orderId}/fulfil`, { method: 'POST', headers: { cookie } })
    const retry = await fetch(`${baseUrl}/payment-orders/${orderId}/recovery/retry`, { method: 'POST', headers: { cookie } })
    expect(retry.status).toBe(409)
  })
})

describe('USDT cash out', () => {
  const RECEIVER = `0x${'dd'.repeat(20)}`

  function cashoutFetch(state: { status: string; validUntil?: string }) {
    return async (url: string) => {
      if (url.includes('/institutions/NGN')) return [{ code: 'GTB', name: 'GTBank' }]
      if (url.includes('/verify-account')) return { data: 'ADA OKAFOR' }
      if (url.includes('/v2/rates/')) return { rate: 1500 }
      if (url.includes('/sender/orders/')) return { id: 'pc-1', status: state.status }
      return {
        id: 'pc-1',
        receiveAddress: RECEIVER,
        validUntil: state.validUntil ?? new Date(Date.now() + 600_000).toISOString(),
        amount: '100',
        senderFee: '1',
        transactionFee: '0.5',
        totalAmount: '101.5',
        destination: { amount: '152250' },
        status: 'initiated',
      }
    }
  }

  async function createReadyOrder(baseUrl: string, cookie: string) {
    const created = await fetch(`${baseUrl}/cashout/orders`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ usdtAmount: '100.00', bankCode: 'GTB', accountNumber: '0123 456 789' }),
    })
    expect(created.status).toBe(201)
    const order = (await created.json()) as { id: string }
    const quoted = await fetch(`${baseUrl}/cashout/${order.id}/quote`, { method: 'POST', headers: { cookie } })
    expect(quoted.status).toBe(200)
    return (await quoted.json()) as { id: string; quotedCryptoAmount: string; payoutNgnAmount: string; providerRef: string }
  }

  it('is disabled truthfully without configuration', async () => {
    const { baseUrl } = await createTestServer({ disableCashout: true })
    const cookie = await authenticate(baseUrl, KeyPair.generate())
    expect((await fetch(`${baseUrl}/cashout/banks`, { headers: { cookie } })).status).toBe(503)
    expect((await fetch(`${baseUrl}/cashout/rate?amount=100`, { headers: { cookie } })).status).toBe(503)
    expect((await fetch(`${baseUrl}/cashout/verify-account`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' })).status).toBe(503)
    expect((await fetch(`${baseUrl}/cashout/orders`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' })).status).toBe(503)
  })

  it('requires a session and routes generic creation to the cash-out flow', async () => {
    const { baseUrl } = await createTestServer({ paycrestFetch: cashoutFetch({ status: 'initiated' }) })
    expect((await fetch(`${baseUrl}/cashout/banks`)).status).toBe(401)
    const cookie = await authenticate(baseUrl, KeyPair.generate())
    const generic = await fetch(`${baseUrl}/payment-orders`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ serviceType: 'CASH_OUT', paymentAsset: 'USDT' }),
    })
    expect(generic.status).toBe(400)
    await expect(generic.json()).resolves.toMatchObject({ error: expect.stringContaining('cash-out flow') })
  })

  it('walks the full cash-out loop with server-signed payout details', async () => {
    const state = { status: 'initiated' }
    const { baseUrl } = await createTestServer({ paycrestFetch: cashoutFetch(state) })
    const cookie = await authenticate(baseUrl, KeyPair.generate())

    const banks = await fetch(`${baseUrl}/cashout/banks`, { headers: { cookie } })
    await expect(banks.json()).resolves.toEqual({ banks: [{ code: 'GTB', name: 'GTBank' }] })

    const rate = await fetch(`${baseUrl}/cashout/rate?amount=100`, { headers: { cookie } })
    await expect(rate.json()).resolves.toMatchObject({ usdtAmount: '100', rateNgnPerUsdt: '1500', source: 'paycrest' })

    const verified = await fetch(`${baseUrl}/cashout/verify-account`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ institution: 'GTB', accountNumber: '0123 456 789' }),
    })
    await expect(verified.json()).resolves.toEqual({
      bankCode: 'GTB', bankName: 'GTBank', accountNumber: '0123456789', accountName: 'ADA OKAFOR',
    })

    const order = await createReadyOrder(baseUrl, cookie)
    expect(order).toMatchObject({
      quotedCryptoAmount: '101.5',
      payoutNgnAmount: '152250',
      providerRef: 'pc-1',
    })

    const intentResponse = await fetch(`${baseUrl}/cashout/${order.id}/intent`, { method: 'POST', headers: { cookie } })
    const { order: fresh, intent } = (await intentResponse.json()) as {
      order: { id: string }
      intent: { receiveAddress: string; totalBaseUnits: string; chainIdHex: string; contractAddress: string; quoteExpiresAt: string }
    }
    expect(fresh.id).toBe(order.id)
    expect(intent).toMatchObject({
      receiveAddress: RECEIVER,
      totalBaseUnits: '101500000',
      chainIdHex: '0x89',
      contractAddress: `0x${'ab'.repeat(20)}`,
    })
    expect(typeof intent.quoteExpiresAt).toBe('string')

    // The wallet owns the transfer: no intent exists until the client asks,
    // and only an explicit submission binds a hash.
    const before = (await (await fetch(`${baseUrl}/payment-orders/${order.id}`, { headers: { cookie } })).json()) as { walletTxRef?: string | null }
    expect(before.walletTxRef ?? null).toBeNull()

    const hash = `0x${'ab'.repeat(32)}`
    const submitted = await fetch(`${baseUrl}/cashout/${order.id}/submit`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ transactionHash: hash }),
    })
    expect(submitted.status).toBe(200)
    await expect(submitted.json()).resolves.toMatchObject({ paymentStatus: 'ONCHAIN_PENDING' })

    state.status = 'settled'
    const reconciled = await fetch(`${baseUrl}/cashout/${order.id}/reconcile`, { method: 'POST', headers: { cookie } })
    await expect(reconciled.json()).resolves.toMatchObject({
      paymentStatus: 'PAID',
      fulfilmentStatus: 'DELIVERED',
      usdtTotalAmount: '101.5',
    })
  })

  it('rejects invalid, conflicting, and expired submissions', async () => {
    const state = { status: 'initiated' }
    const { baseUrl } = await createTestServer({ paycrestFetch: cashoutFetch(state) })
    const cookie = await authenticate(baseUrl, KeyPair.generate())
    const order = await createReadyOrder(baseUrl, cookie)

    const invalid = await fetch(`${baseUrl}/cashout/${order.id}/submit`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ transactionHash: 'not-a-hash' }),
    })
    expect(invalid.status).toBe(400)

    const hash = `0x${'ab'.repeat(32)}`
    expect((await fetch(`${baseUrl}/cashout/${order.id}/submit`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ transactionHash: hash }),
    })).status).toBe(200)
    const conflict = await fetch(`${baseUrl}/cashout/${order.id}/submit`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ transactionHash: `0x${'cd'.repeat(32)}` }),
    })
    expect(conflict.status).toBe(409)
    // Idempotent retry of the same hash stays retryable.
    expect((await fetch(`${baseUrl}/cashout/${order.id}/submit`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ transactionHash: hash }),
    })).status).toBe(200)
  })

  it('refuses to pay expired payout details', async () => {
    const { baseUrl } = await createTestServer({
      paycrestFetch: cashoutFetch({ status: 'expired', validUntil: new Date(Date.now() - 60_000).toISOString() }),
    })
    const cookie = await authenticate(baseUrl, KeyPair.generate())
    const created = await fetch(`${baseUrl}/cashout/orders`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ usdtAmount: '100', bankCode: 'GTB', accountNumber: '0123456789' }),
    })
    expect(created.status).toBe(201)
    const order = (await created.json()) as { id: string }
    expect((await fetch(`${baseUrl}/cashout/${order.id}/quote`, { method: 'POST', headers: { cookie } })).status).toBe(200)
    const expired = await fetch(`${baseUrl}/cashout/${order.id}/submit`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ transactionHash: `0x${'ab'.repeat(32)}` }),
    })
    expect(expired.status).toBe(410)
  })

  it('verifies Paycrest webhooks before trusting them', async () => {
    const crypto = await import('node:crypto')
    const state = { status: 'initiated' }
    const { baseUrl } = await createTestServer({ paycrestFetch: cashoutFetch(state) })
    const cookie = await authenticate(baseUrl, KeyPair.generate())
    const order = await createReadyOrder(baseUrl, cookie)
    const hash = `0x${'ab'.repeat(32)}`
    await fetch(`${baseUrl}/cashout/${order.id}/submit`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ transactionHash: hash }),
    })

    const payload = JSON.stringify({ id: 'pc-1', status: 'settled' })
    const sign = (body: string, secret: string) => crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')
    const unsigned = await fetch(`${baseUrl}/paycrest/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
    })
    expect(unsigned.status).toBe(401)
    const forged = await fetch(`${baseUrl}/paycrest/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-paycrest-signature': sign(payload, 'wrong-secret') },
      body: payload,
    })
    expect(forged.status).toBe(401)
    const accepted = await fetch(`${baseUrl}/paycrest/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-paycrest-signature': sign(payload, 'fixture-secret') },
      body: payload,
    })
    await expect(accepted.json()).resolves.toEqual({ received: true, fulfilmentStatus: 'DELIVERED' })
    // Duplicate deliveries are idempotent.
    const duplicate = await fetch(`${baseUrl}/paycrest/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-paycrest-signature': sign(payload, 'fixture-secret') },
      body: payload,
    })
    await expect(duplicate.json()).resolves.toEqual({ received: true, fulfilmentStatus: 'DELIVERED' })

    const unknownPayload = JSON.stringify({ id: 'pc-nope', status: 'settled' })
    const unknown = await fetch(`${baseUrl}/paycrest/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-paycrest-signature': sign(unknownPayload, 'fixture-secret') },
      body: unknownPayload,
    })
    expect(unknown.status).toBe(404)
  })
})

describe('Munus Live public proof', () => {
  async function seedDeliveredOrder(
    baseUrl: string,
    cookie: string,
    payment: InMemoryPaymentRepository,
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const created = await fetch(`${baseUrl}/payment-orders`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ serviceType: 'AIRTIME', paymentAsset: 'NIM', recipientPhone: '08012345678', recipientNetwork: 'MTN', requestedAmount: '1000' }),
    })
    expect(created.status).toBe(201)
    const order = (await created.json()) as { id: string }
    const stored = payment.orders.get(order.id)
    if (!stored) throw new Error('Fixture order was not stored.')
    Object.assign(stored, {
      paymentStatus: 'PAID',
      fulfilmentStatus: 'DELIVERED',
      paymentNetwork: 'mainnet',
      paymentVerifiedAt: '2026-10-14T12:05:00.000Z',
      fulfilledAt: '2026-10-14T12:06:00.000Z',
      quoteLunaAmount: '50000',
      quotedCryptoAmount: '0.5',
      ...overrides,
    })
    return order.id
  }

  it('serves zero-state proof without authentication while private APIs stay protected', async () => {
    const { baseUrl } = await createTestServer()
    expect((await fetch(`${baseUrl}/payment-orders`)).status).toBe(401)
    const live = await fetch(`${baseUrl}/public/live`)
    expect(live.status).toBe(200)
    await expect(live.json()).resolves.toEqual({
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
      updatedAt: expect.any(String),
    })
  })

  it('counts only verified production evidence with masked wallets', async () => {
    const { baseUrl, repository, payment, support } = await createTestServer()
    const pair = KeyPair.generate()
    const walletAddress = pair.toAddress().toUserFriendlyAddress()
    await authenticate(baseUrl, pair)
    await authenticate(baseUrl, pair)
    const cookie = await authenticate(baseUrl, KeyPair.generate())

    const deliveredId = await seedDeliveredOrder(baseUrl, cookie, payment)
    await seedDeliveredOrder(baseUrl, cookie, payment, { paymentNetwork: 'testnet' })
    await seedDeliveredOrder(baseUrl, cookie, payment, {
      paymentStatus: 'READY_FOR_PAYMENT',
      fulfilmentStatus: 'NOT_STARTED',
    })

    const owner = [...repository.users.values()].find((user) => user.walletAddress === walletAddress)
    if (!owner) throw new Error('Fixture user was not stored.')
    const now = '2026-10-14T12:00:00.000Z'
    support.essentialRequests.set('req-live', {
      id: 'req-live',
      ownerUserId: owner.id,
      publicRequestId: 'public-live',
      serviceType: 'DATA',
      network: 'Airtel',
      requestedAmount: '350',
      planDataAllowance: '5 GB',
      planDisplayLabel: '5GB - 30 days',
      recipientPhone: '08098765432',
      essentialStatus: 'COMPLETED',
      paymentOrderId: deliveredId,
      fulfilledAt: '2026-10-14T11:00:00.000Z',
      expiresAt: '2026-10-21T12:00:00.000Z',
      createdAt: '2026-10-14T10:00:00.000Z',
      updatedAt: now,
    })

    const live = await fetch(`${baseUrl}/public/live`)
    expect(live.status).toBe(200)
    const snapshot = (await live.json()) as {
      metrics: Record<string, unknown>
      recentActivity: Array<Record<string, unknown>>
    }
    // Two wallets authenticated; one wallet's duplicate sessions count once.
    expect(snapshot.metrics).toMatchObject({
      verifiedWallets: 2,
      activeUsers7d: 2,
      deliveredEssentials: 1,
      nimUsed: '0.5',
      nimPayments: 1,
      requestsCompleted: 1,
    })
    const kinds = snapshot.recentActivity.map((event) => event.kind)
    expect(kinds).toContain('airtime-delivered')
    expect(kinds).toContain('request-completed')
    expect(kinds).toContain('wallet-joined')
    const serialized = JSON.stringify(snapshot)
    expect(serialized).not.toContain('08012345678')
    expect(serialized).not.toContain(walletAddress)
    const compact = walletAddress.replace(/\s+/g, '')
    expect(serialized).toContain(`${compact.slice(0, 4)}…${compact.slice(-4)}`)
  })
})

describe('activation preflight readiness', () => {
  it('uses the identical session gate as every other private endpoint', async () => {
    const { baseUrl } = await createTestServer()
    // No cookie: readiness and a known-working endpoint agree on 401.
    expect((await fetch(`${baseUrl}/readiness`)).status).toBe(401)
    expect((await fetch(`${baseUrl}/payment-orders`)).status).toBe(401)
    const cookie = await authenticate(baseUrl, KeyPair.generate())
    // Same cookie: both agree on 200. No separate auth path exists.
    expect((await fetch(`${baseUrl}/readiness`, { headers: { cookie } })).status).toBe(200)
    expect((await fetch(`${baseUrl}/payment-orders`, { headers: { cookie } })).status).toBe(200)
  })

  it('keeps session cookie protection attributes intact', async () => {
    const { baseUrl } = await createTestServer()
    const pair = KeyPair.generate()
    const walletAddress = pair.toAddress().toUserFriendlyAddress()
    const challenge = (await (await fetch(`${baseUrl}/auth/challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ walletAddress, network: 'mainnet' }),
    })).json()) as { id: string; message: string }
    const verifyResponse = await fetch(`${baseUrl}/auth/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        challengeId: challenge.id,
        walletAddress,
        publicKey: pair.publicKey.toHex(),
        signature: pair.sign(createNimiqSignedMessageDigest(challenge.message)).toHex(),
      }),
    })
    expect(verifyResponse.status).toBe(200)
    const setCookie = verifyResponse.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('Path=/')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')
    expect(setCookie).not.toMatch(/Domain=/i)
  })

  it('serves an indicative NIM rate with no order or secrets attached', async () => {
    const { baseUrl } = await createTestServer()
    expect((await fetch(`${baseUrl}/nim/rate`)).status).toBe(401)
    const cookie = await authenticate(baseUrl, KeyPair.generate())
    const response = await fetch(`${baseUrl}/nim/rate`, { headers: { cookie } })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { ngnPerNim: string; source: string; asOf: string; expiresAt: string; freshness: string }
    expect(body.ngnPerNim).toBe('2000')
    expect(body.source).toBe('coingecko:nimiq-2/ngn')
    expect(body.freshness).toBe('fresh')
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.parse(body.asOf))
    expect(JSON.stringify(body)).not.toMatch(/receiver|memo|luna|NQ|fixture/i)

    const down = await createTestServer({ nimRateFetch: async () => { throw new Error('rate down') } })
    const downCookie = await authenticate(down.baseUrl, KeyPair.generate())
    expect((await fetch(`${down.baseUrl}/nim/rate`, { headers: { cookie: downCookie } })).status).toBe(502)

    const off = await createTestServer({ disableNimPayments: true })
    const offCookie = await authenticate(off.baseUrl, KeyPair.generate())
    expect((await fetch(`${off.baseUrl}/nim/rate`, { headers: { cookie: offCookie } })).status).toBe(503)
  })

  it('requires a session and leaks no secrets', async () => {
    const { baseUrl } = await createTestServer()
    expect((await fetch(`${baseUrl}/readiness`)).status).toBe(401)
    const cookie = await authenticate(baseUrl, KeyPair.generate())
    const response = await fetch(`${baseUrl}/readiness`, { headers: { cookie } })
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.network).toBe('mainnet')
    expect(body.database).toBe('ready')
    const serialized = JSON.stringify(body)
    expect(serialized).not.toMatch(/key|secret|http|NQ|0x|postgres|fixture/i)
  })

  it('reflects effective wiring without attestation by default', async () => {
    const { baseUrl } = await createTestServer()
    const cookie = await authenticate(baseUrl, KeyPair.generate())
    const body = (await (await fetch(`${baseUrl}/readiness`, { headers: { cookie } })).json()) as {
      rails: Record<string, { status: string; reason: string }>
    }
    // No fulfilment or catalog fixtures: airtime/data unavailable.
    expect(body.rails.airtime.status).toBe('unavailable')
    expect(body.rails.data.status).toBe('unavailable')
    // Cash-out service is wired but unattested: configured, never verified.
    expect(body.rails.cashout.status).toBe('configured')
  })

  it('reports verified rails only when wired and attested, without provider calls', async () => {
    const airtimeRequests: string[] = []
    const dataRequests: string[] = []
    const paycrestRequests: Array<{ url: string }> = []
    let rateCalls = 0
    const { baseUrl } = await createTestServer({
      airtimeFetch: async (url: string) => {
        airtimeRequests.push(url)
        return {}
      },
      dataFetch: async (url: string) => {
        dataRequests.push(url)
        return {}
      },
      dataCatalog: fixtureCatalog(),
      paycrestFetch: async (url: string) => {
        paycrestRequests.push({ url })
        return {}
      },
      nimRateFetch: async () => {
        rateCalls += 1
        return { 'nimiq-2': { ngn: 2000 } }
      },
      liveFlags: { airtime: true, data: true, cashout: true },
    })
    const cookie = await authenticate(baseUrl, KeyPair.generate())
    const body = (await (await fetch(`${baseUrl}/readiness`, { headers: { cookie } })).json()) as {
      rails: Record<string, { status: string }>
    }
    expect(body.rails.airtime.status).toBe('verified')
    expect(body.rails.data.status).toBe('verified')
    expect(body.rails.cashout.status).toBe('verified')
    // Readiness is config truth: no provider, rate, or chain call may fire.
    expect(airtimeRequests).toEqual([])
    expect(dataRequests).toEqual([])
    expect(paycrestRequests).toEqual([])
    expect(rateCalls).toBe(0)
  })

  it('fails unconfigured airtime before any wallet or spend step', async () => {
    const { baseUrl } = await createTestServer({ disableNimPayments: true })
    const cookie = await authenticate(baseUrl, KeyPair.generate())
    const created = await fetch(`${baseUrl}/payment-orders`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ serviceType: 'AIRTIME', paymentAsset: 'NIM', recipientPhone: '08012345678', recipientNetwork: 'MTN', requestedAmount: '1000' }),
    })
    expect(created.status).toBe(201)
    const order = (await created.json()) as { id: string }
    // Order saving works (harmless draft); the quote — the first money
    // step — fails closed with 503.
    expect((await fetch(`${baseUrl}/payment-orders/${order.id}/quote`, { method: 'POST', headers: { cookie } })).status).toBe(503)
    expect((await fetch(`${baseUrl}/payment-orders/${order.id}/fulfil`, { method: 'POST', headers: { cookie } })).status).toBe(503)
  })

  it('refuses provider spend for testnet payments', async () => {
    const { baseUrl, payment } = await createTestServer({
      airtimeFetch: async () => ({ orderid: 'ord-live', statuscode: '100', status: 'ORDER_RECEIVED' }),
    })
    const cookie = await authenticate(baseUrl, KeyPair.generate())
    const orderId = await createPaidAirtimeOrder(baseUrl, cookie, payment)
    const stored = payment.orders.get(orderId)
    if (!stored) throw new Error('Fixture order was not stored.')
    stored.paymentNetwork = 'testnet'
    const fulfil = await fetch(`${baseUrl}/payment-orders/${orderId}/fulfil`, { method: 'POST', headers: { cookie } })
    expect(fulfil.status).toBe(409)
    await expect(fulfil.json()).resolves.toMatchObject({ error: expect.stringContaining('mainnet') })
  })
})
