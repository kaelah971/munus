export type AuthSessionTrust = 'server-verified' | 'development-only-unverified'
export type MunusNetwork = 'mainnet' | 'testnet'

export interface AuthChallenge {
  id: string
  walletAddress: string
  network: MunusNetwork
  message: string
  expiresAt: number
}

export interface SignedAuthChallenge {
  challengeId: string
  walletAddress: string
  publicKey: string
  signature: string
}

export interface MunusSession {
  id: string
  userId: string
  walletAddress: string
  network: MunusNetwork
  issuedAt: number
  expiresAt: number
  trust: AuthSessionTrust
}

export type AuthState =
  | 'signed_out'
  | 'authenticating'
  | 'authenticated'
  | 'unavailable'
  | 'error'

export interface AuthGateway {
  readonly mode: 'remote' | 'local-development' | 'unavailable'
  signIn(
    walletAddress: string,
    sign: (message: string) => Promise<{
      publicKey: string
      signature: string
    }>,
    network?: MunusNetwork,
  ): Promise<MunusSession>
  restoreSession(): Promise<MunusSession | null>
  signOut(session?: MunusSession): Promise<void>
}
