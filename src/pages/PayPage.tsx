import { BottomNav } from '../components/BottomNav'
import { ConnectionPill } from '../components/ConnectionStatus'
import { ListRow, StatusPill, TopBar } from '../components/Primitives'
import { ESSENTIAL_CATEGORIES } from '../domain/payment'
import type { AppDestination } from '../navigation'
import type { NimiqConnectionState } from '../integration/nimiq'
import type { IconName } from '../components/Primitives'

const icons: Record<(typeof ESSENTIAL_CATEGORIES)[number]['id'], IconName> = {
  airtime: 'phone',
  data: 'data',
  electricity: 'bolt',
  'cable-internet': 'wifi',
}

export function PayPage({
  connection,
  onNavigate,
}: {
  connection: NimiqConnectionState
  onNavigate: (destination: AppDestination) => void
}) {
  return (
    <div className="app-shell">
      <div className="app-frame">
        <TopBar connection={<ConnectionPill state={connection} />} />
        <main className="screen-content" aria-labelledby="pay-title">
          <section className="screen-intro">
            <p className="eyebrow">Everyday essentials</p>
            <h1 id="pay-title">Pay Essentials</h1>
            <p>Choose an area Munus is preparing. No payment or provider fulfilment is live in this account foundation slice.</p>
          </section>
          <section aria-label="Essential categories" className="category-list">
            {ESSENTIAL_CATEGORIES.map((category) => (
              <ListRow
                description={category.description}
                disabled
                icon={icons[category.id]}
                key={category.id}
                meta={<StatusPill label={category.availability === 'next' ? 'Coming next' : 'Not live'} />}
                title={category.name}
              />
            ))}
          </section>
          <div className="truth-note"><p>NIM payments remain a separate future slice. This screen cannot send NIM.</p></div>
        </main>
        <BottomNav destination="pay" onNavigate={onNavigate} />
      </div>
    </div>
  )
}
