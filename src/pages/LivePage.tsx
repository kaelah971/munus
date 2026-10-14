import { useCallback, useEffect, useState } from 'react'
import {
  EmptyState,
  Icon,
  ListRow,
  QuietButton,
  SectionHeading,
  StatusPill,
  type IconName,
} from '../components/Primitives'
import { fetchPublicLive, type LiveActivityEvent, type LiveStatsSnapshot } from '../persistence/liveApi'

function formatRelativeTime(iso: string, nowMs: number): string {
  const atMs = Date.parse(iso)
  if (!Number.isFinite(atMs)) return ''
  const seconds = Math.max(0, Math.floor((nowMs - atMs) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'Yesterday' : `${days}d ago`
}

function eventCopy(event: LiveActivityEvent): { icon: IconName; title: string; description: string } {
  switch (event.kind) {
    case 'wallet-joined':
      return { icon: 'user', title: 'Verified wallet joined Munus', description: event.walletMasked }
    case 'airtime-delivered':
      return {
        icon: 'phone',
        title: 'Airtime delivered',
        description: [event.network, event.amountNgn ? `₦${event.amountNgn}` : '', event.walletMasked].filter(Boolean).join(' · '),
      }
    case 'data-delivered':
      return {
        icon: 'data',
        title: 'Data delivered',
        description: [event.dataAllowance, event.network, event.walletMasked].filter(Boolean).join(' · '),
      }
    case 'request-completed':
      return { icon: 'check', title: 'Essential Request completed', description: `${event.serviceLabel}${event.detail ? ` · ${event.detail}` : ''}` }
    case 'cashout-settled':
      return { icon: 'wallet', title: 'USDT cash-out settled', description: `${event.usdtAmount} USDT → NGN · ${event.walletMasked}` }
  }
}

export function LivePage({ apiBaseUrl }: { apiBaseUrl: string }) {
  const [snapshot, setSnapshot] = useState<LiveStatsSnapshot | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())

  const load = useCallback(async () => {
    try {
      setSnapshot(await fetchPublicLive(apiBaseUrl))
      setLoadError(null)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Munus Live is unavailable right now.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [apiBaseUrl])

  useEffect(() => {
    let active = true
    fetchPublicLive(apiBaseUrl).then((next) => {
      if (!active) return
      setSnapshot(next)
      setLoadError(null)
    }).catch((error: unknown) => {
      if (active) setLoadError(error instanceof Error ? error.message : 'Munus Live is unavailable right now.')
    }).finally(() => {
      if (active) {
        setLoading(false)
        setRefreshing(false)
      }
    })
    return () => {
      active = false
    }
  }, [apiBaseUrl])

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  async function refresh() {
    setRefreshing(true)
    await load()
  }

  const metrics = snapshot?.metrics
  const cards: Array<{ icon: IconName; value: string; label: string; hint: string }> = [
    { icon: 'user', value: String(metrics?.verifiedWallets ?? 0), label: 'Verified wallets', hint: 'Unique wallets that signed in with Nimiq Pay' },
    { icon: 'arrow', value: String(metrics?.activeUsers7d ?? 0), label: 'Active users · 7 days', hint: 'Authenticated users with real activity this week' },
    { icon: 'phone', value: String(metrics?.deliveredEssentials ?? 0), label: 'Essentials delivered', hint: 'Verified payment + provider delivery only' },
    { icon: 'bolt', value: metrics ? `${metrics.nimUsed} NIM` : '0 NIM', label: 'NIM used', hint: 'Exact verified on-chain payments only' },
    { icon: 'wallet', value: metrics ? `${metrics.usdtCashedOut} USDT` : '0 USDT', label: 'USDT cashed out', hint: 'Settled provider payouts only' },
    { icon: 'check', value: String(metrics?.requestsCompleted ?? 0), label: 'Requests completed', hint: 'Essential needs fulfilled end to end' },
  ]

  return (
    <section className="screen-content" aria-labelledby="live-title">
      <section className="screen-intro">
        <p className="eyebrow">Munus Live</p>
        <h1 id="live-title">Real people. Real wallets. Real everyday use.</h1>
        <p className="screen-lede">Every number below is derived from production evidence — verified sign-ins, on-chain payments, and provider deliveries. Nothing is padded, and early zeros are shown honestly.</p>
      </section>
      {loadError ? <p className="inline-error" role="alert">{loadError}</p> : null}
      {snapshot ? (
        <p className="section-copy">
          Updated {formatRelativeTime(snapshot.updatedAt, nowMs)} · refreshes about every minute ·{' '}
          <StatusPill label="Verified evidence" tone="ready" />
        </p>
      ) : null}

      <section aria-label="Verified usage">
        <SectionHeading>Verified usage</SectionHeading>
        {loading ? <p role="status">Loading verified usage…</p> : null}
        {!loading ? (
          <div className="category-list">
            {cards.map((card) => (
              <ListRow
                description={`${card.label} · ${card.hint}`}
                icon={card.icon}
                key={card.label}
                title={card.value}
              />
            ))}
          </div>
        ) : null}
      </section>

      <section aria-label="Live activity" className="support-section">
        <SectionHeading>Live activity</SectionHeading>
        {!loading && (!snapshot || snapshot.recentActivity.length === 0) && !loadError ? (
          <EmptyState
            description="Verified wallets, deliveries, and payouts will appear here as they happen."
            icon="spark"
            title="No recent verified activity yet"
          />
        ) : null}
        {snapshot && snapshot.recentActivity.length > 0 ? (
          <div className="category-list">
            {snapshot.recentActivity.map((event, index) => {
              const copy = eventCopy(event)
              return (
                <ListRow
                  description={`${copy.description} · ${formatRelativeTime(event.at, nowMs)}`}
                  icon={copy.icon}
                  key={`${event.kind}-${event.at}-${index}`}
                  title={copy.title}
                />
              )
            })}
          </div>
        ) : null}
      </section>

      <section aria-label="How is this verified" className="receipt-section">
        <SectionHeading>How is this verified?</SectionHeading>
        <div className="truth-note"><Icon name="info" size={18} /><p>Users authenticate by signing with Nimiq Pay — each wallet counts once, no matter how often it signs in.</p></div>
        <div className="truth-note"><Icon name="info" size={18} /><p>NIM payments are verified on-chain independently. Airtime and data count only after the provider confirms delivery; cash-outs count only after the provider settles the naira payout.</p></div>
        <div className="truth-note"><Icon name="info" size={18} /><p>Test payments, unpaid quotes, and incomplete orders never count. Wallet addresses are shortened and no phone numbers, bank details, or transaction references are published.</p></div>
      </section>

      <div className="form-actions">
        <QuietButton disabled={loading || refreshing} onClick={() => void refresh()}>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </QuietButton>
      </div>
    </section>
  )
}
