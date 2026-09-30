export type AuthSessionTrust = 'server-verified' | 'development-only-unverified'

export interface AuthChallenge {
  id: string
  walletAddress: string
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
  signIn(walletAddress: string, sign: (message: string) => Promise<{
    publicKey: string
    signature: string
  }>): Promise<MunusSession>
  signOut(session: MunusSession): Promise<void>
}
