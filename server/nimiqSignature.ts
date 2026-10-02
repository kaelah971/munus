import { Address, Hash, PublicKey, Signature } from '@nimiq/core'

const textEncoder = new TextEncoder()
const NIMIQ_SIGNED_MESSAGE_PREFIX = '\x16Nimiq Signed Message:\n'

export function createNimiqSignedMessageDigest(message: string): Uint8Array {
  const messageBytes = textEncoder.encode(message)
  const framePrefix = textEncoder.encode(`${NIMIQ_SIGNED_MESSAGE_PREFIX}${messageBytes.byteLength}`)
  const framedMessage = new Uint8Array(framePrefix.byteLength + messageBytes.byteLength)
  framedMessage.set(framePrefix)
  framedMessage.set(messageBytes, framePrefix.byteLength)
  return Hash.computeSha256(framedMessage)
}

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
    const valid = publicKey.verify(signature, createNimiqSignedMessageDigest(input.message))

    return valid ? { valid: true, walletAddress } : { valid: false }
  } catch {
    return { valid: false }
  }
}
