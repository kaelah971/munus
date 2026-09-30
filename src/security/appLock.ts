export interface PinRecord {
  version: 1
  salt: string
  hash: string
  iterations: number
}

const PBKDF2_ITERATIONS = 120_000

export async function createPinRecord(
  pin: string,
  cryptoApi: Crypto = getCrypto(),
): Promise<PinRecord> {
  assertPin(pin)
  const saltBytes = new Uint8Array(16)
  cryptoApi.getRandomValues(saltBytes)
  const hash = await derivePin(pin, saltBytes, PBKDF2_ITERATIONS, cryptoApi)

  return {
    version: 1,
    salt: bytesToHex(saltBytes),
    hash,
    iterations: PBKDF2_ITERATIONS,
  }
}

export async function verifyPin(
  pin: string,
  record: PinRecord,
  cryptoApi: Crypto = getCrypto(),
): Promise<boolean> {
  if (!/^\d{6}$/.test(pin)) return false
  const saltBytes = hexToBytes(record.salt)
  const actual = await derivePin(pin, saltBytes, record.iterations, cryptoApi)
  return constantTimeEqual(actual, record.hash)
}

function assertPin(pin: string): void {
  if (!/^\d{6}$/.test(pin)) {
    throw new Error('Munus app lock PIN must contain exactly six digits.')
  }
}

async function derivePin(
  pin: string,
  salt: Uint8Array,
  iterations: number,
  cryptoApi: Crypto,
): Promise<string> {
  if (!cryptoApi.subtle) {
    throw new Error('Secure PIN derivation is unavailable in this environment.')
  }

  const key = await cryptoApi.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await cryptoApi.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    key,
    256,
  )

  return bytesToHex(new Uint8Array(bits))
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(value: string): Uint8Array {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) {
    throw new Error('Invalid PIN record.')
  }

  const bytes = new Uint8Array(value.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

function getCrypto(): Crypto {
  if (!globalThis.crypto) {
    throw new Error('Secure PIN derivation is unavailable in this environment.')
  }
  return globalThis.crypto
}
