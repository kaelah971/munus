import { describe, expect, it } from 'vitest'
import { createPinRecord, verifyPin } from './appLock'

describe('Munus app lock', () => {
  it('stores a derived PIN record and verifies without storing plaintext', async () => {
    const record = await createPinRecord('123456')

    expect(JSON.stringify(record)).not.toContain('123456')
    expect(await verifyPin('123456', record)).toBe(true)
    expect(await verifyPin('000000', record)).toBe(false)
  })

  it('requires exactly six digits', async () => {
    await expect(createPinRecord('12345')).rejects.toThrow(/six digits/)
  })
})
