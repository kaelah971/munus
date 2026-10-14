import { useState } from 'react'
import { Icon, PrimaryButton, QuietButton, SectionHeading, StatusPill } from './Primitives'
import { buildRecoveryState } from '../domain/recovery'
import { buildProofTimeline, formatActivityDate } from '../domain/receipts'
import { maskPhone } from '../domain/support'
import { shortenNimiqAccount } from '../integration/nimiq'
import type { PaymentOrder } from '../domain/orders'

/**
 * User-facing recovery for diverged payment/fulfilment truth. Read-only
 * except for two explicit, owner-scoped actions: Refresh (reconcile, never
 * purchases) and Retry (reconcile-first, same stable RequestID, never a
 * silent new purchase). Rendered from Activity, Pay order detail, and
 * anywhere else an order needs attention.
 */
export function RecoveryCenter({ order, onRefresh, onRetry, onBack, onResolved }: {
  order: PaymentOrder
  onRefresh: (orderId: string) => Promise<PaymentOrder>
  onRetry: (orderId: string) => Promise<PaymentOrder>
  onBack: () => void
  onResolved?: (order: PaymentOrder) => void
}) {
  const [busy, setBusy] = useState<'refresh' | 'retry' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const recovery = buildRecoveryState(order)
  if (!recovery) return null

  async function run(action: 'refresh' | 'retry') {
    setBusy(action)
    setError(null)
    try {
      const updated = action === 'refresh' ? await onRefresh(order.id) : await onRetry(order.id)
      if (updated.fulfilmentStatus === 'DELIVERED' && onResolved) {
        onResolved(updated)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Munus could not reach the provider just now.')
    } finally {
      setBusy(null)
    }
  }

  const timeline = buildProofTimeline(order)
  const noun = order.serviceType === 'DATA' ? 'data' : 'airtime'

  return (
    <section aria-labelledby="recovery-title">
      <button className="back-link" type="button" onClick={onBack}>
        <Icon name="back" size={18} /> Back
      </button>
      <p className="eyebrow">Recovery Center</p>
      <h1 id="recovery-title">{recovery.title}</h1>
      <p className="screen-lede">
        <StatusPill label={recovery.headline} tone="attention" />
      </p>
      <dl className="contact-details">
        {order.quotedCryptoAmount ? <div><dt>You paid</dt><dd>{order.quotedCryptoAmount} NIM</dd></div> : null}
        <div><dt>For</dt><dd>₦{order.requestedAmount} {order.serviceType === 'DATA' ? 'data' : 'airtime'}</dd></div>
        <div><dt>Recipient</dt><dd>{maskPhone(order.recipientPhone)}</dd></div>
        <div><dt>Payment</dt><dd>Confirmed ✓</dd></div>
        <div><dt>Delivery</dt><dd>Needs attention !</dd></div>
        {order.walletTxRef ? <div><dt>Transaction</dt><dd>{shortenNimiqAccount(order.walletTxRef)}</dd></div> : null}
      </dl>
      <div className="truth-note"><Icon name="info" size={18} /><p>{recovery.explanation}</p></div>
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
      <div className="form-actions">
        <PrimaryButton disabled={busy !== null} onClick={() => void run('refresh')}>
          {busy === 'refresh' ? 'Checking…' : 'Refresh status'}
        </PrimaryButton>
        {recovery.canRetry ? (
          <QuietButton disabled={busy !== null} onClick={() => void run('retry')}>
            {busy === 'retry' ? 'Retrying…' : 'Retry delivery'}
          </QuietButton>
        ) : null}
      </div>
      {!recovery.canRetry && recovery.retryBlockedReason ? (
        <p className="section-copy">{recovery.retryBlockedReason}</p>
      ) : null}
      <section aria-label="Recovery timeline" className="receipt-section">
        <SectionHeading>What we know</SectionHeading>
        <ol className="payment-progress">
          {timeline.map((stage) => (
            <li data-done={stage.state === 'done' ? 'true' : stage.state === 'attention' ? 'attention' : 'false'} key={stage.id}>
              <span>{stage.label}{stage.at ? ` · ${formatActivityDate(stage.at)}` : ''}</span>
            </li>
          ))}
        </ol>
        {order.lastReconciledAt ? (
          <p className="section-copy">Last checked {formatActivityDate(order.lastReconciledAt)} · {noun} reference {order.providerRequestId ?? 'pending'}</p>
        ) : null}
      </section>
    </section>
  )
}
