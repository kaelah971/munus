import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Contact } from '../domain/support'
import { SavedContactsRail } from '../components/SavedContactsRail'
import { ContactsPage } from './ContactsPage'

const contact: Contact = { id: 'one', userId: 'user', displayName: 'Ada Obi', phone: '08012345678', relationship: 'Sister', country: 'NG', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }
const callbacks = () => ({ onBack: vi.fn(), onCreateContact: vi.fn().mockResolvedValue(undefined), onUpdateContact: vi.fn().mockResolvedValue(undefined), onArchiveContact: vi.fn().mockResolvedValue(undefined), onSupportContact: vi.fn() })

describe('Contacts app screens', () => {
  it('searches real contacts, opens detail, and passes its contact to support', () => {
    const actions = callbacks()
    render(<ContactsPage contacts={[contact]} {...actions} />)
    fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: 'other' } })
    expect(screen.queryByRole('button', { name: /Ada Obi/ })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: '5678' } })
    fireEvent.click(screen.getByRole('button', { name: /Ada Obi/ }))
    expect(screen.getByRole('heading', { name: 'Ada Obi' })).toBeInTheDocument()
    expect(screen.queryByText(contact.phone)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Support this person' }))
    expect(actions.onSupportContact).toHaveBeenCalledWith('one')
  })

  it('retains a failed add and retries with normalized data', async () => {
    const actions = callbacks()
    actions.onCreateContact.mockRejectedValueOnce(new Error('Could not save contact'))
    render(<ContactsPage contacts={[]} initialView="add" {...actions} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Ada Obi  ' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '080 1234 5678' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save contact' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save contact')
    expect(screen.getByLabelText('Name')).toHaveValue('  Ada Obi  ')
    expect(screen.getByLabelText('Phone')).toHaveValue('080 1234 5678')
    fireEvent.click(screen.getByRole('button', { name: 'Save contact' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Saved contacts' })).toBeInTheDocument())
    expect(actions.onCreateContact).toHaveBeenLastCalledWith(expect.objectContaining({ displayName: 'Ada Obi', phone: '08012345678' }))
  })

  it('preserves optional fields when editing and awaits archive', async () => {
    const actions = callbacks()
    render(<ContactsPage contacts={[{ ...contact, notes: 'Call first', usualAmount: '100', usualProductType: 'Airtime' }]} initialView="detail" initialContactId="one" {...actions} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText('Notes')).toHaveValue('Call first')
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save contact' }))
    await waitFor(() => expect(actions.onUpdateContact).toHaveBeenCalledWith('one', expect.objectContaining({ displayName: 'Ada', notes: 'Call first', usualAmount: '100' })))
    fireEvent.click(screen.getByRole('button', { name: /Ada Obi/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    await waitFor(() => expect(actions.onArchiveContact).toHaveBeenCalledWith('one'))
    expect(screen.getByRole('heading', { name: 'Saved contacts' })).toBeInTheDocument()
  })

  it('does not submit invalid phone data', async () => {
    const actions = callbacks()
    render(<ContactsPage contacts={[]} initialView="add" {...actions} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save contact' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('10 to 15 digits')
    expect(actions.onCreateContact).not.toHaveBeenCalled()
  })
})

it('uses up to four actual contacts and routes rail actions explicitly', () => {
  const onAdd = vi.fn(), onSeeAll = vi.fn(), onContact = vi.fn()
  const contacts = Array.from({ length: 5 }, (_, index) => ({ ...contact, id: String(index), displayName: `Person ${index}`, createdAt: `2026-01-0${index + 1}T00:00:00Z` }))
  render(<SavedContactsRail contacts={contacts} onAdd={onAdd} onSeeAll={onSeeAll} onContact={onContact} />)
  expect(screen.queryByRole('button', { name: 'Open contact Person 0' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Add contact' }))
  fireEvent.click(screen.getByRole('button', { name: 'See all' }))
  fireEvent.click(screen.getByRole('button', { name: 'Open contact Person 4' }))
  expect(onAdd).toHaveBeenCalledOnce()
  expect(onSeeAll).toHaveBeenCalledOnce()
  expect(onContact).toHaveBeenCalledWith('4')
})
