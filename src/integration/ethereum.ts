import {
  buildErc20TransferData,
  POLYGON_CHAIN_ID_HEX,
} from '../domain/cashout'

/**
 * Minimal structural EIP-1193 surface. The Nimiq Mini App SDK exposes no EVM
 * provider, so USDT moves through the wallet's own injected provider only.
 * Nothing here guesses a provider brand, chain behavior, or token metadata:
 * chain id, contract, destination, and exact amount all arrive in the
 * server-signed intent. Munus never holds keys and never prompts on mount.
 */
export interface Eip1193Provider {
  request(args: { method: string; params?: unknown }): Promise<unknown>
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider | undefined
  }
}

export interface UsdtTransferIntent {
  contractAddress: string
  receiveAddress: string
  totalBaseUnits: string
  chainIdHex: string
  quoteExpiresAt: string
}

export function getInjectedEthereumProvider(): Eip1193Provider | null {
  if (typeof window === 'undefined') return null
  return window.ethereum ?? null
}

function isUsdtTransferIntent(value: unknown): value is UsdtTransferIntent {
  if (!value || typeof value !== 'object') return false
  const intent = value as Record<string, unknown>
  return (
    typeof intent.contractAddress === 'string' &&
    typeof intent.receiveAddress === 'string' &&
    typeof intent.totalBaseUnits === 'string' &&
    typeof intent.chainIdHex === 'string' &&
    typeof intent.quoteExpiresAt === 'string'
  )
}

function readProviderErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const record = error as Record<string, unknown>
  if (typeof record.message === 'string' && record.message.trim() !== '') return record.message
  return null
}

/**
 * Sends the exact quoted USDT total to the Paycrest receive address on
 * Polygon via `eth_sendTransaction`. Called only from an explicit user tap,
 * never on mount. Throws a plain Error with the wallet's message on
 * rejection. The returned hash is submission evidence only.
 */
export async function requestUsdtTransfer(intent: unknown): Promise<string> {
  if (!isUsdtTransferIntent(intent)) {
    throw new Error('Munus payout details are missing or invalid.')
  }
  if (intent.chainIdHex.toLowerCase() !== POLYGON_CHAIN_ID_HEX) {
    throw new Error('Munus cash out settles on Polygon only.')
  }
  const provider = getInjectedEthereumProvider()
  if (!provider) {
    throw new Error('No Ethereum wallet was found. Open Munus inside a wallet with Polygon USDT.')
  }
  // Silent read: fail closed when the wallet is on the wrong network instead
  // of sending anywhere unexpected. No chain switching is ever requested.
  let chainId: unknown
  try {
    chainId = await provider.request({ method: 'eth_chainId' })
  } catch (error) {
    throw new Error(readProviderErrorMessage(error) ?? 'The wallet could not confirm its network.', { cause: error })
  }
  if (typeof chainId !== 'string' || chainId.toLowerCase() !== POLYGON_CHAIN_ID_HEX) {
    throw new Error('Switch your wallet to Polygon to complete this cash out.')
  }
  if (!/^\d+$/.test(intent.totalBaseUnits)) {
    throw new Error('Munus payout details are missing a valid USDT total.')
  }
  const data = buildErc20TransferData(intent.receiveAddress, BigInt(intent.totalBaseUnits))
  let result: unknown
  try {
    // The wallet chooses and signs the sender; value stays zero so no
    // native token moves alongside the USDT transfer.
    result = await provider.request({
      method: 'eth_sendTransaction',
      params: [{ to: intent.contractAddress, data, value: '0x0' }],
    })
  } catch (error) {
    throw new Error(readProviderErrorMessage(error) ?? 'The wallet rejected the USDT transfer.', { cause: error })
  }
  if (typeof result !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(result.trim())) {
    throw new Error('The wallet did not return a usable transaction reference.')
  }
  return result.trim()
}
