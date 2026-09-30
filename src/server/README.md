# Server / API boundary

Slice 2 establishes the contracts a real backend must implement without putting service-role credentials in the Vite client.

## Wallet session contract

- `POST /auth/challenge` accepts a wallet address and returns a short-lived, one-time `AuthChallenge`.
- The client signs the exact challenge with Nimiq Pay.
- `POST /auth/verify` accepts the challenge id, address, public key, and signature. The backend verifies the signature/address relationship, creates or loads the Munus user, and sets an HttpOnly session cookie.
- `POST /auth/logout` revokes the server session.

The remote adapter is in `src/auth/session.ts`. When no API URL is configured, the app does not pretend authentication exists. `VITE_MUNUS_LOCAL_AUTH=true` enables an explicitly marked development-only adapter that calls `sign()` but does not claim cryptographic backend verification.

## Persistence

`supabase/migrations/0001_munus_account_foundation.sql` defines users, profiles, user preferences, one-time challenges, and sessions with ownership RLS. The current browser adapter uses localStorage only for development profile/session continuity; production profile writes must move behind the authenticated API boundary.
