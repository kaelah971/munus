import { describe, expect, it } from 'vitest'
import {
  addExactDecimals,
  buildErc20TransferData,
  formatUsdtFromBaseUnits,
  isEthereumAddress,
  maskBankAccountNumber,
  normalizeBankAccountNumber,
  parseUsdtToBaseUnits,
  POLYGON_CHAIN_ID,
  POLYGON_CHAIN_ID_HEX,
  USDT_DECIMALS,
} from './cashout'

describe('cash-out domain truth', () => {
  it('pins Polygon chain metadata and address validation', () => {
    expect(USDT_DECIMALS).toBe(6)
    expect(POLYGON_CHAIN_ID).toBe(137)
    expect(POLYGON_CHAIN_ID_HEX).toBe('0x89')
    expect(isEthereumAddress(`0x${'ab'.repeat(20)}`)).toBe(true)
    expect(isEthereumAddress('NQ07 0000')).toBe(false)
    expect(isEthereumAddress('0x123')).toBe(false)
  })

  it('converts USDT decimals to base units exactly', () => {
    expect(parseUsdtToBaseUnits('100')).toBe(100_000_000n)
    expect(parseUsdtToBaseUnits('0.000001')).toBe(1n)
    expect(parseUsdtToBaseUnits('100.5')).toBe(100_500_000n)
    expect(() => parseUsdtToBaseUnits('0')).toThrow()
    expect(() => parseUsdtToBaseUnits('-5')).toThrow()
    expect(() => parseUsdtToBaseUnits('1.0000001')).toThrow()
    expect(() => parseUsdtToBaseUnits('abc')).toThrow()
    expect(formatUsdtFromBaseUnits(100_500_000n)).toBe('100.5')
    expect(formatUsdtFromBaseUnits(1n)).toBe('0.000001')
    expect(formatUsdtFromBaseUnits(0n)).toBe('0')
  })

  it('adds provider money values without floats', () => {
    expect(addExactDecimals('100', '2.5')).toBe('102.5')
    expect(addExactDecimals('0.1', '0.2')).toBe('0.3')
    expect(() => addExactDecimals('x', '1')).toThrow()
  })

  it('builds ERC-20 transfer calldata matching the known encoding', () => {
    const data = buildErc20TransferData('0x1111111111111111111111111111111111111111', 1_000_000n)
    expect(data).toBe(
      '0xa9059cbb' +
      '0000000000000000000000001111111111111111111111111111111111111111' +
      '00000000000000000000000000000000000000000000000000000000000f4240',
    )
    expect(() => buildErc20TransferData('not-an-address', 1n)).toThrow()
    expect(() => buildErc20TransferData('0x1111111111111111111111111111111111111111', -1n)).toThrow()
  })

  it('validates and masks NUBAN account numbers', () => {
    expect(normalizeBankAccountNumber('0123 456 789')).toBe('0123456789')
    expect(() => normalizeBankAccountNumber('12345')).toThrow()
    expect(() => normalizeBankAccountNumber('abcdefghij')).toThrow()
    expect(maskBankAccountNumber('0123456789')).toBe('•••• 6789')
    expect(maskBankAccountNumber('12')).toBe('••••')
  })
})
