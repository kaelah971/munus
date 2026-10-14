import { useCallback, useEffect, useState } from 'react'
import { Icon, TopBar } from '../components/Primitives'
import type { PublicSupportRequest } from '../domain/support'
import {
  describeEssentialNeed,
  describeEssentialStatusCopy,
  type PublicEssentialRequest as PublicEssential,
} from '../domain/essentialRequests'
import type { PaymentOrder } from '../domain/orders'
import type { MunusSession } from '../domain/auth'
import { RemoteSupportApi } from '../persistence/supportApi'

type EssentialClaim = { order: PaymentOrder; request: PublicEssential | null }

export function PublicRequestPage({ publicRequestId, apiBaseUrl, session, onSignIn, onContinueToPay }: {
  publicRequestId: string
  apiBaseUrl: string
  session?: MunusSession | null
  onSignIn?: () => void
  onContinueToPay?: () => void
}) {
  const [request, setRequest] = useState<PublicSupportRequest | null>(null)
  const [essential, setEssential] = useState<PublicEssential | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [claimBusy, setClaimBusy] = useState(false)
  const [claimError, setClaimError] = useState<string | null>(null)
  const [claimedOrder, setClaimedOrder] = useState<PaymentOrder | null>(null)

  const load = useCallback(() => fetchPublicNeed(apiBaseUrl, publicRequestId), [apiBaseUrl, publicRequestId])

  useEffect(() => {
    let active = true
    void load().then(({ essential: essentialRequest, legacy }) => {
      if (!active) return
      setEssential(essentialRequest)
      setRequest(legacy)
      if (!essentialRequest && !legacy) setError('This support request is unavailable or has expired.')
    }).catch((caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : 'This support request could not be loaded.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [load])

  async function payNeed() {
    if (!essential || claimBusy) return
    setClaimBusy(true)
    setClaimError(null)
    try {
      const claim = await new RemoteSupportApi(apiBaseUrl).claimEssentialRequest(essential.publicRequestId) as EssentialClaim
      setClaimedOrder(claim.order)
      const refreshed = await new RemoteSupportApi(apiBaseUrl).getPublicEssentialRequest(publicRequestId)
      if (refreshed) setEssential(refreshed)
    } catch (caught) {
      setClaimError(caught instanceof Error ? caught.message : 'This need could not be claimed for payment.')
    } finally {
      setClaimBusy(false)
    }
  }

  return <main className="public-request-page"><div className="public-request-card"><TopBar /><p className="eyebrow">Munus support request</p><h1>{loading ? 'Loading request…' : essential ? `${essential.requesterLabel} needs help` : request ? `${request.requesterLabel} is asking for help` : 'Request unavailable'}</h1>{error ? <p className="inline-error" role="alert">{error}</p> : null}{request && !essential ? <><p className="public-request-lede">A specific, reviewable request. This page does not authorize a payment or expose a wallet address.</p><div className="review-list"><div><span>Need</span><strong>{request.requestedProduct}</strong></div><div><span>Category</span><strong>{request.category}</strong></div><div><span>Requested amount</span><strong>{request.requestedAmount} NGN</strong></div>{request.phone ? <div><span>Phone</span><strong>{request.phone}{request.network ? ` · ${request.network}` : ''}</strong></div> : null}{request.message ? <div><span>Message</span><strong>{request.message}</strong></div> : null}</div><p className="truth-note"><Icon name="info" size={18} /><span>Munus support requests are planning objects. NIM movement and provider fulfilment always require a separate review.</span></p></> : null}{essential ? <EssentialPublicView essential={essential} session={session} claimBusy={claimBusy} claimError={claimError} claimedOrder={claimedOrder} onSignIn={onSignIn} onPay={payNeed} onRefresh={() => void load().catch(() => setError('This support request could not be loaded.'))} onContinueToPay={onContinueToPay} /> : null}</div></main>
}

function EssentialPublicView({ essential, session, claimBusy, claimError, claimedOrder, onSignIn, onPay, onRefresh, onContinueToPay }: {
  essential: PublicEssential
  session?: MunusSession | null
  claimBusy: boolean
  claimError: string | null
  claimedOrder: PaymentOrder | null
  onSignIn?: () => void
  onPay: () => void
  onRefresh: () => void
  onContinueToPay?: () => void
}) {
  const copy = describeEssentialStatusCopy(essential.essentialStatus)
  const need = describeEssentialNeed(essential)
  return (
    <>
      <p className="public-request-lede">A specific need you can pay directly — not open-ended cash.</p>
      <div className="review-list">
        <div><span>Need</span><strong>{need}</strong></div>
        {essential.planDisplayLabel ? <div><span>Bundle</span><strong>{essential.planDisplayLabel}</strong></div> : null}
        <div><span>For</span><strong>{essential.recipientMasked}{essential.network ? ` · ${essential.network}` : ''}</strong></div>
        {essential.message ? <div><span>Note</span><strong>{essential.message}</strong></div> : null}
        <div><span>Status</span><strong>{copy.label}</strong></div>
        {essential.fulfilledAt ? <div><span>Completed</span><strong>{formatPublicDate(essential.fulfilledAt)}</strong></div> : null}
      </div>
      {essential.essentialStatus === 'COMPLETED' ? (
        <p className="truth-note"><Icon name="info" size={18} /><span>This need was paid ✓ and delivered. Paid through Munus — no wallet addresses are exposed here.</span></p>
      ) : null}
      {essential.essentialStatus === 'NEEDS_ATTENTION' ? (
        <p className="truth-note"><Icon name="info" size={18} /><span>Payment confirmed · delivery needs attention. The payer's NIM payment is safe and recorded.</span></p>
      ) : null}
      {(essential.essentialStatus === 'PAID' || essential.essentialStatus === 'FULFILLING' || essential.essentialStatus === 'PAYMENT_IN_PROGRESS') ? (
        <p className="truth-note"><Icon name="info" size={18} /><span>This need is being paid. Refresh for the latest state — duplicate payments are blocked.</span></p>
      ) : null}
      {(essential.essentialStatus === 'CANCELLED' || essential.essentialStatus === 'EXPIRED') ? (
        <p className="truth-note"><Icon name="info" size={18} /><span>This request is no longer open and cannot be paid.</span></p>
      ) : null}
      {claimError ? <p className="inline-error" role="alert">{claimError}</p> : null}
      {claimedOrder && onContinueToPay ? (
        <>
          <p className="truth-note"><Icon name="info" size={18} /><span>Payment order created for ₦{claimedOrder.requestedAmount}. Continue to Pay to quote and approve it with Nimiq Pay.</span></p>
          <button className="primary-button" type="button" onClick={onContinueToPay}>Continue to Pay</button>
        </>
      ) : essential.essentialStatus === 'OPEN' && !claimedOrder ? (
        session ? (
          <button className="primary-button" type="button" disabled={claimBusy} onClick={onPay}>
            {claimBusy ? 'Reserving…' : 'Pay this need'}
          </button>
        ) : onSignIn ? (
          <button className="primary-button" type="button" onClick={onSignIn}>Connect with Nimiq Pay to pay</button>
        ) : null
      ) : null}
      <button className="quiet-button" type="button" onClick={onRefresh}>Refresh status</button>
    </>
  )
}

async function fetchPublicNeed(apiBaseUrl: string, publicRequestId: string): Promise<{
  essential: PublicEssential | null
  legacy: PublicSupportRequest | null
}> {
  const api = new RemoteSupportApi(apiBaseUrl)
  const essentialRequest = await api.getPublicEssentialRequest(publicRequestId)
  if (essentialRequest) return { essential: essentialRequest, legacy: null }
  return { essential: null, legacy: await api.getPublicRequest(publicRequestId) }
}

function formatPublicDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
