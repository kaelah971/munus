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

  it('keeps the service-role name outside client configuration', () => {
    const clientConfig = readFileSync(new URL('../src/config.ts', import.meta.url), 'utf8')
    expect(clientConfig).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
  })
})
