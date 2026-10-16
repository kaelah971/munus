import { useCallback, useEffect, useState } from 'react'
import {
  EmptyState,
  Icon,
  ListRow,
  PrimaryButton,
  QuietButton,
  SectionHeading,
  StatusPill,
} from '../components/Primitives'
import type { AppDestination } from '../navigation'
import {
  ACTIVITY_FILTERS,
  buildReceipt,
  describeActivityStatus,
  describeActivityStatusCopy,
  formatActivityDate,
  matchesActivityFilter,
  sortOrdersNewestFirst,
  type ActivityFilter,
  type MunusReceipt,
} from '../domain/receipts'
import type { PaymentOrder } from '../domain/orders'
import { buildPaymentRecoveryCase, buildRecoveryState } from '../domain/recovery'
import { formatNgnAmount } from '../domain/funding'
import type { PaymentApi } from '../persistence/paymentApi'
import { RecoveryCenter } from '../components/RecoveryCenter'

type ActivityView = { name: 'list' } | { name: 'receipt'; orderId: string } | { name: 'recovery'; orderId: string }

function serviceIcon(order: PaymentOrder): 'phone' | 'data' | 'wallet' {
  if (order.serviceType === 'DATA') return 'data'
  if (order.serviceType === 'CASH_OUT') return 'wallet'
  return 'phone'
}

export function ActivityPage({ api, onNavigate, onPaymentSettled }: {
  api: PaymentApi
  onNavigate: (destination: AppDestination) => void
  /** Called whenever an order update lands PAID, to re-read funding from chain. */
  onPaymentSettled?: () => void
}) {
  const [view, setView] = useState<ActivityView>({ name: 'list' })
  const [orders, setOrders] = useState<PaymentOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filter, setFilter] = useState<ActivityFilter>('all')
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true)
    setLoadError(null)
    try {
      setOrders(sortOrdersNewestFirst(await api.list()))
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Munus could not load your activity.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [api])

  useEffect(() => {
    let active = true
    api.list().then((paymentOrders) => {
      if (active) {
        setOrders(sortOrdersNewestFirst(paymentOrders))
        setLoadError(null)
      }
    }).catch((error: unknown) => {
      if (active) setLoadError(error instanceof Error ? error.message : 'Munus could not load your activity.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => {
      active = false
    }
  }, [api])

  const visible = orders.filter((order) =>
    matchesActivityFilter(describeActivityStatus(order), filter),
  )
  const selected = view.name === 'list'
    ? undefined
    : orders.find((order) => order.id === view.orderId)

  function updateOrder(next: PaymentOrder) {
    setOrders((current) => current.map((entry) => entry.id === next.id ? next : entry))
    if (next.paymentStatus === 'PAID') onPaymentSettled?.()
  }

  function findOrder(orderId: string): PaymentOrder | undefined {
    return orders.find((entry) => entry.id === orderId)
  }

  async function verifyPaymentOrder(orderId: string): Promise<PaymentOrder> {
    // Payment re-verification only: re-checks the SAME bound transaction
    // on-chain. Never opens the wallet, never requests another payment.
    const updated = await api.reconcilePayment(orderId)
    updateOrder(updated)
    return updated
  }

  async function refreshRecoveryOrder(orderId: string): Promise<PaymentOrder> {
    const current = findOrder(orderId)
    // A recoverable payment failure refreshes via payment re-verification
    // (same hash, no wallet), not via fulfilment reconciliation.
    if (current && buildPaymentRecoveryCase(current)) {
      return verifyPaymentOrder(orderId)
    }
    // Cash-out recovery re-checks Paycrest, never the airtime provider.
    const updated = current?.serviceType === 'CASH_OUT'
      ? await api.reconcileCashoutOrder(orderId)
      : await api.reconcileOrder(orderId)
    updateOrder(updated)
    return updated
  }

  async function retryRecoveryOrder(orderId: string): Promise<PaymentOrder> {
    // Unreachable via UI: cash-out cases never offer retry. Fail closed
    // rather than routing a payout into the airtime retry rail.
    if (findOrder(orderId)?.serviceType === 'CASH_OUT') {
      throw new Error('Cash out never retries a purchase. Refresh status instead.')
    }
    const updated = await api.retryDelivery(orderId)
    updateOrder(updated)
    return updated
  }

  return (
    <section className="screen-content" aria-labelledby="activity-title">
      {view.name === 'recovery' && selected ? (
        <RecoveryCenter
          order={selected}
          onRefresh={refreshRecoveryOrder}
          onRetry={retryRecoveryOrder}
          paymentRecovery={buildPaymentRecoveryCase(selected)}
          onVerifyPayment={verifyPaymentOrder}
          onBack={() => setView({ name: 'list' })}
          onResolved={(resolved) => {
            updateOrder(resolved)
            setView({ name: 'receipt', orderId: resolved.id })
          }}
        />
      ) : view.name === 'receipt' && selected ? (
        <ReceiptDetail
          receipt={buildReceipt(selected)}
          onBack={() => setView({ name: 'list' })}
        />
      ) : (
        <>
          <section className="screen-intro">
            <p className="eyebrow">Your record</p>
            <h1 id="activity-title">Activity</h1>
            <p className="screen-lede">Every payment attempt and delivery, newest first — built only from real order evidence.</p>
          </section>
          {loadError ? <p className="inline-error" role="alert">{loadError}</p> : null}
          <div className="filter-row" role="group" aria-label="Filter activity">
            {ACTIVITY_FILTERS.map((entry) => (
              <button
                aria-pressed={filter === entry.id}
                className={filter === entry.id ? 'filter-chip filter-chip--active' : 'filter-chip'}
                key={entry.id}
                onClick={() => setFilter(entry.id)}
                type="button"
              >
                {entry.label}
              </button>
            ))}
          </div>
          {loading ? <p role="status">Loading your activity…</p> : null}
          {!loading && orders.length === 0 && !loadError ? (
            <>
              <EmptyState
                description="Your payments and delivered essentials will appear here."
                icon="receipt"
                title="No activity yet"
              />
              <div className="form-actions">
                <PrimaryButton onClick={() => onNavigate('pay')}>Pay an essential</PrimaryButton>
              </div>
            </>
          ) : null}
          {!loading && orders.length > 0 && visible.length === 0 ? (
            <p className="section-copy">Nothing in this view yet. Try another filter.</p>
          ) : null}
          <div className="category-list">
            {visible.map((order) => {
              const receipt = buildReceipt(order)
              const copy = describeActivityStatusCopy(describeActivityStatus(order), order.serviceType)
              const isCashout = order.serviceType === 'CASH_OUT'
              const context = receipt.dataAllowance ? `${receipt.dataAllowance} · ` : ''
              const description = isCashout
                ? [order.bankName, receipt.recipientMasked, formatActivityDate(order.createdAt)].filter(Boolean).join(' · ')
                : `${context}${order.recipientNetwork ? `${order.recipientNetwork} · ` : ''}${receipt.recipientMasked} · ${formatActivityDate(order.createdAt)}`
              const title = isCashout
                ? `${receipt.usdtTotalAmount ?? order.requestedAmount} USDT cash out`
                : `₦${formatNgnAmount(order.requestedAmount)} ${receipt.serviceLabel.toLowerCase()}`
              const recovery = buildRecoveryState(order)
              const paymentRecovery = buildPaymentRecoveryCase(order)
              const needsRecovery = (recovery !== null && (recovery.kind === 'attention' || recovery.kind === 'failed')) || paymentRecovery !== null
              return (
                <ListRow
                  description={description}
                  icon={serviceIcon(order)}
                  key={order.id}
                  meta={<StatusPill label={needsRecovery ? 'Needs attention' : copy.label} tone={needsRecovery ? 'attention' : copy.tone} />}
                  onClick={() => setView(needsRecovery ? { name: 'recovery', orderId: order.id } : { name: 'receipt', orderId: order.id })}
                  title={title}
                />
              )
            })}
          </div>
          {!loading && orders.length > 0 ? (
            <div className="form-actions">
              <QuietButton disabled={refreshing} onClick={() => void load()}>
                {refreshing ? 'Refreshing…' : 'Refresh activity'}
              </QuietButton>
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}

function ReceiptDetail({ receipt, onBack }: { receipt: MunusReceipt; onBack: () => void }) {
  const [copied, setCopied] = useState(false)
  const isCashout = receipt.asset === 'USDT'

  function copyReference() {
    void copyText(receipt.walletTxFull ?? receipt.receiptReference).then((ok) => {
      if (ok) setCopied(true)
    })
  }

  return (
    <section aria-labelledby="activity-title">
      <button className="back-link" type="button" onClick={onBack}>
        <Icon name="back" size={18} /> Activity
      </button>
      <p className="eyebrow">{receipt.completed ? 'Receipt' : 'Order detail'}</p>
      <h1 id="activity-title">{isCashout ? `${receipt.usdtTotalAmount ?? receipt.localAmount} USDT ${receipt.serviceLabel.toLowerCase()}` : `₦${receipt.localAmount} ${receipt.serviceLabel.toLowerCase()}`}</h1>
      <p className="screen-lede">
        <StatusPill label={receipt.completed ? `Receipt · ${receipt.statusLabel}` : receipt.statusLabel} tone={receipt.statusTone} />
      </p>
      {receipt.isTestnet ? (
        <div className="truth-note"><Icon name="info" size={18} /><p>Testnet payment — no real provider spend.</p></div>
      ) : null}

      <section aria-label="What was purchased" className="receipt-section">
        <SectionHeading>What was purchased</SectionHeading>
        <dl className="contact-details">
          <div><dt>Service</dt><dd>{receipt.serviceLabel}</dd></div>
          {receipt.network ? <div><dt>Network</dt><dd>{receipt.network}</dd></div> : null}
          <div><dt>{isCashout ? 'Bank account' : 'Recipient'}</dt><dd>{receipt.recipientMasked}</dd></div>
          {receipt.bankName ? <div><dt>Bank</dt><dd>{receipt.bankName}</dd></div> : null}
          {receipt.bankAccountName ? <div><dt>Account name</dt><dd>{receipt.bankAccountName}</dd></div> : null}
          {receipt.bundleLabel ? <div><dt>Bundle</dt><dd>{receipt.bundleLabel}</dd></div> : null}
          {receipt.dataAllowance ? <div><dt>Data allowance</dt><dd>{receipt.dataAllowance}</dd></div> : null}
          {receipt.validity ? <div><dt>Validity</dt><dd>{receipt.validity}</dd></div> : null}
          <div><dt>{isCashout ? 'Payout' : 'Local value'}</dt><dd>₦{isCashout ? (receipt.payoutNgnAmount ?? receipt.localAmount) : receipt.localAmount}</dd></div>
          <div><dt>Receipt reference</dt><dd>{receipt.receiptReference}</dd></div>
        </dl>
      </section>

      <section aria-label="How it was paid" className="receipt-section">
        <SectionHeading>How it was paid</SectionHeading>
        <dl className="contact-details">
          <div><dt>Payment asset</dt><dd>{receipt.asset}</dd></div>
          {receipt.nimAmount ? <div><dt>You paid</dt><dd>{receipt.nimAmount} NIM</dd></div> : null}
          {receipt.usdtTotalAmount ? <div><dt>You paid</dt><dd>{receipt.usdtTotalAmount} USDT</dd></div> : null}
          {receipt.cashoutFeeUsdt ? <div><dt>Provider fees</dt><dd>{receipt.cashoutFeeUsdt} USDT</dd></div> : null}
          {receipt.rate && receipt.rateAsset === 'USDT' ? <div><dt>Rate</dt><dd>1 USDT ≈ ₦{receipt.rate}</dd></div> : null}
          {receipt.rate && receipt.rateAsset !== 'USDT' ? <div><dt>Rate</dt><dd>1 NIM ≈ ₦{receipt.rate}</dd></div> : null}
          {receipt.paymentNetworkLabel ? <div><dt>Payment network</dt><dd>{receipt.paymentNetworkLabel}</dd></div> : null}
          <div><dt>Payment status</dt><dd>{receipt.activityStatus === 'payment-failed' ? 'Failed' : receipt.paymentTime ? 'Confirmed' : receipt.walletTxShort ? 'Submitted' : 'Not started'}</dd></div>
          {receipt.senderShort ? <div><dt>Payment sender</dt><dd>{receipt.senderShort}</dd></div> : null}
          {receipt.receiverShort ? <div><dt>Munus receiver</dt><dd>{receipt.receiverShort}</dd></div> : null}
          {receipt.lunaAmount ? (
            <div><dt>Chain amount</dt><dd>{receipt.lunaAmount} luna</dd></div>
          ) : null}
        </dl>
      </section>

      <section aria-label="What happened after payment" className="receipt-section">
        <SectionHeading>What happened after</SectionHeading>
        <dl className="contact-details">
          <div><dt>Delivery status</dt><dd>{receipt.statusLabel}</dd></div>
          {receipt.providerName ? <div><dt>Provider</dt><dd>{receipt.providerName}</dd></div> : null}
          {receipt.providerRef ? <div><dt>Provider reference</dt><dd>{receipt.providerRef}</dd></div> : null}
          {receipt.providerStatusText ? <div><dt>Provider status</dt><dd>{receipt.providerStatusText}</dd></div> : null}
          {receipt.amountCharged ? <div><dt>Amount charged</dt><dd>₦{receipt.amountCharged}</dd></div> : null}
          {receipt.paymentTime ? <div><dt>Payment time</dt><dd>{formatActivityDate(receipt.paymentTime)}</dd></div> : null}
          {receipt.deliveryTime ? <div><dt>Delivery time</dt><dd>{formatActivityDate(receipt.deliveryTime)}</dd></div> : null}
        </dl>
        {receipt.failureDetail && receipt.activityStatus === 'payment-failed' ? (
          <div className="truth-note"><Icon name="info" size={18} /><p>{receipt.failureDetail}</p></div>
        ) : null}
        {receipt.activityStatus === 'needs-attention' || receipt.activityStatus === 'delivery-failed' ? (
          <div className="truth-note"><Icon name="info" size={18} /><p>{isCashout ? 'Transfer recorded · the NGN payout needs attention. Your USDT transfer is safe and recorded.' : 'Payment confirmed · airtime delivery needs attention. Your NIM payment is safe and recorded.'}</p></div>
        ) : null}
      </section>

      <section aria-label="Proof timeline" className="receipt-section">
        <SectionHeading>Proof timeline</SectionHeading>
        <ol className="payment-progress">
          {receipt.timeline.map((stage) => (
            <li data-done={stage.state === 'done' ? 'true' : stage.state === 'attention' ? 'attention' : 'false'} key={stage.id}>
              <span>{stage.label}{stage.at ? ` · ${formatActivityDate(stage.at)}` : ''}</span>
            </li>
          ))}
        </ol>
      </section>

      <div className="form-actions">
        {receipt.walletTxShort ? (
          <QuietButton onClick={copyReference}>
            {copied ? 'Copied ✓' : 'Copy transaction reference'}
          </QuietButton>
        ) : null}
        <QuietButton onClick={onBack}>Back to activity</QuietButton>
      </div>
    </section>
  )
}

async function copyText(value: string): Promise<boolean> {
  try {
    if (!navigator.clipboard) return false
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}
