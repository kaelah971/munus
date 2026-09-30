import { useEffect, useState } from 'react'
import { Icon, TopBar } from '../components/Primitives'
import type { PublicSupportRequest } from '../domain/support'
import { RemoteSupportApi } from '../persistence/supportApi'

export function PublicRequestPage({ publicRequestId, apiBaseUrl }: { publicRequestId: string; apiBaseUrl: string }) {
  const [request, setRequest] = useState<PublicSupportRequest | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void new RemoteSupportApi(apiBaseUrl).getPublicRequest(publicRequestId).then((value) => {
      if (!active) return
      setRequest(value)
      if (!value) setError('This support request is unavailable or has expired.')
    }).catch((caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : 'This support request could not be loaded.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [apiBaseUrl, publicRequestId])

  return <main className="public-request-page"><div className="public-request-card"><TopBar /><p className="eyebrow">Munus support request</p><h1>{loading ? 'Loading request…' : request ? `${request.requesterLabel} is asking for help` : 'Request unavailable'}</h1>{error ? <p className="inline-error" role="alert">{error}</p> : null}{request ? <><p className="public-request-lede">A specific, reviewable request. This page does not authorize a payment or expose a wallet address.</p><div className="review-list"><div><span>Need</span><strong>{request.requestedProduct}</strong></div><div><span>Category</span><strong>{request.category}</strong></div><div><span>Requested amount</span><strong>{request.requestedAmount} NGN</strong></div>{request.phone ? <div><span>Phone</span><strong>{request.phone}{request.network ? ` · ${request.network}` : ''}</strong></div> : null}{request.message ? <div><span>Message</span><strong>{request.message}</strong></div> : null}</div><p className="truth-note"><Icon name="info" size={18} /><span>Munus support requests are planning objects. NIM movement and provider fulfilment always require a separate review.</span></p></> : null}</div></main>
}
