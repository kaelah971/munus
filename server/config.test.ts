// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadServerConfig } from './config'

const validEnv = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'server-only-test-key',
}

describe('Munus server configuration', () => {
  it('fails fast when server-only Supabase configuration is missing', () => {
    expect(() => loadServerConfig({})).toThrow(/SUPABASE_URL is required/)
    expect(() => loadServerConfig({ SUPABASE_URL: validEnv.SUPABASE_URL })).toThrow(
      /SUPABASE_SERVICE_ROLE_KEY is required/,
    )
  })

  it('uses the hosting platform port unless an explicit Munus port is set', () => {
    expect(loadServerConfig({ ...validEnv, PORT: '10001' }).port).toBe(10001)
    expect(loadServerConfig({ ...validEnv, PORT: '10001', MUNUS_SERVER_PORT: '10002' }).port).toBe(10002)
  })

  it('defaults cookies to secure in production', () => {
    expect(loadServerConfig({ ...validEnv, NODE_ENV: 'production' }).cookieSecure).toBe(true)
    expect(loadServerConfig({ ...validEnv, NODE_ENV: 'development' }).cookieSecure).toBe(false)
  })

  it('keeps the service-role name outside client configuration', () => {
    const clientConfig = readFileSync(new URL('../src/config.ts', import.meta.url), 'utf8')
    expect(clientConfig).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
  })
})
