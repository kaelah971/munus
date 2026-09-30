import { Icon } from './Primitives'

export function ProfileAvatar({
  name,
  onClick,
}: {
  name?: string
  onClick?: () => void
}) {
  const initials = name
    ? name
        .split(/\s+/)
        .map((part) => part[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : null

  const content = initials ?? <Icon name="user" size={18} />
  const className = `profile-avatar${onClick ? ' profile-avatar--action' : ''}`

  if (onClick) {
    return (
      <button aria-label="Open profile" className={className} onClick={onClick} type="button">
        {content}
      </button>
    )
  }

  return <span aria-hidden="true" className={className}>{content}</span>
}
