import type { AppDestination } from '../navigation'
import { Icon, type IconName } from './Primitives'

const items: readonly { destination: AppDestination; label: string; icon: IconName }[] = [
  { destination: 'home', label: 'Home', icon: 'home' },
  { destination: 'pay', label: 'Pay', icon: 'wallet' },
  { destination: 'pockets', label: 'Pockets', icon: 'pocket' },
  { destination: 'activity', label: 'Activity', icon: 'receipt' },
  { destination: 'profile', label: 'Profile', icon: 'user' },
]

export function BottomNav({
  destination,
  onNavigate,
}: {
  destination: AppDestination
  onNavigate: (destination: AppDestination) => void
}) {
  return (
    <nav aria-label="Primary navigation" className="bottom-nav">
      {items.map((item) => (
        <button
          aria-current={destination === item.destination ? 'page' : undefined}
          className={
            destination === item.destination
              ? 'bottom-nav-item bottom-nav-item--active'
              : 'bottom-nav-item'
          }
          key={item.destination}
          onClick={() => onNavigate(item.destination)}
          type="button"
        >
          <Icon name={item.icon} size={18} />
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  )
}
