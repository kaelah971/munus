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
  const paths: Record<IconName, ReactNode> = {
    arrow: (
      <>
        <path d="M4 12h15" />
        <path d="m13 6 6 6-6 6" />
      </>
    ),
    back: (
      <>
        <path d="M19 12H5" />
        <path d="m11 18-6-6 6-6" />
      </>
    ),
    bolt: <path d="m13 2-8 11h6l-1 9 8-11h-6l1-9Z" />,
    calendar: (
      <>
        <rect x="3.5" y="5" width="17" height="16" rx="3" />
        <path d="M7 3v4M17 3v4M3.5 10h17" />
      </>
    ),
    check: <path d="m5 12 4.5 4.5L19 7" />,
    data: (
      <>
        <path d="M5 18V9M12 18V5M19 18v-6" />
        <path d="M3.5 21h17" />
      </>
    ),
    home: (
      <>
        <path d="m3.5 10 8.5-7 8.5 7" />
        <path d="M5.5 9.5V20h13V9.5M9.5 20v-6h5v6" />
      </>
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5M12 8h.01" />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="2.5" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </>
    ),
    phone: (
      <>
        <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
        <path d="M10 18.5h4" />
      </>
    ),
    pocket: (
      <>
        <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6.5Z" />
        <path d="M4 9h12.5a2 2 0 0 1 2 2v1.5H16" />
      </>
    ),
    receipt: (
      <>
        <path d="M6 3.5h12v17l-3-1.8-3 1.8-3-1.8-3 1.8v-17Z" />
        <path d="M9 8h6M9 12h6M9 16h3" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 11a8 8 0 0 0-14.8-4L3 9" />
        <path d="M3 4v5h5M4 13a8 8 0 0 0 14.8 4L21 15" />
        <path d="M21 20v-5h-5" />
      </>
    ),
    review: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m8 12 2.5 2.5L16 9" />
      </>
    ),
    spark: <path d="m12 2 1.9 7.1L21 11l-7.1 1.9L12 20l-1.9-7.1L3 11l7.1-1.9L12 2Z" />,
    user: (
      <>
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5 21a7 7 0 0 1 14 0" />
      </>
    ),
    wallet: (
      <>
        <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H19a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6.5A2.5 2.5 0 0 1 4 17.5v-11Z" />
        <path d="M4 7h13.5a2.5 2.5 0 0 1 2.5 2.5v1H16a2 2 0 0 0 0 4h4" />
        <path d="M16.5 12.5h.01" />
      </>
    ),
    wifi: (
      <>
        <path d="M3.5 8.5a13 13 0 0 1 17 0M6.5 12a8.5 8.5 0 0 1 11 0M9.5 15.5a4 4 0 0 1 5 0M12 19h.01" />
      </>
    ),
  }

  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width={size}
      {...props}
    >
      {paths[name]}
    </svg>
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
    <span aria-hidden="true" className={`icon-badge icon-badge--${tone}`}>
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
    <span className={`status-pill status-pill--${tone}`}>
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
    <button className={`primary-button ${className}`.trim()} type="button" {...props}>
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
    <button className={`quiet-button ${className}`.trim()} type="button" {...props}>
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
    <article className="highlight-card">
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
    <article className="empty-state">
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
