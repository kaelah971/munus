import type { Icon as PhosphorIcon } from '@phosphor-icons/react'
import { ArrowLeft } from '@phosphor-icons/react/dist/csr/ArrowLeft'
import { ArrowRight } from '@phosphor-icons/react/dist/csr/ArrowRight'
import { ArrowsClockwise } from '@phosphor-icons/react/dist/csr/ArrowsClockwise'
import { Briefcase } from '@phosphor-icons/react/dist/csr/Briefcase'
import { CalendarBlank } from '@phosphor-icons/react/dist/csr/CalendarBlank'
import { ChartBar } from '@phosphor-icons/react/dist/csr/ChartBar'
import { Check } from '@phosphor-icons/react/dist/csr/Check'
import { House } from '@phosphor-icons/react/dist/csr/House'
import { Info } from '@phosphor-icons/react/dist/csr/Info'
import { Lightning } from '@phosphor-icons/react/dist/csr/Lightning'
import { LockKey } from '@phosphor-icons/react/dist/csr/LockKey'
import { Phone } from '@phosphor-icons/react/dist/csr/Phone'
import { Receipt } from '@phosphor-icons/react/dist/csr/Receipt'
import { SealCheck } from '@phosphor-icons/react/dist/csr/SealCheck'
import { Sparkle } from '@phosphor-icons/react/dist/csr/Sparkle'
import { User } from '@phosphor-icons/react/dist/csr/User'
import { Wallet } from '@phosphor-icons/react/dist/csr/Wallet'
import { WifiHigh } from '@phosphor-icons/react/dist/csr/WifiHigh'
import type {
  ButtonHTMLAttributes,
  ReactNode,
  SVGProps,
} from 'react'

export type IconName =
  | 'arrow'
  | 'back'
  | 'bolt'
  | 'calendar'
  | 'check'
  | 'data'
  | 'home'
  | 'info'
  | 'lock'
  | 'phone'
  | 'pocket'
  | 'receipt'
  | 'refresh'
  | 'review'
  | 'spark'
  | 'user'
  | 'wallet'
  | 'wifi'

export type StatusTone = 'quiet' | 'ready' | 'attention'

export function Icon({
  name,
  size = 20,
  className,
  ...props
}: { name: IconName; size?: number; className?: string } & SVGProps<SVGSVGElement>) {
  const icons: Record<IconName, PhosphorIcon> = {
    arrow: ArrowRight,
    back: ArrowLeft,
    bolt: Lightning,
    calendar: CalendarBlank,
    check: Check,
    data: ChartBar,
    home: House,
    info: Info,
    lock: LockKey,
    phone: Phone,
    pocket: Briefcase,
    receipt: Receipt,
    refresh: ArrowsClockwise,
    review: SealCheck,
    spark: Sparkle,
    user: User,
    wallet: Wallet,
    wifi: WifiHigh,
  }
  const PhosphorIconComponent = icons[name]

  return (
    <PhosphorIconComponent
      aria-hidden="true"
      className={className}
      size={size}
      weight="regular"
      {...props}
    />
  )
}

export function BrandLockup() {
  return (
    <div aria-label="Munus" className="brand-lockup">
      <span aria-hidden="true" className="brand-mark">
        M
      </span>
      <span className="brand-name">munus</span>
    </div>
  )
}

export function IconBadge({
  icon,
  tone = 'quiet',
}: {
  icon: IconName
  tone?: StatusTone
}) {
  return (
    <span aria-hidden="true" className={`icon-badge munus-icon-control icon-badge--${tone}`}>
      <Icon name={icon} size={19} />
    </span>
  )
}

export function StatusPill({
  label,
  tone = 'quiet',
}: {
  label: string
  tone?: StatusTone
}) {
  return (
    <span className={`status-pill munus-chip status-pill--${tone}`}>
      <span aria-hidden="true" className="status-dot" />
      {label}
    </span>
  )
}

export function PrimaryButton({
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`primary-button munus-primary-action ${className}`.trim()} type="button" {...props}>
      {children}
    </button>
  )
}

export function QuietButton({
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`quiet-button munus-secondary-action ${className}`.trim()} type="button" {...props}>
      {children}
    </button>
  )
}

export function TopBar({
  action,
  connection,
  onBack,
}: {
  action?: ReactNode
  connection?: ReactNode
  onBack?: () => void
}) {
  return (
    <header className="top-bar">
      <div className="top-bar-leading">
        {onBack ? (
          <button
            aria-label="Back to home"
            className="icon-button"
            onClick={onBack}
            type="button"
          >
            <Icon name="back" size={20} />
          </button>
        ) : null}
        <BrandLockup />
      </div>
      <div className="top-bar-actions">
        {connection ? <div className="top-bar-connection">{connection}</div> : null}
        {action ? <div className="top-bar-action">{action}</div> : null}
      </div>
    </header>
  )
}

export function HighlightCard({
  icon,
  eyebrow,
  title,
  description,
}: {
  icon: IconName
  eyebrow: string
  title: string
  description: string
}) {
  return (
    <article className="highlight-card munus-card">
      <IconBadge icon={icon} tone="ready" />
      <div>
        <p className="card-eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </article>
  )
}

export function ListRow({
  icon,
  title,
  description,
  meta,
  disabled = false,
  onClick,
}: {
  icon: IconName
  title: string
  description: string
  meta?: ReactNode
  disabled?: boolean
  onClick?: () => void
}) {
  const className = `list-row${disabled ? ' list-row--disabled' : ''}${onClick ? ' list-row--action' : ''}`
  const content = (
    <>
      <IconBadge icon={icon} />
      <div className="list-row-copy">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {meta ? <div className="list-row-meta">{meta}</div> : null}
    </>
  )

  if (onClick) {
    return (
      <button className={className} onClick={onClick} type="button">
        {content}
      </button>
    )
  }

  return (
    <article aria-disabled={disabled || undefined} className={className}>
      {content}
    </article>
  )
}

export function EmptyState({
  icon,
  title,
  description,
}: {
  icon: IconName
  title: string
  description: string
}) {
  return (
    <article className="empty-state munus-card-elevated">
      <IconBadge icon={icon} />
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
    </article>
  )
}

export function SectionHeading({ children }: { children: ReactNode }) {
  return <h2 className="section-heading">{children}</h2>
}
