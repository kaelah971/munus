// @vitest-environment node
import { Hash, KeyPair } from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import {
  createNimiqSignedMessageDigest,
  verifyNimiqSignature,
} from './nimiqSignature'

const encoder = new TextEncoder()

function signedMessage(message: string, keyPair: KeyPair) {
  const signature = keyPair.sign(createNimiqSignedMessageDigest(message))
  return {
    publicKey: keyPair.publicKey.toHex(),
    signature: signature.toHex(),
  }
}

describe('Nimiq signed-message verification', () => {
  it('frames an ASCII message with its byte length', () => {
    expect(createNimiqSignedMessageDigest('hello')).toEqual(
      Hash.computeSha256(encoder.encode('\x16Nimiq Signed Message:\n5hello')),
    )
  })

  it('uses UTF-8 byte length rather than JavaScript string length', () => {
    const message = 'café'

    expect(message.length).toBe(4)
    expect(encoder.encode(message).byteLength).toBe(5)
    expect(createNimiqSignedMessageDigest(message)).toEqual(
      Hash.computeSha256(encoder.encode('\x16Nimiq Signed Message:\n5café')),
    )
  })

  it('verifies a signature over the canonical framed digest and derives its wallet address', () => {
    const keyPair = KeyPair.generate()
    const message = 'Sign in to Munus.\nNonce: deterministic'

    expect(
      verifyNimiqSignature({
        message,
        ...signedMessage(message, keyPair),
      }),
    ).toEqual({
      valid: true,
      walletAddress: keyPair.toAddress().toUserFriendlyAddress(),
    })
  })

  it('does not accept a signature over the raw message bytes', () => {
    const keyPair = KeyPair.generate()
    const message = 'Sign in to Munus.'
    const signature = keyPair.sign(encoder.encode(message))

    expect(
      verifyNimiqSignature({
        message,
        publicKey: keyPair.publicKey.toHex(),
        signature: signature.toHex(),
      }),
    ).toEqual({ valid: false })
  })

  it('rejects a tampered message and a wrong public key', () => {
    const keyPair = KeyPair.generate()
    const otherKeyPair = KeyPair.generate()
    const message = 'Sign in to Munus.'
    const signature = signedMessage(message, keyPair)

    expect(
      verifyNimiqSignature({ ...signature, message: `${message} changed` }),
    ).toEqual({ valid: false })
    expect(
      verifyNimiqSignature({
        message,
        publicKey: otherKeyPair.publicKey.toHex(),
        signature: signature.signature,
      }),
    ).toEqual({ valid: false })
  })
})
