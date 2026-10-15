import type { LiveAttestationConfig } from './config'

/**
 * Production readiness and rail capability, decided server-side from
 * effective wiring plus explicit operator attestation.
 *
 * Status meanings (the single source the UI uses to label rails):
 * - unavailable: required configuration is missing. Money cannot move;
 *   API routes fail closed with 503 before any wallet or spend step.
 * - configured: everything required is connected, but no operator has
 *   completed a real-money smoke test for this rail yet. The UI must
 *   explain this BEFORE money can move.
 * - verified: configured AND the operator attested a successful live
 *   smoke test (MUNUS_<RAIL>_LIVE=true). Attestation never bypasses
 *   money-movement guards; it only records that live behavior was seen.
 *
 * The report contains safe booleans and human reasons only. It never
 * carries keys, secrets, URLs, addresses, or counts.
 */

export type RailStatus = 'unavailable' | 'configured' | 'verified'

export interface RailCapability {
  status: RailStatus
  reason: string
}

export interface ReadinessReport {
  network: 'mainnet' | 'testnet'
  database: 'ready' | 'unreachable'
  nimReceiver: boolean
  nimiqRpc: boolean
  clubKonnect: boolean
  clubKonnectCallback: boolean
  paycrest: boolean
  polygonUsdt: boolean
  rails: {
    airtime: RailCapability
    data: RailCapability
    cashout: RailCapability
  }
}

export interface ReadinessInput {
  network: 'mainnet' | 'testnet'
  database: 'ready' | 'unreachable'
  nimReceiver: boolean
  nimiqRpc: boolean
  clubKonnect: boolean
  clubKonnectCallback: boolean
  paycrest: boolean
  polygonUsdt: boolean
  fulfilment: boolean
  nimPayments: boolean
  dataCatalog: boolean
  cashout: boolean
  live: LiveAttestationConfig
}

const AWAITING_SMOKE = 'Connected — live behavior not yet verified by an operator smoke test.'
const VERIFIED_SMOKE = 'Live behavior verified by an operator smoke test.'

export function buildReadiness(input: ReadinessInput): ReadinessReport {
  const airtime: RailCapability = !input.fulfilment
    ? { status: 'unavailable', reason: 'Airtime provider is not configured.' }
    : !input.nimPayments
      ? { status: 'unavailable', reason: 'NIM payments are not configured.' }
      : !input.live.airtime
        ? { status: 'configured', reason: AWAITING_SMOKE }
        : { status: 'verified', reason: VERIFIED_SMOKE }

  const data: RailCapability = !input.fulfilment
    ? { status: 'unavailable', reason: 'Data provider is not configured.' }
    : !input.dataCatalog
      ? { status: 'unavailable', reason: 'Data bundles are not configured.' }
      : !input.nimPayments
        ? { status: 'unavailable', reason: 'NIM payments are not configured.' }
        : !input.live.data
          ? { status: 'configured', reason: `Data purchases are guarded until live verification. ${AWAITING_SMOKE}` }
          : { status: 'verified', reason: VERIFIED_SMOKE }

  const cashout: RailCapability = !input.cashout
    ? { status: 'unavailable', reason: 'Cash out is not configured.' }
    : !input.live.cashout
      ? { status: 'configured', reason: AWAITING_SMOKE }
      : { status: 'verified', reason: VERIFIED_SMOKE }

  return {
    network: input.network,
    database: input.database,
    nimReceiver: input.nimReceiver,
    nimiqRpc: input.nimiqRpc,
    clubKonnect: input.clubKonnect,
    clubKonnectCallback: input.clubKonnectCallback,
    paycrest: input.paycrest,
    polygonUsdt: input.polygonUsdt,
    rails: { airtime, data, cashout },
  }
}
