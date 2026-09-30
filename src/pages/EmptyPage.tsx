import { BottomNav } from '../components/BottomNav'
import { ConnectionPill } from '../components/ConnectionStatus'
import { EmptyState, Icon, TopBar } from '../components/Primitives'
import type { AppDestination } from '../navigation'
import type { NimiqConnectionState } from '../integration/nimiq'

const pageCopy = {
  pockets: {
    eyebrow: 'Plan ahead',
    title: 'Life Pockets',
    description: 'Give recurring essentials a clear place when this part of Munus opens.',
    icon: 'pocket' as const,
    emptyTitle: 'No pockets yet',
    emptyDescription: 'Pocket planning is not live in this foundation. Nothing is reserved or moved.',
  },
  activity: {
    eyebrow: 'Your record',
    title: 'Activity',
    description: 'A simple record of wallet and Munus events, when there is something to show.',
    icon: 'receipt' as const,
    emptyTitle: 'No activity yet',
    emptyDescription: 'No wallet or Munus activity has been added. Nothing is being simulated here.',
  },
} as const

export function EmptyPage({
  destination,
  connection,
  onNavigate,
}: {
  destination: 'pockets' | 'activity'
  connection: NimiqConnectionState
  onNavigate: (destination: AppDestination) => void
}) {
  const copy = pageCopy[destination]

  return (
    <div className="app-shell">
      <div className="app-frame">
        <TopBar connection={<ConnectionPill state={connection} />} />
        <main className="screen-content empty-page" aria-labelledby="empty-page-title">
          <p className="eyebrow">{copy.eyebrow}</p>
          <h1 id="empty-page-title">{copy.title}</h1>
          <p className="screen-lede">{copy.description}</p>
          <EmptyState description={copy.emptyDescription} icon={copy.icon} title={copy.emptyTitle} />
          <div className="truth-note"><Icon name="info" size={18} /><p>This surface is intentionally quiet until its underlying data exists.</p></div>
        </main>
        <BottomNav destination={destination} onNavigate={onNavigate} />
      </div>
    </div>
  )
}
