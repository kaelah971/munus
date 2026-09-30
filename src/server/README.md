# Munus production API boundary

Munus now includes a small same-origin Node API in `server/`. It does not move the Vite client to another framework. Run it with `npm run server:start` after applying the Supabase migrations; put the Vite static build and this API behind the same origin in deployment.

## Routes

- `POST /auth/challenge` creates a persisted, five-minute, single-use Nimiq login challenge.
- `POST /auth/verify` verifies the exact signed challenge with `@nimiq/core`, consumes it atomically, creates the user/session, and sets an HttpOnly cookie.
- `GET /auth/session` restores the server session from that cookie.
- `POST /auth/logout` revokes the server session and clears the cookie.
- `GET /profile` and `PUT`/`PATCH /profile` read/write only the profile owned by the validated session.
- `GET /preferences` and `PUT`/`PATCH /preferences` persist non-secret user preferences for the validated session.
- `/pockets`, `/reminders`, and `/spend-rules` provide authenticated planning CRUD; pocket allocations use a row-locked Supabase function so totals cannot race.
- `/contacts` provides manual Nigeria-first contact CRUD with archive semantics; `/support-rules` stores soft support warnings only.
- `/support-requests` provides authenticated pending/approved/declined/cancelled/prepared request lifecycle routes; `/support-drafts` stores reviewable non-payment intents.
- `GET /request/:publicRequestId` exposes a deliberately safe, opaque public projection with masked phone data. It never exposes wallet addresses or authorizes payment.

The server verifies that the supplied Ed25519 public key derives the challenged Nimiq address and that its signature verifies the exact UTF-8 challenge message. No wallet transaction is involved. Support routes likewise never call Nimiq Pay or a provider; they only save plans and review states.

## Supabase trust boundary

The API uses `SUPABASE_SERVICE_ROLE_KEY` only on the server. It is never a `VITE_*` variable and is never sent to the browser. Because service-role access bypasses Postgres RLS, every profile request derives `user_id` from the verified opaque session and never accepts a user id from the request body. The migration keeps ownership RLS truthful for a future Supabase Auth JWT path, but the current API does not pretend that `auth.uid()` protects service-role queries.

Sessions store only SHA-256 hashes of random opaque tokens. The raw token exists only in the HttpOnly cookie. Cookies are `Secure` in production, `SameSite=Lax`, and server-revocable.

## Configuration

Client-safe values are `VITE_MUNUS_API_BASE_URL`, `VITE_MUNUS_PRODUCTION_AUTH`, `VITE_MUNUS_SESSION_MODE`, and the explicitly gated `VITE_MUNUS_LOCAL_AUTH`. Server-only values are documented in the root `.env.example`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, cookie/session settings, and the Nimiq network.

Production builds use the remote path and never silently fall back to localStorage auth. Local auth/profile/session storage remains available only for explicitly enabled development/test runs.
