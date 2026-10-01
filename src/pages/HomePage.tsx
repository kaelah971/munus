import { useEffect, useState } from 'react'
import { AccountCardDeck } from '../components/AccountCardDeck'
import { SavedContactsRail } from '../components/SavedContactsRail'
import { ProfileAvatar } from '../components/ProfileAvatar'
import { Icon, type IconName } from '../components/Primitives'
import type { MunusProfile } from '../domain/profile'
import { isDueSoon, type Pocket, type Reminder } from '../domain/planning'
import type { Contact } from '../domain/support'
import type { AppDestination } from '../navigation'
import type { NimiqConnectionState, NimiqWalletState } from '../integration/nimiq'

export function HomePage({ connection, wallet, profile, hideBalances, pockets, reminders, supportRequests, supportDrafts, contacts, contactsLoading, contactsError, onNavigate, onProfile, onOpenContacts }: {
  connection: NimiqConnectionState
  wallet: NimiqWalletState
  profile: MunusProfile
  hideBalances: boolean
  pockets: Pocket[]
  reminders: Reminder[]
  supportRequests: { id: string; requestedProduct: string; status: string }[]
  supportDrafts: { id: string; recipientName: string; status: string }[]
  contacts: Contact[]
  contactsLoading: boolean
  contactsError: string | null
  onNavigate: (destination: AppDestination) => void
  onProfile: () => void
  onOpenContacts: (view?: 'list' | 'add' | 'detail', id?: string) => void
}) {
  const [hour, setHour] = useState(() => new Date().getHours())
  useEffect(() => {
    const update = () => setHour(new Date().getHours())
    const timer = window.setInterval(update, 60_000)
    window.addEventListener('focus', update)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', update) }
  }, [])
  const period = hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 18 ? 'afternoon' : 'evening'
  const dueReminder = reminders.find((item) => item.status === 'open' && isDueSoon(item.dueAt))
  const duePocket = pockets.find((item) => item.status !== 'archived' && item.deadline && isDueSoon(item.deadline))
  const pendingRequest = supportRequests.find((item) => item.status === 'pending')
  const supportDraft = supportDrafts.find((item) => item.status === 'draft')
  const context = dueReminder ? { title: dueReminder.title, description: 'Due soon · Review your plan', destination: 'pockets' as const, icon: 'calendar' as const }
    : duePocket ? { title: duePocket.name, description: 'Target due soon', destination: 'pockets' as const, icon: 'pocket' as const }
    : pendingRequest ? { title: pendingRequest.requestedProduct, description: 'Request waiting for your review', destination: 'request' as const, icon: 'review' as const }
    : supportDraft ? { title: `Support for ${supportDraft.recipientName}`, description: 'Continue your draft', destination: 'support' as const, icon: 'user' as const } : null
  const actions: { label: string; destination: AppDestination; icon: IconName }[] = [
    { label: 'Pay', destination: 'pay', icon: 'wallet' },
    { label: 'Pockets', destination: 'pockets', icon: 'pocket' },
    { label: 'Support', destination: 'support', icon: 'user' },
    { label: 'Request', destination: 'request', icon: 'arrow' },
  ]

  return <section className="finance-home" aria-labelledby="home-title">
    <div className="finance-greeting"><h1 id="home-title">Good {period},<br />{' '}<span>{profile.displayName}</span></h1><ProfileAvatar name={profile.displayName} onClick={onProfile} /></div>
    <AccountCardDeck wallet={wallet} connection={connection} hideBalances={hideBalances} />
    <section className="finance-actions" aria-label="Quick actions">{actions.map((action) => <button type="button" key={action.destination} onClick={() => onNavigate(action.destination)}><span><Icon name={action.icon} size={21} /></span>{action.label}</button>)}</section>
    <SavedContactsRail contacts={contacts} loading={contactsLoading} onAdd={() => onOpenContacts('add')} onSeeAll={() => onOpenContacts('list')} onContact={(id) => onOpenContacts('detail', id)} />
    {contactsError && <p className="inline-error" role="alert">{contactsError}</p>}
    {context && <button className="finance-context-row" type="button" onClick={() => onNavigate(context.destination)}><Icon name={context.icon} size={20} /><span><strong>{context.title}</strong><small>{context.description}</small></span><Icon name="arrow" size={18} /></button>}
  </section>
}
