// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildReadiness, type ReadinessInput } from './readiness'

function input(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    network: 'mainnet',
    database: 'ready',
    nimReceiver: true,
    nimiqRpc: true,
    clubKonnect: true,
    clubKonnectCallback: true,
    paycrest: true,
    polygonUsdt: true,
    fulfilment: true,
    nimPayments: true,
    dataCatalog: true,
    cashout: true,
    live: { airtime: true, data: true, cashout: true },
    ...overrides,
  }
}

describe('production readiness and rail capability', () => {
  it('reports verified rails when wired and attested', () => {
    const report = buildReadiness(input())
    expect(report.rails.airtime.status).toBe('verified')
    expect(report.rails.data.status).toBe('verified')
    expect(report.rails.cashout.status).toBe('verified')
    expect(report.database).toBe('ready')
    expect(report.network).toBe('mainnet')
  })

  it('marks rails configured-but-unverified without attestation', () => {
    const report = buildReadiness(input({ live: { airtime: false, data: false, cashout: false } }))
    expect(report.rails.airtime.status).toBe('configured')
    expect(report.rails.data.status).toBe('configured')
    expect(report.rails.cashout.status).toBe('configured')
    for (const rail of [report.rails.airtime, report.rails.data, report.rails.cashout]) {
      expect(rail.reason).toMatch(/not yet verified/)
    }
  })

  it('marks rails unavailable with the missing piece named', () => {
    expect(buildReadiness(input({ fulfilment: false })).rails.airtime.status).toBe('unavailable')
    expect(buildReadiness(input({ fulfilment: false })).rails.airtime.reason).toMatch(/provider/)
    expect(buildReadiness(input({ nimPayments: false })).rails.airtime.status).toBe('unavailable')
    expect(buildReadiness(input({ nimPayments: false })).rails.airtime.reason).toMatch(/NIM/)
    expect(buildReadiness(input({ dataCatalog: false })).rails.data.status).toBe('unavailable')
    expect(buildReadiness(input({ dataCatalog: false })).rails.data.reason).toMatch(/bundles/)
    expect(buildReadiness(input({ cashout: false })).rails.cashout.status).toBe('unavailable')
    // Attestation alone never enables a rail: wiring still decides.
    expect(buildReadiness(input({ cashout: false })).rails.cashout.status).toBe('unavailable')
  })

  it('leaks no secrets, URLs, or addresses', () => {
    const serialized = JSON.stringify(buildReadiness(input()))
    expect(serialized).not.toMatch(/key|secret|http|NQ|0x|postgres/i)
    expect(Object.keys(buildReadiness(input()))).toEqual([
      'network',
      'database',
      'nimReceiver',
      'nimiqRpc',
      'clubKonnect',
      'clubKonnectCallback',
      'paycrest',
      'polygonUsdt',
      'rails',
    ])
  })
})
