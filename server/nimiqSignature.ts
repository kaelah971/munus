import { Address, PublicKey, Signature } from '@nimiq/core'

export function normalizeNimiqAddress(walletAddress: string): string {
  return Address.fromAny(walletAddress).toUserFriendlyAddress()
}

export function verifyNimiqSignature(input: {
  walletAddress: string
  publicKey: string
  signature: string
  message: string
}): boolean {
  try {
    const expectedAddress = normalizeNimiqAddress(input.walletAddress)
    const publicKey = PublicKey.fromHex(input.publicKey)
    const derivedAddress = publicKey.toAddress().toUserFriendlyAddress()
    if (derivedAddress !== expectedAddress) return false

    const signature = Signature.fromHex(input.signature)
    return publicKey.verify(signature, new TextEncoder().encode(input.message))
  } catch {
    return false
  }
}
