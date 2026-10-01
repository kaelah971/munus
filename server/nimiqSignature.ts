import { Address, PublicKey, Signature } from '@nimiq/core'

export function normalizeNimiqAddress(walletAddress: string): string {
  return Address.fromAny(walletAddress).toUserFriendlyAddress()
}

export type NimiqSignatureVerification =
  | { valid: true; walletAddress: string }
  | { valid: false }

export function verifyNimiqSignature(input: {
  publicKey: string
  signature: string
  message: string
}): NimiqSignatureVerification {
  try {
    const publicKey = PublicKey.fromHex(input.publicKey)
    const walletAddress = publicKey.toAddress().toUserFriendlyAddress()
    const signature = Signature.fromHex(input.signature)
    const valid = publicKey.verify(signature, new TextEncoder().encode(input.message))

    return valid ? { valid: true, walletAddress } : { valid: false }
  } catch {
    return { valid: false }
  }
}
