/**
 * USDT cash-out domain truth shared by the browser wallet flow and the
 * server rail. Amounts are exact decimal strings; chain amounts are integer
 * base-unit bigints. Nothing here touches the network or invents pricing.
 */

/** Official Tether USDT decimals on every supported network. */
export const USDT_DECIMALS = 6
/**
 * Polygon PoS mainnet chain id, decimal and EIP-155 hex. Canonical
 * EIP-155 assignment, enforced on every wallet call.
 */
export const POLYGON_CHAIN_ID = 137
export const POLYGON_CHAIN_ID_HEX = '0x89'
/**
 * The USDT contract address is intentionally NOT hardcoded here: it must
 * come from operator-verified server config (`POLYGON_USDT_CONTRACT`)
 * and reach the wallet only inside a server-signed cash-out intent,
 * mirroring how the NIM receiver address is served.
 */
/** Keccak selector for `transfer(address,uint256)`. Pinned by test vector. */
export const ERC20_TRANSFER_SELECTOR = 'a9059cbb'


export interface CashoutBank {
  code: string
  name: string
}

export interface CashoutRatePreview {
  usdtAmount: string
  ngnAmount: string
  rateNgnPerUsdt: string
  source: string
  observedAt: string
}

export interface CashoutIntent {
  receiveAddress: string
  contractAddress: string
  chainIdHex: string
  /** Exact integer base-unit string the wallet must send. Never a float. */
  totalBaseUnits: string
  quoteExpiresAt: string
}

/** Client draft: amount, bank, and account only. Quotes, verification, and
 *  payout figures are always produced server-side. */
export interface CashoutOrderInput {
  usdtAmount: string
  bankCode: string
  accountNumber: string
}

export function isEthereumAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value.trim())
}

/** Exact USDT decimal string → integer base units. Rejects >6dp and non-positive input. */
export function parseUsdtToBaseUnits(value: string): bigint {
  const text = value.trim()
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(text)
  if (!match) throw new Error('USDT amount must be a positive decimal with at most 6 places.')
  const units = BigInt(match[1]) * 10n ** BigInt(USDT_DECIMALS) + BigInt((match[2] ?? '').padEnd(USDT_DECIMALS, '0') || '0')
  if (units <= 0n) throw new Error('USDT amount must be greater than zero.')
  return units
}

export function formatUsdtFromBaseUnits(units: bigint): string {
  if (units < 0n) throw new Error('Base units must be non-negative.')
  const divisor = 10n ** BigInt(USDT_DECIMALS)
  const whole = units / divisor
  const fraction = (units % divisor).toString().padStart(USDT_DECIMALS, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : `${whole}`
}

/** Exact decimal multiplication for rate previews. No floats. */
export function multiplyExactDecimals(a: string, b: string): string {
  const parse = (value: string): { digits: bigint; scale: number } => {
    const text = value.trim()
    const match = /^(\d+)(?:\.(\d+))?$/.exec(text)
    if (!match) throw new Error('Amount must be a non-negative decimal string.')
    return { digits: BigInt(match[1] + (match[2] ?? '')), scale: (match[2] ?? '').length }
  }
  const left = parse(a)
  const right = parse(b)
  const total = left.digits * right.digits
  const scale = left.scale + right.scale
  if (scale === 0) return total.toString()
  const raw = total.toString().padStart(scale + 1, '0')
  const whole = raw.slice(0, -scale)
  const fraction = raw.slice(-scale).replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole
}

/** Exact decimal addition for provider-supplied money values. No floats. */
export function addExactDecimals(a: string, b: string): string {
  const parse = (value: string): { digits: bigint; scale: number } => {
    const text = value.trim()
    const match = /^(\d+)(?:\.(\d+))?$/.exec(text)
    if (!match) throw new Error('Amount must be a non-negative decimal string.')
    return { digits: BigInt(match[1] + (match[2] ?? '')), scale: (match[2] ?? '').length }
  }
  const left = parse(a)
  const right = parse(b)
  const scale = Math.max(left.scale, right.scale)
  const total = left.digits * 10n ** BigInt(scale - left.scale) + right.digits * 10n ** BigInt(scale - right.scale)
  if (scale === 0) return total.toString()
  const raw = total.toString().padStart(scale + 1, '0')
  const whole = raw.slice(0, -scale)
  const fraction = raw.slice(-scale).replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole
}

/** ERC-20 `transfer(to, amount)` calldata. Pure and unit-tested. */
export function buildErc20TransferData(toAddress: string, amountBaseUnits: bigint): string {
  const to = toAddress.trim()
  if (!isEthereumAddress(to)) throw new Error('Recipient is not a valid Ethereum address.')
  if (amountBaseUnits < 0n) throw new Error('Transfer amount must be non-negative.')
  const paddedTo = to.slice(2).toLowerCase().padStart(64, '0')
  const paddedAmount = amountBaseUnits.toString(16).padStart(64, '0')
  return `0x${ERC20_TRANSFER_SELECTOR}${paddedTo}${paddedAmount}`
}

/** Nigerian NUBAN account numbers are exactly 10 digits. */
export function normalizeBankAccountNumber(value: string): string {
  const digits = value.replace(/[\s-]/g, '')
  if (!/^\d{10}$/.test(digits)) {
    throw new Error('Account number must be exactly 10 digits.')
  }
  return digits
}

export function maskBankAccountNumber(value: string): string {
  const digits = value.replace(/[\s-]/g, '')
  if (digits.length <= 4) return '••••'
  return `•••• ${digits.slice(-4)}`
}
