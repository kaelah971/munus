// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadServerConfig } from './config'

const validEnv = {
  DATABASE_URL: 'postgresql://munus:test@localhost:5432/munus?sslmode=disable',
}

describe('Munus server configuration', () => {
  it('fails fast when the server-only database configuration is missing', () => {
    expect(() => loadServerConfig({})).toThrow(/DATABASE_URL is required/)
  })

  it('uses the hosting platform port unless an explicit Munus port is set', () => {
    expect(loadServerConfig({ ...validEnv, PORT: '10001' }).port).toBe(10001)
    expect(loadServerConfig({ ...validEnv, PORT: '10001', MUNUS_SERVER_PORT: '10002' }).port).toBe(10002)
  })

  it('defaults cookies to secure in production', () => {
    expect(loadServerConfig({ ...validEnv, NODE_ENV: 'production' }).cookieSecure).toBe(true)
    expect(loadServerConfig({ ...validEnv, NODE_ENV: 'development' }).cookieSecure).toBe(false)
  })

  it('keeps the database URL outside client configuration', () => {
    const clientConfig = readFileSync(new URL('../src/config.ts', import.meta.url), 'utf8')
    expect(clientConfig).not.toContain('DATABASE_URL')
  })

  it('leaves the airtime provider unconfigured without credentials', () => {
    expect(loadServerConfig({ ...validEnv }).clubKonnect).toBeUndefined()
  })

  it('defaults NIM payment settings and validates the receiver address', () => {
    const defaults = loadServerConfig({ ...validEnv }).nimPayments
    expect(defaults).toMatchObject({ receiverAddress: undefined, rpcUrl: undefined, quoteTtlMs: 120_000 })
    expect(loadServerConfig({ ...validEnv, NIMIQ_RPC_URL: 'https://rpc.example' }).nimPayments.rpcUrl)
      .toBe('https://rpc.example')
    expect(loadServerConfig({ ...validEnv, MUNUS_QUOTE_TTL_SECONDS: '60' }).nimPayments.quoteTtlMs).toBe(60_000)
    expect(() => loadServerConfig({ ...validEnv, MUNUS_QUOTE_TTL_SECONDS: '0' })).toThrow(/MUNUS_QUOTE_TTL_SECONDS/)
    expect(() => loadServerConfig({ ...validEnv, MUNUS_NIM_RECEIVER_ADDRESS: 'not-an-address' }))
      .toThrow(/MUNUS_NIM_RECEIVER_ADDRESS must be a valid Nimiq address/)
    // The null address is structurally valid and normalizes deterministically.
    expect(loadServerConfig({
      ...validEnv,
      MUNUS_NIM_RECEIVER_ADDRESS: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000',
    }).nimPayments.receiverAddress).toBe('NQ07 0000 0000 0000 0000 0000 0000 0000 0000')
  })

  it('requires both provider credential halves together', () => {
    expect(() => loadServerConfig({ ...validEnv, CLUBKONNECT_USER_ID: 'user' })).toThrow(/CLUBKONNECT_USER_ID and CLUBKONNECT_API_KEY/)
    expect(() => loadServerConfig({ ...validEnv, CLUBKONNECT_API_KEY: 'key' })).toThrow(/CLUBKONNECT_USER_ID and CLUBKONNECT_API_KEY/)
    expect(loadServerConfig({
      ...validEnv,
      CLUBKONNECT_USER_ID: 'user',
      CLUBKONNECT_API_KEY: 'key',
      CLUBKONNECT_CALLBACK_BASE_URL: 'https://munus.example/',
    }).clubKonnect).toEqual({ userId: 'user', apiKey: 'key', callbackBaseUrl: 'https://munus.example/' })
  })
})
