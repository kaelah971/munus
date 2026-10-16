import { useState } from 'react'
import { Icon, PrimaryButton, QuietButton, SectionHeading, StatusPill } from './Primitives'
import { buildRecoveryState, type PaymentRecoveryCase } from '../domain/recovery'
import { formatNgnAmount } from '../domain/funding'
import { buildProofTimeline, formatActivityDate } from '../domain/receipts'
import { maskBankAccountNumber } from '../domain/cashout'
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
export function RecoveryCenter({ order, onRefresh, onRetry, onBack, onResolved, paymentRecovery, onVerifyPayment }: {
  order: PaymentOrder
  onRefresh: (orderId: string) => Promise<PaymentOrder>
  onRetry: (orderId: string) => Promise<PaymentOrder>
  onBack: () => void
  onResolved?: (order: PaymentOrder) => void
  /** Payment re-verification case (failed-but-bound orders). Never a wallet action. */
  paymentRecovery?: PaymentRecoveryCase | null
  /** Re-checks the SAME bound transaction on-chain. Must never open the wallet. */
  onVerifyPayment?: (orderId: string) => Promise<PaymentOrder>
}) {
  const [busy, setBusy] = useState<'refresh' | 'retry' | 'verify' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const recovery = buildRecoveryState(order)
  if (!recovery && !paymentRecovery) return null

  async function run(action: 'refresh' | 'retry' | 'verify') {
    setBusy(action)
    setError(null)
    try {
      const updated = action === 'refresh'
        ? await onRefresh(order.id)
        : action === 'retry'
          ? await onRetry(order.id)
          : await onVerifyPayment?.(order.id)
      if (updated && updated.fulfilmentStatus === 'DELIVERED' && onResolved) {
        onResolved(updated)
      }
      // Payment verification landing PAID moves to the live receipt so the
      // obsolete failure disappears. Delivery refreshes stay put: a PAID
      // order still being delivered keeps its Recovery Center context.
      if (action === 'verify' && updated && updated.paymentStatus === 'PAID' && onResolved) {
        onResolved(updated)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Munus could not reach the provider just now.')
    } finally {
      setBusy(null)
    }
  }

  const timeline = buildProofTimeline(order)
  const isCashout = order.serviceType === 'CASH_OUT'
  const noun = order.serviceType === 'DATA' ? 'data' : isCashout ? 'payout' : 'airtime'

  if (!recovery) {
    // Payment re-verification only: the bound transaction is re-checked
    // on-chain. No wallet contact, no new payment, no provider contact
    // until the order itself becomes PAID.
    return (
      <section aria-labelledby="recovery-title">
        <button className="back-link" type="button" onClick={onBack}>
          <Icon name="back" size={18} /> Back
        </button>
        <p className="eyebrow">Recovery Center</p>
        <h1 id="recovery-title">{paymentRecovery?.headline ?? 'Re-check existing payment'}</h1>
        <p className="screen-lede">
          <StatusPill label="Payment needs verification" tone="attention" />
        </p>
        <dl className="contact-details">
          <div><dt>For</dt><dd>₦{formatNgnAmount(order.requestedAmount)} {order.serviceType === 'DATA' ? 'data' : 'airtime'}</dd></div>
          <div><dt>Recipient</dt><dd>{maskPhone(order.recipientPhone ?? '')}</dd></div>
          <div><dt>Payment</dt><dd>Submitted, not yet confirmed</dd></div>
          {order.walletTxRef ? <div><dt>Transaction</dt><dd>{shortenNimiqAccount(order.walletTxRef)}</dd></div> : null}
        </dl>
        <div className="truth-note"><Icon name="info" size={18} /><p>{paymentRecovery?.explanation}</p></div>
        {error ? <p className="inline-error" role="alert">{error}</p> : null}
        <div className="form-actions">
          <PrimaryButton disabled={busy !== null || !onVerifyPayment} onClick={() => void run('verify')}>
            {busy === 'verify' ? 'Verifying…' : 'Verify existing payment'}
          </PrimaryButton>
        </div>
        <section aria-label="Recovery timeline" className="receipt-section">
          <SectionHeading>What we know</SectionHeading>
          <ol className="payment-progress">
            {timeline.map((stage) => (
              <li data-done={stage.state === 'done' ? 'true' : stage.state === 'attention' ? 'attention' : 'false'} key={stage.id}>
                <span>{stage.label}{stage.at ? ` · ${formatActivityDate(stage.at)}` : ''}</span>
              </li>
            ))}
          </ol>
        </section>
      </section>
    )
  }

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
        {isCashout && order.usdtTotalAmount ? <div><dt>You paid</dt><dd>{order.usdtTotalAmount} USDT</dd></div> : null}
        {!isCashout && order.quotedCryptoAmount ? <div><dt>You paid</dt><dd>{order.quotedCryptoAmount} NIM</dd></div> : null}
        <div><dt>For</dt><dd>{isCashout ? `₦${formatNgnAmount(order.payoutNgnAmount ?? order.requestedAmount)} cash out` : `₦${formatNgnAmount(order.requestedAmount)} ${order.serviceType === 'DATA' ? 'data' : 'airtime'}`}</dd></div>
        <div><dt>{isCashout ? 'Bank account' : 'Recipient'}</dt><dd>{isCashout ? maskBankAccountNumber(order.bankAccountNumber ?? '') : maskPhone(order.recipientPhone ?? '')}</dd></div>
        {isCashout && order.bankName ? <div><dt>Bank</dt><dd>{order.bankName}</dd></div> : null}
        <div><dt>Payment</dt><dd>Confirmed ✓</dd></div>
        <div><dt>Delivery</dt><dd>Needs attention !</dd></div>
        {order.walletTxRef ? <div><dt>Transaction</dt><dd>{shortenNimiqAccount(order.walletTxRef)}</dd></div> : null}
      </dl>
      <div className="truth-note"><Icon name="info" size={18} /><p>{recovery.explanation}</p></div>
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
      <div className="form-actions">
        {paymentRecovery && onVerifyPayment ? (
          <PrimaryButton disabled={busy !== null} onClick={() => void run('verify')}>
            {busy === 'verify' ? 'Verifying…' : 'Verify existing payment'}
          </PrimaryButton>
        ) : null}
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
