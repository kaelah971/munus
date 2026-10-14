import { useEffect, useRef, useState } from 'react'
import { Icon, ListRow, PrimaryButton, QuietButton, SectionHeading, StatusPill } from '../components/Primitives'
import { ESSENTIAL_CATEGORIES } from '../domain/payment'
import type { IconName } from '../components/Primitives'
import {
  describeFulfilmentStage,
  describeOrderStage,
  isQuoteFresh,
  type PaymentOrder,
  type PaymentOrderDraft,
} from '../domain/orders'
import {
  describeActivityStatus,
  describeActivityStatusCopy,
  describePaymentFailureReason,
  describeProviderName,
  describeServiceLabel,
} from '../domain/receipts'
import type { DataPlan } from '../domain/orders'
import { maskPhone, SUPPORT_NETWORKS } from '../domain/support'
import { requestNimPayment, shortenNimiqAccount, type NimiqConnectionState } from '../integration/nimiq'
import type { PaymentApi } from '../persistence/paymentApi'

const icons: Record<(typeof ESSENTIAL_CATEGORIES)[number]['id'], IconName> = {
  airtime: 'phone',
  data: 'data',
  electricity: 'bolt',
  'cable-internet': 'wifi',
}

type PayView =
  | { name: 'categories' }
  | { name: 'airtime-form' }
  | { name: 'data-form' }
  | { name: 'review'; orderId: string }

function serviceNoun(order: Pick<PaymentOrder, 'serviceType'>): 'Airtime' | 'Data' {
  return order.serviceType === 'DATA' ? 'Data' : 'Airtime'
}

function emptyAirtimeDraft(defaultPhone: string): PaymentOrderDraft {
  return {
    serviceType: 'AIRTIME',
    paymentAsset: 'NIM',
    recipientPhone: defaultPhone,
    recipientNetwork: '',
    requestedAmount: '',
  }
}

export function PayPage({ api, defaultPhone = '', connection }: {
  api: PaymentApi
  defaultPhone?: string
  connection: NimiqConnectionState
}) {
  const [view, setView] = useState<PayView>({ name: 'categories' })
  const [orders, setOrders] = useState<PaymentOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [draft, setDraft] = useState<PaymentOrderDraft>(() => emptyAirtimeDraft(defaultPhone))
  const [saving, setSaving] = useState(false)
  const [quoting, setQuoting] = useState(false)
  const [payBusy, setPayBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [pendingTxHash, setPendingTxHash] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [dataNetwork, setDataNetwork] = useState<PaymentOrderDraft['recipientNetwork']>('')
  const [dataPlans, setDataPlans] = useState<DataPlan[]>([])
  const [plansLoading, setPlansLoading] = useState(false)
  const [plansError, setPlansError] = useState<string | null>(null)
  const [selectedPlanId, setSelectedPlanId] = useState('')
  const [dataPhone, setDataPhone] = useState('')
  const [nowMs, setNowMs] = useState(() => Date.now())
  const autoReconciled = useRef<Set<string>>(new Set())

  useEffect(() => {
    let active = true
    api.list().then((paymentOrders) => {
      if (active) {
        setOrders(paymentOrders)
        setLoadError(null)
      }
    }).catch((error: unknown) => {
      if (active) setLoadError(error instanceof Error ? error.message : 'Munus could not load your payment orders.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => {
      active = false
    }
  }, [api])

  const reviewed = view.name === 'review' ? orders.find((order) => order.id === view.orderId) : undefined
  const quoteLive = reviewed ? isQuoteFresh(reviewed, nowMs) : false
  const reviewedId = reviewed?.id
  const countdownActive = reviewed?.paymentStatus === 'READY_FOR_PAYMENT'
    || reviewed?.paymentStatus === 'AWAITING_WALLET_APPROVAL'

  useEffect(() => {
    if (!countdownActive) return
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [countdownActive, reviewedId])

  useEffect(() => {
    // One safe server poll when opening a confirming order. This never opens
    // the wallet: it only re-checks chain evidence already on file.
    if (view.name === 'review' && reviewed?.paymentStatus === 'ONCHAIN_PENDING' && !autoReconciled.current.has(reviewed.id)) {
      autoReconciled.current.add(reviewed.id)
      void refreshOrder(reviewed.id, 'reconcile')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, reviewed?.id, reviewed?.paymentStatus])

  function updateOrder(next: PaymentOrder) {
    setOrders((current) => current.map((entry) => entry.id === next.id ? next : entry))
  }

  async function refreshOrder(orderId: string, mode: 'get' | 'reconcile') {
    setRefreshing(true)
    setActionError(null)
    try {
      updateOrder(mode === 'reconcile' ? await api.reconcilePayment(orderId) : await api.get(orderId))
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Munus could not refresh this order.')
    } finally {
      setRefreshing(false)
    }
  }

  function openAirtimeForm() {
    setDraft(emptyAirtimeDraft(defaultPhone))
    setActionError(null)
    setPendingTxHash(null)
    setView({ name: 'airtime-form' })
  }

  function openDataForm() {
    setDataNetwork('')
    setDataPlans([])
    setPlansError(null)
    setSelectedPlanId('')
    setDataPhone(defaultPhone)
    setActionError(null)
    setPendingTxHash(null)
    setView({ name: 'data-form' })
  }

  async function loadDataPlans(network: PaymentOrderDraft['recipientNetwork']) {
    if (!network) return
    setPlansLoading(true)
    setPlansError(null)
    setSelectedPlanId('')
    try {
      setDataPlans(await api.listDataPlans(network))
    } catch (error) {
      setDataPlans([])
      setPlansError(error instanceof Error ? error.message : 'Munus could not load data bundles.')
    } finally {
      setPlansLoading(false)
    }
  }

  function chooseDataNetwork(network: PaymentOrderDraft['recipientNetwork']) {
    setDataNetwork(network)
    setDataPlans([])
    setPlansError(null)
    setSelectedPlanId('')
    if (network) void loadDataPlans(network)
  }

  async function saveDataOrder() {
    const plan = dataPlans.find((entry) => entry.providerPlanId === selectedPlanId)
    if (!plan || !dataNetwork) return
    setSaving(true)
    setActionError(null)
    try {
      const order = await api.createDataOrder({
        providerPlanId: plan.providerPlanId,
        recipientPhone: dataPhone,
        recipientNetwork: dataNetwork,
      })
      setOrders((current) => [order, ...current.filter((entry) => entry.id !== order.id)])
      setView({ name: 'review', orderId: order.id })
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Munus could not save this data order.')
    } finally {
      setSaving(false)
    }
  }

  async function saveAirtimeOrder() {
    setSaving(true)
    setActionError(null)
    try {
      const order = await api.createOrder(draft)
      setOrders((current) => [order, ...current.filter((entry) => entry.id !== order.id)])
      setView({ name: 'review', orderId: order.id })
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Munus could not save this airtime order.')
    } finally {
      setSaving(false)
    }
  }

  async function createQuote(orderId: string) {
    setQuoting(true)
    setActionError(null)
    try {
      updateOrder(await api.createQuote(orderId))
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Munus could not create a NIM quote.')
    } finally {
      setQuoting(false)
    }
  }

  async function submitWithRetry(orderId: string, txHash: string): Promise<PaymentOrder> {
    try {
      return await api.submitPayment(orderId, txHash)
    } catch (error) {
      // Same-hash submission is idempotent: one automatic retry covers a
      // dropped response without ever risking a second payment.
      return await api.submitPayment(orderId, txHash).catch(() => {
        throw error
      })
    }
  }

  async function payWithNim() {
    if (!reviewed || payBusy) return
    setPayBusy(true)
    setActionError(null)
    try {
      // Explicit user intent only: the wallet is contacted solely from this tap.
      const { order: intentOrder, intent } = await api.createPaymentIntent(reviewed.id)
      updateOrder(intentOrder)
      const txHash = await requestNimPayment(connection, {
        receiver: intent.receiver,
        lunaAmount: intent.lunaAmount,
        memo: intent.memo,
      })
      setPendingTxHash(txHash)
      const submitted = await submitWithRetry(reviewed.id, txHash)
      setPendingTxHash(null)
      updateOrder(submitted)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'NIM payment did not complete. No payment was confirmed.')
      try {
        updateOrder(await api.get(reviewed.id))
      } catch {
        // Keep the current view when even a refresh is unavailable.
      }
    } finally {
      setPayBusy(false)
    }
  }

  async function retryPendingSubmission() {
    if (!reviewed || !pendingTxHash || payBusy) return
    setPayBusy(true)
    setActionError(null)
    try {
      const submitted = await submitWithRetry(reviewed.id, pendingTxHash)
      setPendingTxHash(null)
      updateOrder(submitted)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Submission did not complete. Your transaction reference is kept above.')
    } finally {
      setPayBusy(false)
    }
  }

  return (
    <section className="screen-content" aria-labelledby="pay-title">
      {view.name === 'airtime-form' ? (
        <section className="support-section planning-form" aria-labelledby="pay-title">
          <button className="back-link" type="button" onClick={() => setView({ name: 'categories' })}>
            <Icon name="back" size={18} /> Pay Essentials
          </button>
          <p className="eyebrow">Airtime order</p>
          <h1 id="pay-title">Top up airtime</h1>
          <p className="screen-lede">Save the top-up as a Munus order first, then get a live NIM quote for it.</p>
          <div className="form-grid">
            <label>
              <span>Recipient phone</span>
              <input
                autoComplete="tel"
                inputMode="tel"
                value={draft.recipientPhone}
                onChange={(event) => setDraft({ ...draft, recipientPhone: event.target.value })}
                placeholder="08012345678"
              />
            </label>
            <label>
              <span>Network</span>
              <select
                value={draft.recipientNetwork}
                onChange={(event) => setDraft({ ...draft, recipientNetwork: event.target.value as PaymentOrderDraft['recipientNetwork'] })}
              >
                <option value="">Not known</option>
                {SUPPORT_NETWORKS.map((network) => <option key={network} value={network}>{network}</option>)}
              </select>
            </label>
            <label>
              <span>Amount (₦)</span>
              <input
                inputMode="decimal"
                value={draft.requestedAmount}
                onChange={(event) => setDraft({ ...draft, requestedAmount: event.target.value })}
                placeholder="1000"
              />
            </label>
            <label>
              <span>Pay with</span>
              <select value={draft.paymentAsset} disabled aria-label="Pay with">
                <option value="NIM">NIM</option>
              </select>
            </label>
          </div>
          {actionError ? <p className="inline-error" role="alert">{actionError}</p> : null}
          <div className="truth-note"><Icon name="info" size={18} /><p>This saves the order only — no money moves until you review a live quote and approve it in Nimiq Pay.</p></div>
          <PrimaryButton disabled={saving} onClick={() => void saveAirtimeOrder()}>
            {saving ? 'Saving order…' : 'Review airtime order'}
          </PrimaryButton>
        </section>
      ) : view.name === 'data-form' ? (
        <section className="support-section planning-form" aria-labelledby="pay-title">
          <button className="back-link" type="button" onClick={() => setView({ name: 'categories' })}>
            <Icon name="back" size={18} /> Pay Essentials
          </button>
          <p className="eyebrow">Data order</p>
          <h1 id="pay-title">Buy data</h1>
          <p className="screen-lede">Pick a current network bundle. The price comes from the live catalog — never typed in.</p>
          <div className="form-grid">
            <label>
              <span>Network</span>
              <select
                value={dataNetwork}
                onChange={(event) => chooseDataNetwork(event.target.value as PaymentOrderDraft['recipientNetwork'])}
              >
                <option value="">Choose network</option>
                {SUPPORT_NETWORKS.map((network) => <option key={network} value={network}>{network}</option>)}
              </select>
            </label>
            <label>
              <span>Recipient phone</span>
              <input
                autoComplete="tel"
                inputMode="tel"
                value={dataPhone}
                onChange={(event) => setDataPhone(event.target.value)}
                placeholder="08012345678"
              />
            </label>
          </div>
          {dataNetwork ? (
            <section aria-label="Data bundles">
              <SectionHeading>Current bundles</SectionHeading>
              {plansLoading ? <p role="status">Loading bundles…</p> : null}
              {plansError ? <p className="inline-error" role="alert">{plansError}</p> : null}
              {!plansLoading && !plansError && dataPlans.length === 0 ? (
                <p className="section-copy">No bundles right now. Try another network.</p>
              ) : null}
              <div className="category-list">
                {dataPlans.map((plan) => {
                  const selected = plan.providerPlanId === selectedPlanId
                  const details = [
                    plan.dataAllowance,
                    plan.validity,
                    `₦${plan.localPriceNgn}`,
                  ].filter(Boolean).join(' · ')
                  return (
                    <ListRow
                      description={details}
                      icon="data"
                      key={plan.providerPlanId}
                      meta={<StatusPill label={selected ? 'Selected' : `₦${plan.localPriceNgn}`} tone={selected ? 'ready' : 'quiet'} />}
                      onClick={() => setSelectedPlanId(plan.providerPlanId)}
                      title={plan.displayName}
                    />
                  )
                })}
              </div>
            </section>
          ) : null}
          {actionError ? <p className="inline-error" role="alert">{actionError}</p> : null}
          <div className="truth-note"><Icon name="info" size={18} /><p>This saves the order at the catalog price only — no money moves until you review a live quote and approve it in Nimiq Pay.</p></div>
          <PrimaryButton disabled={saving || !selectedPlanId || !dataPhone.trim()} onClick={() => void saveDataOrder()}>
            {saving ? 'Saving order…' : 'Review data order'}
          </PrimaryButton>
        </section>
      ) : view.name === 'review' && reviewed ? (
        <section aria-labelledby="pay-title">
          <button className="back-link" type="button" onClick={() => setView({ name: 'categories' })}>
            <Icon name="back" size={18} /> Pay Essentials
          </button>
          <p className="eyebrow">Order review</p>
          <h1 id="pay-title">₦{reviewed.requestedAmount} {describeServiceLabel(reviewed.serviceType).toLowerCase()}</h1>
          <p className="screen-lede">{describeOrderStage(reviewed)}</p>
          <dl className="contact-details">
            <div><dt>Recipient</dt><dd>{maskPhone(reviewed.recipientPhone)}</dd></div>
            <div><dt>Network</dt><dd>{reviewed.recipientNetwork ?? 'Not known'}</dd></div>
            <div><dt>Amount</dt><dd>₦{reviewed.requestedAmount}</dd></div>
            {reviewed.planDisplayLabel ? <div><dt>Bundle</dt><dd>{reviewed.planDisplayLabel}</dd></div> : null}
            {reviewed.planDataAllowance ? <div><dt>Data allowance</dt><dd>{reviewed.planDataAllowance}</dd></div> : null}
            {reviewed.planValidity ? <div><dt>Validity</dt><dd>{reviewed.planValidity}</dd></div> : null}
            <div><dt>Pay with</dt><dd>{reviewed.paymentAsset}</dd></div>
            <div><dt>Payment</dt><dd><PaymentStageLabel order={reviewed} /></dd></div>
            <div><dt>Fulfilment</dt><dd>{describeFulfilmentStage(reviewed.fulfilmentStatus)}</dd></div>
            {reviewed.quotedCryptoAmount ? <div><dt>You pay</dt><dd>{reviewed.quotedCryptoAmount} NIM</dd></div> : null}
            {reviewed.quoteRateNgnPerNim ? <div><dt>Rate</dt><dd>1 NIM ≈ ₦{reviewed.quoteRateNgnPerNim}</dd></div> : null}
            {reviewed.paymentReceiver ? <div><dt>Paid to</dt><dd>{shortenNimiqAccount(reviewed.paymentReceiver)}</dd></div> : null}
            {reviewed.paymentSender ? <div><dt>Paid by</dt><dd>{shortenNimiqAccount(reviewed.paymentSender)}</dd></div> : null}
            {reviewed.paymentBlockNumber ? <div><dt>Confirmed in block</dt><dd>{reviewed.paymentBlockNumber}</dd></div> : null}
            {reviewed.provider ? <div><dt>Provider</dt><dd>{describeProviderName(reviewed.provider)}</dd></div> : null}
            {reviewed.providerStatus ? <div><dt>Provider status</dt><dd>{reviewed.providerStatus} ({reviewed.providerStatusCode ?? 'no code'})</dd></div> : null}
            {reviewed.providerAmountCharged ? <div><dt>Amount charged</dt><dd>₦{reviewed.providerAmountCharged}</dd></div> : null}
            <div><dt>Saved</dt><dd>{new Date(reviewed.createdAt).toLocaleString()}</dd></div>
          </dl>
          {actionError ? <p className="inline-error" role="alert">{actionError}</p> : null}
          <ReviewActions
            order={reviewed}
            quoteLive={quoteLive}
            nowMs={nowMs}
            quoting={quoting}
            payBusy={payBusy}
            refreshing={refreshing}
            pendingTxHash={pendingTxHash}
            onCreateQuote={() => void createQuote(reviewed.id)}
            onPay={() => void payWithNim()}
            onRetrySubmission={() => void retryPendingSubmission()}
            onRefresh={() => void refreshOrder(reviewed.id, 'get')}
            onRefreshPayment={() => void refreshOrder(reviewed.id, 'reconcile')}
          />
          <div className="form-actions">
            <QuietButton onClick={() => setView({ name: 'categories' })}>Back to Pay</QuietButton>
            <QuietButton onClick={openAirtimeForm}>New airtime order</QuietButton>
          </div>
        </section>
      ) : (
        <>
          <section className="screen-intro">
            <p className="eyebrow">Everyday essentials</p>
            <h1 id="pay-title">Pay Essentials</h1>
            <p>Start with airtime or data. Munus saves a real order, quotes live NIM, and delivers after on-chain confirmation.</p>
          </section>
          {loadError ? <p className="inline-error" role="alert">{loadError}</p> : null}
          <section aria-label="Essential categories" className="category-list">
            {ESSENTIAL_CATEGORIES.map((category) => {
              if (category.id === 'airtime') {
                return (
                  <ListRow
                    description="Save a top-up order with a phone number and amount."
                    icon={icons[category.id]}
                    key={category.id}
                    meta={<StatusPill label="Start order" tone="ready" />}
                    onClick={openAirtimeForm}
                    title={category.name}
                  />
                )
              }
              if (category.id === 'data') {
                return (
                  <ListRow
                    description="Buy a current network bundle at the live catalog price."
                    icon={icons[category.id]}
                    key={category.id}
                    meta={<StatusPill label="Start order" tone="ready" />}
                    onClick={openDataForm}
                    title={category.name}
                  />
                )
              }
              return (
                <ListRow
                  description={category.description}
                  disabled
                  icon={icons[category.id]}
                  key={category.id}
                  meta={<StatusPill label={category.availability === 'next' ? 'Coming next' : 'Not live'} />}
                  title={category.name}
                />
              )
            })}
          </section>
          <section aria-label="Your recent orders" className="support-section">
            <SectionHeading>Your recent orders</SectionHeading>
            {loading ? <p role="status">Loading your orders…</p> : null}
            {!loading && orders.length === 0 ? (
              <p className="section-copy">No orders yet. Start one above — it saves as a draft with no payment attached.</p>
            ) : null}
            <div className="category-list">
              {orders.slice(0, 5).map((order) => (
                <ListRow
                  description={`${maskPhone(order.recipientPhone)} · ${new Date(order.createdAt).toLocaleDateString()}`}
                  icon="phone"
                  key={order.id}
                  meta={<OrderStatusPill order={order} />}
                  onClick={() => setView({ name: 'review', orderId: order.id })}
                  title={`₦${order.requestedAmount} ${describeServiceLabel(order.serviceType).toLowerCase()}`}
                />
              ))}
            </div>
          </section>
          <div className="truth-note"><p>Airtime and data are bought from Munus with NIM and delivered through the provider rail. NIM never goes to the provider.</p></div>
        </>
      )}
    </section>
  )
}

function OrderStatusPill({ order }: { order: PaymentOrder }) {
  const copy = describeActivityStatusCopy(describeActivityStatus(order))
  return <StatusPill label={copy.label} tone={copy.tone} />
}

function PaymentStageLabel({ order }: { order: PaymentOrder }) {
  switch (order.paymentStatus) {
    case 'DRAFT': return <>Draft · quote not created</>
    case 'READY_FOR_PAYMENT': return <>Quoted · waiting for your approval</>
    case 'AWAITING_WALLET_APPROVAL': return <>Waiting for Nimiq Pay approval</>
    case 'ONCHAIN_PENDING': return <>Submitted · confirming on-chain</>
    case 'PAID': return <>Confirmed on-chain</>
    case 'PAYMENT_FAILED': return <>Failed · no {serviceNoun(order).toLowerCase()} sent</>
    default: return <>{order.paymentStatus}</>
  }
}

function quoteCountdown(expiresAt: string, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((Date.parse(expiresAt) - nowMs) / 1000))
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`
}

function ReviewActions({ order, quoteLive, nowMs, quoting, payBusy, refreshing, pendingTxHash, onCreateQuote, onPay, onRetrySubmission, onRefresh, onRefreshPayment }: {
  order: PaymentOrder
  quoteLive: boolean
  nowMs: number
  quoting: boolean
  payBusy: boolean
  refreshing: boolean
  pendingTxHash: string | null
  onCreateQuote: () => void
  onPay: () => void
  onRetrySubmission: () => void
  onRefresh: () => void
  onRefreshPayment: () => void
}) {
  if (order.paymentStatus === 'DRAFT') {
    return (
      <>
        <div className="truth-note"><Icon name="info" size={18} /><p>Get a live NIM quote to see exactly what this {serviceNoun(order).toLowerCase()} costs right now.</p></div>
        <PrimaryButton disabled={quoting} onClick={onCreateQuote}>
          {quoting ? 'Getting quote…' : 'Get NIM quote'}
        </PrimaryButton>
      </>
    )
  }

  if (order.paymentStatus === 'READY_FOR_PAYMENT' || order.paymentStatus === 'AWAITING_WALLET_APPROVAL') {
    if (!quoteLive) {
      return (
        <>
          <div className="truth-note"><Icon name="info" size={18} /><p>This quote has expired. The amount you saw is no longer valid — get a fresh one before paying.</p></div>
          <PrimaryButton disabled={quoting} onClick={onCreateQuote}>
            {quoting ? 'Getting quote…' : 'Get fresh quote'}
          </PrimaryButton>
        </>
      )
    }
    return (
      <>
        <div className="truth-note"><Icon name="info" size={18} /><p>Quote expires in {order.quoteExpiresAt ? quoteCountdown(order.quoteExpiresAt, nowMs) : '—'}. Only this tap opens Nimiq Pay — nothing happens automatically.</p></div>
        {order.paymentStatus === 'AWAITING_WALLET_APPROVAL' ? (
          <div className="truth-note"><Icon name="info" size={18} /><p>Waiting for Nimiq Pay approval. If you dismissed it, tap again to continue.</p></div>
        ) : null}
        <PrimaryButton disabled={payBusy} onClick={onPay}>
          {payBusy ? 'Opening Nimiq Pay…' : `Pay ${order.quotedCryptoAmount} NIM`}
        </PrimaryButton>
      </>
    )
  }

  if (order.paymentStatus === 'ONCHAIN_PENDING') {
    return (
      <>
        <div className="truth-note"><Icon name="info" size={18} /><p>
          {pendingTxHash ? 'Your transaction was sent. Recording it with Munus was interrupted — retry below.' : 'Your transaction was submitted. Munus is confirming it on-chain independently.'}
        </p></div>
        {pendingTxHash ? (
          <>
            <p className="section-copy">Reference: {shortenNimiqAccount(pendingTxHash)}</p>
            <PrimaryButton disabled={payBusy} onClick={onRetrySubmission}>
              {payBusy ? 'Recording…' : 'Retry recording payment'}
            </PrimaryButton>
          </>
        ) : null}
        <QuietButton disabled={refreshing} onClick={onRefreshPayment}>
          {refreshing ? 'Checking…' : 'Refresh payment status'}
        </QuietButton>
      </>
    )
  }

  if (order.paymentStatus === 'PAID') {
    const needsAttention = order.fulfilmentStatus === 'FULFILLMENT_FAILED' || order.fulfilmentStatus === 'RECOVERY_REQUIRED'
    return (
      <>
        <ol className="payment-progress">
          <li data-done="true">Quote ready</li>
          <li data-done="true">Wallet approval</li>
          <li data-done="true">NIM payment confirmed</li>
          <li data-done={order.fulfilmentStatus === 'DELIVERED' ? 'true' : 'false'}>
            {order.fulfilmentStatus === 'DELIVERED' ? `${serviceNoun(order)} delivered` : `Delivering ${serviceNoun(order).toLowerCase()}`}
          </li>
        </ol>
        {needsAttention ? (
          <div className="truth-note"><Icon name="info" size={18} /><p>Payment confirmed · {serviceNoun(order).toLowerCase()} delivery needs attention. Your NIM payment is safe and recorded.</p></div>
        ) : null}
        {order.fulfilmentStatus === 'FULFILLING' || order.fulfilmentStatus === 'NOT_STARTED' ? (
          <QuietButton disabled={refreshing} onClick={onRefresh}>
            {refreshing ? 'Checking…' : 'Refresh order status'}
          </QuietButton>
        ) : null}
      </>
    )
  }

  return (
    <>
      <div className="truth-note"><Icon name="info" size={18} /><p>{describePaymentFailureReason(order.paymentFailureReason)}</p></div>
      <QuietButton disabled={refreshing} onClick={onRefresh}>
        {refreshing ? 'Checking…' : 'Refresh order status'}
      </QuietButton>
    </>
  )
}
