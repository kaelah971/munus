import { useEffect, useState } from 'react'
import { Icon, ListRow, PrimaryButton, QuietButton, SectionHeading, StatusPill } from '../components/Primitives'
import { ESSENTIAL_CATEGORIES } from '../domain/payment'
import type { IconName } from '../components/Primitives'
import {
  canPayOrder,
  describeFulfilmentStage,
  describeOrderStage,
  type PaymentOrder,
  type PaymentOrderDraft,
} from '../domain/orders'
import { SUPPORT_NETWORKS } from '../domain/support'
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
  | { name: 'review'; orderId: string }

function emptyAirtimeDraft(defaultPhone: string): PaymentOrderDraft {
  return {
    serviceType: 'AIRTIME',
    paymentAsset: 'NIM',
    recipientPhone: defaultPhone,
    recipientNetwork: '',
    requestedAmount: '',
  }
}

export function PayPage({ api, defaultPhone = '' }: { api: PaymentApi; defaultPhone?: string }) {
  const [view, setView] = useState<PayView>({ name: 'categories' })
  const [orders, setOrders] = useState<PaymentOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [draft, setDraft] = useState<PaymentOrderDraft>(() => emptyAirtimeDraft(defaultPhone))
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

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

  function openAirtimeForm() {
    setDraft(emptyAirtimeDraft(defaultPhone))
    setActionError(null)
    setView({ name: 'airtime-form' })
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

  const reviewed = view.name === 'review' ? orders.find((order) => order.id === view.orderId) : undefined

  return (
    <section className="screen-content" aria-labelledby="pay-title">
      {view.name === 'airtime-form' ? (
        <section className="support-section planning-form" aria-labelledby="pay-title">
          <button className="back-link" type="button" onClick={() => setView({ name: 'categories' })}>
            <Icon name="back" size={18} /> Pay Essentials
          </button>
          <p className="eyebrow">Airtime order</p>
          <h1 id="pay-title">Top up airtime</h1>
          <p className="screen-lede">Save the top-up as a Munus order first. Payment and provider fulfilment arrive in a later slice.</p>
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
          <div className="truth-note"><Icon name="info" size={18} /><p>Payment quote not created yet. This saves the order only — no money moves and no airtime is sent.</p></div>
          <PrimaryButton disabled={saving} onClick={() => void saveAirtimeOrder()}>
            {saving ? 'Saving order…' : 'Review airtime order'}
          </PrimaryButton>
        </section>
      ) : view.name === 'review' && reviewed ? (
        <section aria-labelledby="pay-title">
          <button className="back-link" type="button" onClick={() => setView({ name: 'categories' })}>
            <Icon name="back" size={18} /> Pay Essentials
          </button>
          <p className="eyebrow">Order review</p>
          <h1 id="pay-title">₦{reviewed.requestedAmount} airtime</h1>
          <p className="screen-lede">{describeOrderStage(reviewed)}</p>
          <dl className="contact-details">
            <div><dt>Recipient</dt><dd>{reviewed.recipientPhone}</dd></div>
            <div><dt>Network</dt><dd>{reviewed.recipientNetwork ?? 'Not known'}</dd></div>
            <div><dt>Amount</dt><dd>₦{reviewed.requestedAmount}</dd></div>
            <div><dt>Pay with</dt><dd>{reviewed.paymentAsset}</dd></div>
            <div><dt>Payment</dt><dd>{reviewed.paymentStatus === 'DRAFT' ? 'Draft · quote not created' : reviewed.paymentStatus}</dd></div>
            <div><dt>Fulfilment</dt><dd>{describeFulfilmentStage(reviewed.fulfilmentStatus)}</dd></div>
            <div><dt>Saved</dt><dd>{new Date(reviewed.createdAt).toLocaleString()}</dd></div>
          </dl>
          {canPayOrder(reviewed) ? null : (
            <div className="truth-note"><Icon name="info" size={18} /><p>NIM payment is not live yet. This order is saved and will become payable once live quotes and Nimiq Pay approval land.</p></div>
          )}
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
            <p>Start with airtime. Munus saves a real order first — payment and delivery follow in later slices.</p>
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
          <section aria-label="Your airtime orders" className="support-section">
            <SectionHeading>Your airtime orders</SectionHeading>
            {loading ? <p role="status">Loading your orders…</p> : null}
            {!loading && orders.length === 0 ? (
              <p className="section-copy">No airtime orders yet. Start one above — it saves as a draft with no payment attached.</p>
            ) : null}
            <div className="category-list">
              {orders.slice(0, 5).map((order) => (
                <ListRow
                  description={`${order.recipientPhone} · ${new Date(order.createdAt).toLocaleDateString()}`}
                  icon="phone"
                  key={order.id}
                  meta={<StatusPill label={order.paymentStatus === 'DRAFT' ? 'Draft · no quote' : order.paymentStatus} />}
                  onClick={() => setView({ name: 'review', orderId: order.id })}
                  title={`₦${order.requestedAmount} airtime`}
                />
              ))}
            </div>
          </section>
          <div className="truth-note"><p>NIM payments remain a separate future slice. Orders saved here cannot send NIM yet.</p></div>
        </>
      )}
    </section>
  )
}
