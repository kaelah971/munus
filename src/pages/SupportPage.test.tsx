import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { SupportPage } from './SupportPage'

const contact = { id: 'one', userId: 'user', displayName: 'Ada Obi', phone: '08012345678', country: 'NG' as const, createdAt: '2026-01-01', updatedAt: '2026-01-01' }
const props = {
  connection: { status: 'unavailable' as const, accounts: [] }, authenticated: true, initialMode: 'support' as const,
  loading: false, error: null, contacts: [contact], supportRules: [], supportRequests: [], supportDrafts: [],
  onNavigate: vi.fn(), onCreateContact: vi.fn(), onUpdateContact: vi.fn(), onArchiveContact: vi.fn(),
  onCreateSupportRule: vi.fn(), onUpdateSupportRule: vi.fn(), onDeleteSupportRule: vi.fn(),
  onCreateSupportRequest: vi.fn(), onUpdateSupportRequest: vi.fn(), onCancelSupportRequest: vi.fn(), onConvertRequest: vi.fn(),
  onCreateSupportDraft: vi.fn(), onUpdateSupportDraft: vi.fn(),
}

it('preselects a contact into the existing support draft flow', () => {
  render(<SupportPage {...props} initialContactId="one" />)
  expect(screen.getByRole('heading', { name: 'Prepare support for Ada Obi' })).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '100' } })
  fireEvent.change(screen.getByLabelText('Product/details'), { target: { value: 'Airtime for Ada' } })
  fireEvent.click(screen.getByRole('button', { name: 'Continue to review' }))
  expect(screen.getByRole('heading', { name: 'Review support draft' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Save support draft' }))
  expect(props.onCreateSupportDraft).toHaveBeenCalledWith(expect.objectContaining({ contactId: 'one', recipientName: 'Ada Obi', amount: '100', productDetails: 'Airtime for Ada' }))
})

it('opens dedicated contacts instead of rendering another contacts form', () => {
  const onOpenContacts = vi.fn()
  render(<SupportPage {...props} onOpenContacts={onOpenContacts} />)
  fireEvent.click(screen.getByRole('button', { name: 'Contacts' }))
  expect(onOpenContacts).toHaveBeenCalledWith('list')
  fireEvent.click(screen.getByRole('button', { name: 'Save a contact' }))
  expect(onOpenContacts).toHaveBeenCalledWith('add')
})
