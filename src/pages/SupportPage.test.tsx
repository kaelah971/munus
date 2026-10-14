import { fireEvent, render, screen, within } from '@testing-library/react'
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
  essentialRequests: [], onCreateEssentialRequest: vi.fn(), onCancelEssentialRequest: vi.fn(),
  onSyncEssentialRequest: vi.fn(), onListDataPlans: vi.fn(async () => []),
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

const essentialRow = {
  id: 'req-1',
  ownerUserId: 'user',
  publicRequestId: 'pub-1',
  serviceType: 'AIRTIME' as const,
  network: 'MTN' as const,
  requestedAmount: '1000',
  recipientPhone: '08012345678',
  essentialStatus: 'OPEN' as const,
  expiresAt: '2099-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

it('creates a shareable essential need from the request tab', () => {
  const onCreateEssentialRequest = vi.fn(async () => {})
  render(<SupportPage {...props} initialMode="request" essentialRequests={[]} onCreateEssentialRequest={onCreateEssentialRequest} />)
  fireEvent.click(screen.getByRole('button', { name: 'Request a need' }))
  const section = screen.getByRole('heading', { name: 'Essential needs' }).closest('section')
  if (!section) throw new Error('Essential needs section was not rendered.')
  const form = within(section)
  fireEvent.change(form.getByLabelText('Network'), { target: { value: 'MTN' } })
  fireEvent.change(screen.getByLabelText('Recipient phone'), { target: { value: '08012345678' } })
  fireEvent.change(screen.getByLabelText('Amount (NGN)'), { target: { value: '1000' } })
  fireEvent.change(screen.getByLabelText('Note for the payer (optional)'), { target: { value: 'Need airtime' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create shareable request' }))
  expect(onCreateEssentialRequest).toHaveBeenCalledWith(expect.objectContaining({
    serviceType: 'AIRTIME',
    network: 'MTN',
    recipientPhone: '08012345678',
    requestedAmount: '1000',
    message: 'Need airtime',
  }))
})

it('lists essential needs with share, refresh, and cancel actions', () => {
  const onCancelEssentialRequest = vi.fn(async () => {})
  const onSyncEssentialRequest = vi.fn(async () => {})
  render(<SupportPage
    {...props}
    initialMode="request"
    essentialRequests={[essentialRow]}
    onCancelEssentialRequest={onCancelEssentialRequest}
    onSyncEssentialRequest={onSyncEssentialRequest}
  />)
  expect(screen.getByText('₦1000 MTN airtime')).toBeInTheDocument()
  expect(screen.queryByText('08012345678')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
  expect(onSyncEssentialRequest).toHaveBeenCalledWith('req-1')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onCancelEssentialRequest).toHaveBeenCalledWith('req-1')
})
