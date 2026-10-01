import { useEffect, useRef, type ReactNode } from 'react'
import { BottomNav } from './BottomNav'
import { Icon } from './Primitives'
import type { AppDestination } from '../navigation'

export function MobileAppShell({ destination, onNavigate, onBack, children }: {
  destination: AppDestination
  onNavigate: (destination: AppDestination) => void
  onBack?: () => void
  children: ReactNode
}) {
  const content = useRef<HTMLElement>(null)
  useEffect(() => {
    const region = content.current
    if (!region) return
    region.scrollTop = 0
    region.focus({ preventScroll: true })
  }, [destination])

  return <div className="mobile-app-shell">
    <header className="mobile-app-header">
      {onBack ? <button className="icon-button" aria-label="Back" type="button" onClick={onBack}><Icon name="back" /></button> : <span className="mobile-wordmark">munus</span>}
      <span className="mobile-header-label">{destination === 'home' ? 'Everyday money' : destination === 'request' ? 'Request help' : destination}</span>
    </header>
    <main className="mobile-screen-content" ref={content} tabIndex={-1} aria-label={`${destination} screen`}>{children}</main>
    <BottomNav destination={destination === 'support' || destination === 'request' || destination === 'contacts' ? 'home' : destination} onNavigate={onNavigate} />
  </div>
}
