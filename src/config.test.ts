import { describe, expect, it } from 'vitest'
import { resolveMunusConfig } from './config'

describe('Munus client auth configuration', () => {
  it('never enables local auth for a production build', () => {
    const config = resolveMunusConfig({
      PROD: true,
      VITE_MUNUS_LOCAL_AUTH: 'true',
    })

    expect(config.productionAuth).toBe(true)
    expect(config.localDevelopmentAuth).toBe(false)
    expect(config.sessionMode).toBe('remote')
  })

  it('requires an explicit opt-in for local auth during development', () => {
    expect(
      resolveMunusConfig({ PROD: false, VITE_MUNUS_LOCAL_AUTH: 'false' }).localDevelopmentAuth,
    ).toBe(false)
    expect(
      resolveMunusConfig({ PROD: false, VITE_MUNUS_LOCAL_AUTH: 'true' }).localDevelopmentAuth,
    ).toBe(true)
  })
})
