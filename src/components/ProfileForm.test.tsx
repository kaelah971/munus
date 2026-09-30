import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProfileForm } from './ProfileForm'

describe('ProfileForm', () => {
  it('persists the editable profile fields through its boundary', () => {
    const onSubmit = vi.fn()
    render(<ProfileForm onSubmit={onSubmit} submitLabel="Save profile" />)

    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Ada' } })
    fireEvent.change(screen.getByLabelText('Default phone Optional'), { target: { value: '08012345678' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      displayName: 'Ada',
      defaultPhone: '08012345678',
      preferredPaymentAsset: 'NIM',
    }))
  })
})
